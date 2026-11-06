import { join } from 'node:path'
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
import { ImportCanceledError } from './import-jobs'

const RESTART_DELAY_MS = 3_000
const CAPTURE_DRAIN_TIMEOUT_MS = 2_000
/** After Stop, the worker is killed only if it makes no progress for this long. */
const WORKER_FINISH_IDLE_MS = 15_000
/**
 * The live worker holds about 1 GB of model memory. With no recording for this
 * long it is closed, and reloaded (about 2.5 s on Dev04) when the next one
 * starts; capture begins at once and its first frames are buffered meanwhile.
 */
export const IDLE_UNLOAD_MS = 5 * 60_000

export interface WinEngineHostOptions {
  idleUnloadMs?: number
}

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
  private captureState: 'idle' | 'starting' | 'capturing' | 'draining' | 'finishing' | 'saving' =
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

  private idleTimer: NodeJS.Timeout | null = null
  /** The worker was closed while idle; the next start reloads it. */
  private unloaded = false
  private unloading = false
  private keepWarm = false
  /** Frames captured while a reloading worker loads its model. */
  private pendingFrames: Array<{ channel: string; samples: Float32Array; sentAt: number }> = []
  private startAfterReload = false
  private stopAfterReload = false
  private readonly idleUnloadMs: number

  constructor(
    private readonly broadcast: (channel: string, payload: unknown) => void,
    options: WinEngineHostOptions = {}
  ) {
    this.idleUnloadMs = options.idleUnloadMs ?? IDLE_UNLOAD_MS
  }

  /**
   * Keep the model loaded while idle (for features that need instant starts,
   * such as dictation). Off by default.
   */
  setKeepWarm(on: boolean): void {
    this.keepWarm = on
    if (on) {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = null
      if (this.unloaded && !this.child) this.reload()
    } else this.armIdleTimer()
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (
      this.keepWarm ||
      this.disposed ||
      this.sessionActive ||
      !this.ready ||
      this.idleUnloadMs <= 0
    )
      return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.sessionActive || this.keepWarm || !this.child || !this.ready) return
      this.unloading = true
      this.ready = false
      this.child.kill()
    }, this.idleUnloadMs)
    this.idleTimer.unref()
  }

  private reload(): void {
    this.unloaded = false
    this.startServe()
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get running(): boolean {
    return this.sessionActive
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
    child.on('exit', (code) => {
      if (this.child !== child) return
      if (this.unloading) {
        // Deliberate idle close: setup stays complete; nothing restarts.
        this.unloading = false
        this.unloaded = true
        this.child = null
        return
      }
      const failedDuringWarmup = !this.ready && !this.sessionActive && !this.warmupResult?.ok
      this.child = null
      this.ready = false
      if (failedDuringWarmup && !this.disposed) {
        const message = `The Windows transcription engine exited during setup (${code}). Try again; a damaged speech model is verified and downloaded again.`
        this.finishWarmup(
          { ok: false, micGranted: false, screenGranted: false, error: message },
          { stage: 'error', message }
        )
      }
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
        this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
      }
      if (!this.disposed && !failedDuringWarmup) {
        this.restartTimer = setTimeout(() => this.startServe(), RESTART_DELAY_MS)
        this.restartTimer.unref()
      }
    })

    this.postInit()
  }

  private postInit(): void {
    this.child?.postMessage({ t: 'init', modelsDir: join(app.getPath('userData'), 'asr-models') })
  }

  private handleEngineEvent(event: Record<string, unknown>): void {
    if (event.event === 'status' && event.stage === 'serve_ready') {
      // Diagnostics only: model, measured decode cost and caption mode.
      console.info(
        `[win-asr] ready model=${String(event.model ?? '')} loadMs=${String(event.loadMs ?? '')} calibrationRtf=${String(event.calibrationRtf ?? '')} captionMode=${String(event.captionMode ?? '')}`
      )
      this.ready = true
      this.finishWarmup({ ok: true, micGranted: false, screenGranted: false }, { stage: 'ready' })
      if (this.sessionActive) this.resumeAfterReload()
      else this.armIdleTimer()
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
    // A slow machine may still be decoding queued speech after Stop; each
    // decoded utterance is progress, so only a silent worker is killed.
    if (this.captureState === 'finishing' && this.workerFinishTimer) this.armWorkerFinishTimer()
    if (event.event === 'done') {
      if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
      this.workerFinishTimer = null
      void this.completeSession()
      return
    }
    this.emit(event as unknown as EngineSidecarEvent)
  }

  private async completeSession(): Promise<void> {
    if (!this.sessionActive || this.captureState === 'saving') return
    this.captureState = 'saving'
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = null
    const sessionId = this.activeSessionId
    if (sessionId !== null) this.stopCaptureInRenderer(sessionId)
    const recorder = this.recorder
    this.recorder = null
    try {
      const saved = await recorder?.finish()
      if (saved && recorder) {
        this.emit({
          event: 'audio',
          path: joinPath(recorder.dir, 'audio.wav'),
          durationMs: saved.durationMs,
          startEpochMs: saved.startEpochMs
        })
      }
    } catch (error) {
      console.error('[win-audio] merge failed:', error)
    }

    if (this.disposed || !this.sessionActive || this.activeSessionId !== sessionId) return
    this.sessionActive = false
    this.captureState = 'idle'
    this.activeSessionId = null
    this.workerStarted = false
    this.emit({ event: 'done' })
    this.emit({ event: 'exit', code: 0, signal: null })
    this.armIdleTimer()
  }

  start(command: EngineCommand, filePath?: string, opts: EngineStartOptions = {}): void {
    if (command !== 'live') {
      this.emit({
        event: 'spawn-error',
        message: `The "${command}" engine command is not available on Windows.`
      })
      return
    }
    const reloading = this.unloaded && !this.child && !this.disposed
    if (!reloading && !this.child && this.warmupResult && !this.warmupResult.ok && !this.disposed) {
      // Setup failed earlier (for example a damaged model crashed the loader):
      // this request starts the engine again, which verifies and repairs it.
      void this.preflight().catch(() => {})
      this.emit({
        event: 'spawn-error',
        message:
          'The speech engine is restarting to check its model. Try recording again in a moment.'
      })
      return
    }
    if (!reloading && (!this.child || !this.ready)) {
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

    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.sessionActive = true
    this.captureState = 'starting'
    this.pendingFrames = []
    this.startAfterReload = false
    this.stopAfterReload = false
    if (reloading) this.reload()
    this.activeSessionId = ++this.nextSessionId
    this.workerStarted = false
    this.activeChannels = channels
    this.inputDevice = opts.inputDevice
    // Audio is written only when the session persists it; with no post-stop
    // refinement pass there is no temporary copy any more.
    this.recorder = opts.audioDir ? new WinSessionRecorder(opts.audioDir) : null
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
    if (
      this.captureState === 'draining' ||
      this.captureState === 'finishing' ||
      this.captureState === 'saving'
    )
      return
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
    if (!this.sessionActive || this.captureState !== 'draining') return
    if (!this.child && !this.startAfterReload) return
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = null
    this.captureState = 'finishing'
    if (this.startAfterReload) {
      // Stopped before the reloading worker was ready: transcribe the buffered
      // frames as soon as it is, then finish.
      this.stopAfterReload = true
      this.armWorkerFinishTimer()
      return
    }
    if (this.workerStarted && this.child) {
      this.child.postMessage({ t: 'stop', sessionId: this.activeSessionId })
    } else {
      this.handleEngineEvent({ event: 'done' })
      return
    }
    this.armWorkerFinishTimer()
  }

  private armWorkerFinishTimer(): void {
    if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
    this.workerFinishTimer = setTimeout(() => {
      if (this.sessionActive && this.captureState === 'finishing' && this.child) {
        this.child.kill() // exit handler synthesizes the session end
      }
    }, WORKER_FINISH_IDLE_MS)
    this.workerFinishTimer.unref()
  }

  /** Renderer capture frames land here (via ENGINE_AUDIO_CHANNEL). */
  pushAudio(sessionId: number, channel: string, samples: Float32Array): void {
    if (
      !this.sessionActive ||
      sessionId !== this.activeSessionId ||
      (this.captureState !== 'capturing' && this.captureState !== 'draining')
    ) {
      return
    }
    if (this.startAfterReload) {
      this.recorder?.write(channel, samples)
      this.pendingFrames.push({ channel, samples, sentAt: Date.now() })
      return
    }
    if (!this.child || !this.workerStarted) return
    this.recorder?.write(channel, samples)
    this.child.postMessage({ t: 'audio', sessionId, channel, samples, sentAt: Date.now() })
  }

  /** Renderer capture lifecycle acknowledgements and actionable errors. */
  captureStatus(status: EngineCaptureStatus): void {
    if (!status || typeof status.sessionId !== 'number' || typeof status.type !== 'string') return
    if (!this.sessionActive || status.sessionId !== this.activeSessionId) return
    if (status.type === 'ready' && this.captureState === 'starting' && !this.ready) {
      // Capture runs while the worker reloads its model; frames are buffered.
      this.captureState = 'capturing'
      this.startAfterReload = true
      return
    }
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

  /** A reloaded worker is ready mid-session: start it and hand over buffered audio. */
  private resumeAfterReload(): void {
    if (!this.startAfterReload || !this.child || this.activeSessionId === null) return
    this.startAfterReload = false
    this.workerStarted = true
    const sessionId = this.activeSessionId
    this.child.postMessage({ t: 'start', sessionId, channels: this.activeChannels })
    for (const frame of this.pendingFrames) {
      this.child.postMessage({ t: 'audio', sessionId, ...frame })
    }
    this.pendingFrames = []
    if (this.stopAfterReload) {
      this.stopAfterReload = false
      this.child.postMessage({ t: 'stop', sessionId })
      this.armWorkerFinishTimer()
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

  /** Cancel only this wait; the shared engine keeps warming up for other consumers. */
  preflight(
    onEvent?: (event: WizardPreflightEvent) => void,
    signal?: AbortSignal
  ): Promise<WizardPreflightResult> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        if (onEvent) this.warmupListeners.delete(onEvent)
        this.warmupWaiters.delete(finish)
        signal?.removeEventListener('abort', abort)
      }
      const finish = (result: WizardPreflightResult): void => {
        cleanup()
        resolve(result)
      }
      const abort = (): void => {
        cleanup()
        reject(new ImportCanceledError())
      }
      if (signal?.aborted) {
        abort()
        return
      }
      // A failed model download (offline, stalled) is retried on the next
      // request; the verified partial download resumes where it stopped.
      // A worker that died while loading (a damaged model can abort the native
      // loader) is started again on request; it verifies and repairs the model.
      if (this.warmupResult && !this.warmupResult.ok && !this.disposed) {
        this.warmupResult = null
        this.lastWarmupEvent = { stage: 'models' }
        if (this.child) this.postInit()
        else this.startServe()
      }
      this.warmupWaiters.add(finish)
      if (onEvent) this.warmupListeners.add(onEvent)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        onEvent?.(this.lastWarmupEvent)
        if (this.warmupResult) finish(this.warmupResult)
      } catch (error) {
        cleanup()
        reject(error)
      }
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

  dispose(): void {
    this.disposed = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.drainTimer) clearTimeout(this.drainTimer)
    if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
    // Quit mid-recording: chunks stay for next-launch recovery.
    this.recorder?.abort()
    this.recorder = null
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
