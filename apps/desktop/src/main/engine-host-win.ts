import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import {
  ENGINE_CAPTURE_CONTROL_CHANNEL,
  type EngineCaptureStatus,
  type EngineCommand,
  type EngineEvent,
  type EngineSidecarEvent,
  type EngineStartOptions
} from '../shared/engine-events'
import type { EngineEventListener } from './engine-process'
import { WinSessionRecorder } from './win-audio-recorder'
import { join as joinPath } from 'node:path'
import type { WizardPreflightEvent, WizardPreflightResult } from '../shared/wizard-api'
import type { BatchProgress, BatchTranscription } from './import-logic'

const RESTART_DELAY_MS = 3_000
const CAPTURE_DRAIN_TIMEOUT_MS = 2_000

/**
 * Windows counterpart of EngineProcess: drives the sherpa-onnx engine
 * (engine-win.ts) as a persistent utilityProcess. Audio is captured in the
 * renderer (Chromium mic + WASAPI loopback) and forwarded here via
 * pushAudio; capture start/stop is signalled to the renderer over
 * ENGINE_CAPTURE_CONTROL_CHANNEL. Event flow matches EngineProcess exactly
 * (started/ready/…/done + a synthesized exit), so everything downstream is
 * platform-blind.
 */
export class WinEngineHost {
  private child: UtilityProcess | null = null
  private ready = false
  private sessionActive = false
  private captureState: 'idle' | 'starting' | 'capturing' | 'draining' | 'finishing' | 'refining' =
    'idle'
  private nextSessionId = 0
  private activeSessionId: number | null = null
  private workerStarted = false
  private drainTimer: NodeJS.Timeout | null = null
  private workerFinishTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private disposed = false
  private readonly listeners = new Set<EngineEventListener>()
  private readonly warmupListeners = new Set<(event: WizardPreflightEvent) => void>()
  private readonly warmupWaiters = new Set<(result: WizardPreflightResult) => void>()
  private lastWarmupEvent: WizardPreflightEvent = { stage: 'models' }
  private warmupResult: WizardPreflightResult | null = null
  private inputDevice: string | undefined
  private activeChannels: string[] = []
  /** Tees renderer PCM frames to disk when the session persists audio. */
  private recorder: WinSessionRecorder | null = null
  private ephemeralAudioDir: string | null = null
  private finalRefiner:
    | ((
        path: string,
        onProgress?: (progress: BatchProgress) => void
      ) => Promise<BatchTranscription>)
    | null = null

  constructor(private readonly broadcast: (channel: string, payload: unknown) => void) {}

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get running(): boolean {
    return this.sessionActive
  }

  setFinalRefiner(
    refiner: (
      path: string,
      onProgress?: (progress: BatchProgress) => void
    ) => Promise<BatchTranscription>
  ): void {
    this.finalRefiner = refiner
  }

  /** Fork the engine and load models (call once, after app ready). */
  startServe(): void {
    if (this.child || this.disposed) return
    const child = utilityProcess.fork(join(__dirname, 'engine-win.js'), [], {
      serviceName: 'doodlenote-engine'
    })
    this.child = child
    this.ready = false

    child.on('message', (message: unknown) => {
      if (this.child !== child) return
      const data = message as { t?: string; event?: Record<string, unknown> }
      if (data.t !== 'event' || !data.event) return
      this.handleEngineEvent(data.event)
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.ready = false
      if (this.sessionActive) {
        const sessionId = this.activeSessionId
        this.sessionActive = false
        this.captureState = 'idle'
        this.activeSessionId = null
        this.workerStarted = false
        if (this.drainTimer) clearTimeout(this.drainTimer)
        this.drainTimer = null
        if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
        this.workerFinishTimer = null
        if (sessionId !== null) this.stopCaptureInRenderer(sessionId)
        // Engine crashed mid-session: keep the checkpoint chunks on disk —
        // next launch's orphan recovery merges them.
        this.recorder?.abort()
        this.recorder = null
        this.removeEphemeralAudio()
        this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
      }
      if (!this.disposed) {
        this.restartTimer = setTimeout(() => this.startServe(), RESTART_DELAY_MS)
        this.restartTimer.unref()
      }
    })

    child.postMessage({ t: 'init', modelsDir: join(app.getPath('userData'), 'asr-models') })
  }

  private handleEngineEvent(event: Record<string, unknown>): void {
    if (event.event === 'status' && event.stage === 'serve_ready') {
      this.ready = true
      this.finishWarmup({ ok: true, micGranted: false, screenGranted: false }, { stage: 'ready' })
      return
    }
    if (!this.ready && !this.sessionActive) {
      if (event.event === 'download' && typeof event.progress === 'number') {
        this.emitWarmup({ stage: 'download', progress: event.progress })
      } else if (
        event.event === 'status' &&
        (event.stage === 'downloading_model' ||
          event.stage === 'extracting_model' ||
          event.stage === 'serve_loading_models')
      ) {
        this.emitWarmup(
          event.stage === 'downloading_model'
            ? { stage: 'download', progress: 0 }
            : { stage: 'models' }
        )
      } else if (event.event === 'error') {
        const message = String(event.message ?? 'Windows transcription engine failed to start')
        this.finishWarmup(
          { ok: false, micGranted: false, screenGranted: false, error: message },
          { stage: 'error', message }
        )
      }
    }
    // Model download/boot progress is host-side noise, not session traffic.
    if (!this.sessionActive) return
    if (event.event === 'done') {
      if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
      this.workerFinishTimer = null
      void this.completeSession()
      return
    }
    this.emit(event as unknown as EngineSidecarEvent)
  }

  private async completeSession(): Promise<void> {
    if (!this.sessionActive || this.captureState === 'refining') return
    this.captureState = 'refining'
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = null
    const sessionId = this.activeSessionId
    if (sessionId !== null) this.stopCaptureInRenderer(sessionId)
    const recorder = this.recorder
    this.recorder = null
    let audioPath: string | null = null
    try {
      const saved = await recorder?.finish()
      if (saved && recorder) {
        audioPath = joinPath(recorder.dir, 'audio.wav')
        if (!this.ephemeralAudioDir) {
          this.emit({
            event: 'audio',
            path: audioPath,
            durationMs: saved.durationMs,
            startEpochMs: saved.startEpochMs
          })
        }
      }
    } catch (error) {
      console.error('[win-audio] merge failed:', error)
    }

    if (audioPath && this.finalRefiner && !this.disposed) {
      try {
        const refinementPath = audioPath
        this.emit({ event: 'status', stage: 'refining_transcript' })
        const result = await this.finalRefiner(refinementPath, (progress) => {
          if (progress.stage === 'downloading_model') {
            this.emit({ event: 'download', progress: progress.progress ?? 0 })
          } else if (progress.stage === 'transcribing') {
            this.emit({ event: 'status', stage: 'refining_transcript' })
          }
        })
        const transcripts = (['mic', 'system'] as const).flatMap((channel) => {
          const text = result.segments
            .filter((segment) => segment.channel === channel && !segment.echo)
            .sort((a, b) => a.startMs - b.startMs)
            .map((segment) => segment.text.trim())
            .filter(Boolean)
            .join(' ')
          return text ? [{ channel, text, audioSeconds: result.audioSeconds }] : []
        })
        if (transcripts.length > 0) this.emit({ event: 'refined', transcripts })
      } catch {
        console.error('[win-asr] final refinement failed')
        this.emit({
          event: 'error',
          message: 'High-accuracy refinement could not finish; the live transcript was kept.'
        })
      }
    }

    this.removeEphemeralAudio()
    if (this.disposed || !this.sessionActive || this.activeSessionId !== sessionId) return
    this.sessionActive = false
    this.captureState = 'idle'
    this.activeSessionId = null
    this.workerStarted = false
    this.emit({ event: 'done' })
    this.emit({ event: 'exit', code: 0, signal: null })
  }

  start(command: EngineCommand, filePath?: string, opts: EngineStartOptions = {}): void {
    if (command !== 'live') {
      this.emit({
        event: 'spawn-error',
        message: `The "${command}" engine command is not available on Windows.`
      })
      return
    }
    if (!this.child || !this.ready) {
      this.emit({
        event: 'spawn-error',
        message:
          'The transcription engine is still starting up (first run downloads the speech model — watch the Dev console for progress). Try again in a moment.'
      })
      return
    }
    if (this.sessionActive) {
      this.emit({
        event: 'spawn-error',
        message: 'The previous recording is still finishing. Try again in a moment.'
      })
      return
    }
    const source = opts.source ?? 'both'
    const channels = [
      source === 'mic' || source === 'both' ? 'mic' : null,
      source === 'system' || source === 'both' ? 'system' : null
    ].filter((c): c is string => c !== null)

    this.sessionActive = true
    this.captureState = 'starting'
    this.activeSessionId = ++this.nextSessionId
    this.workerStarted = false
    this.activeChannels = channels
    this.inputDevice = opts.inputDevice
    const audioDir = opts.audioDir ?? mkdtempSync(join(tmpdir(), 'doodlenote-asr-'))
    this.ephemeralAudioDir = opts.audioDir ? null : audioDir
    this.recorder = new WinSessionRecorder(audioDir)
    this.emit({ event: 'started', command, filePath, binaryPath: 'sherpa-onnx (in-process)' })
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, {
      action: 'start',
      sessionId: this.activeSessionId,
      channels,
      ...(this.inputDevice ? { inputDevice: this.inputDevice } : {})
    })
  }

  stop(): void {
    if (!this.sessionActive || !this.child || this.activeSessionId === null) return
    if (this.captureState === 'draining' || this.captureState === 'finishing') return
    this.captureState = 'draining'
    this.stopCaptureInRenderer(this.activeSessionId)
    this.drainTimer = setTimeout(() => {
      if (this.captureState !== 'draining') return
      this.emit({
        event: 'error',
        message: 'Audio capture did not finish draining in time; finalizing available audio.'
      })
      this.finishAfterCaptureDrain()
    }, CAPTURE_DRAIN_TIMEOUT_MS)
    this.drainTimer.unref()
  }

  private finishAfterCaptureDrain(): void {
    if (!this.sessionActive || this.captureState !== 'draining' || !this.child) return
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = null
    this.captureState = 'finishing'
    if (this.workerStarted) {
      this.child.postMessage({ t: 'stop', sessionId: this.activeSessionId })
    } else {
      this.handleEngineEvent({ event: 'done' })
      return
    }
    this.workerFinishTimer = setTimeout(() => {
      if (this.sessionActive && this.captureState === 'finishing' && this.child) {
        this.child.kill() // exit handler synthesizes the session end
      }
    }, 15_000)
    this.workerFinishTimer.unref()
  }

  /** Renderer capture frames land here (via ENGINE_AUDIO_CHANNEL). */
  pushAudio(sessionId: number, channel: string, samples: Float32Array): void {
    if (
      !this.sessionActive ||
      !this.child ||
      !this.workerStarted ||
      sessionId !== this.activeSessionId ||
      (this.captureState !== 'capturing' && this.captureState !== 'draining')
    ) {
      return
    }
    this.recorder?.write(channel, samples)
    this.child.postMessage({ t: 'audio', sessionId, channel, samples })
  }

  /** Renderer capture lifecycle acknowledgements and actionable errors. */
  captureStatus(status: EngineCaptureStatus): void {
    if (!status || typeof status.sessionId !== 'number' || typeof status.type !== 'string') return
    if (!this.sessionActive || status.sessionId !== this.activeSessionId) return
    if (status.type === 'ready' && this.captureState === 'starting' && this.child) {
      this.captureState = 'capturing'
      this.workerStarted = true
      this.child.postMessage({
        t: 'start',
        sessionId: status.sessionId,
        channels: this.activeChannels
      })
      return
    }
    if (status.type === 'drained' && this.captureState === 'draining') {
      this.finishAfterCaptureDrain()
      return
    }
    if (status.type === 'switch-error') {
      this.emit({ event: 'error', message: `Could not switch microphones: ${status.message}` })
      return
    }
    if (status.type === 'error') {
      this.emit({ event: 'error', message: status.message })
      this.stop()
    }
  }

  /** Windows renderer owns microphone capture, so device switches are sent there. */
  setInputDevice(uid: string | null): void {
    this.inputDevice = uid ?? undefined
    if (!this.sessionActive || !this.activeChannels.includes('mic')) return
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, {
      action: 'switch-input',
      sessionId: this.activeSessionId,
      ...(this.inputDevice ? { inputDevice: this.inputDevice } : {})
    })
  }

  /** Wait for the Windows speech model and native recognizer to be ready. */
  preflight(onEvent?: (event: WizardPreflightEvent) => void): Promise<WizardPreflightResult> {
    if (onEvent) {
      onEvent(this.lastWarmupEvent)
      this.warmupListeners.add(onEvent)
    }
    if (this.warmupResult) {
      if (onEvent) this.warmupListeners.delete(onEvent)
      return Promise.resolve(this.warmupResult)
    }
    return new Promise((resolve) => {
      const finish = (result: WizardPreflightResult): void => {
        if (onEvent) this.warmupListeners.delete(onEvent)
        resolve(result)
      }
      this.warmupWaiters.add(finish)
    })
  }

  private emitWarmup(event: WizardPreflightEvent): void {
    this.lastWarmupEvent = event
    for (const listener of this.warmupListeners) listener(event)
  }

  private finishWarmup(result: WizardPreflightResult, event: WizardPreflightEvent): void {
    if (this.warmupResult) return
    this.warmupResult = result
    this.emitWarmup(event)
    for (const resolve of this.warmupWaiters) resolve(result)
    this.warmupWaiters.clear()
  }

  private stopCaptureInRenderer(sessionId: number): void {
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, { action: 'stop', sessionId })
  }

  private removeEphemeralAudio(): void {
    if (!this.ephemeralAudioDir) return
    rmSync(this.ephemeralAudioDir, { recursive: true, force: true })
    this.ephemeralAudioDir = null
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.drainTimer) clearTimeout(this.drainTimer)
    if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
    // Quit mid-recording: chunks stay for next-launch recovery.
    this.recorder?.abort()
    this.recorder = null
    this.removeEphemeralAudio()
    this.child?.kill()
    this.child = null
    this.listeners.clear()
    this.warmupListeners.clear()
    this.warmupWaiters.clear()
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
