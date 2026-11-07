import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import {
  ENGINE_CAPTURE_CONTROL_CHANNEL,
  type EngineCaptureControl,
  type EngineCaptureStatus,
  type EngineCommand,
  type EngineEvent,
  type EngineSidecarEvent,
  type EngineStartOptions
} from '../shared/engine-events'
import type { EngineEventListener } from './engine-process'
import { WinSessionRecorder } from './win-audio-recorder'
import { PARAKEET_UNIFIED } from './windows-asr-models'
import { join as joinPath } from 'node:path'
import type { WizardPreflightEvent, WizardPreflightResult } from '../shared/wizard-api'
import { ImportCanceledError } from './import-jobs'

const RESTART_DELAY_MS = 3_000
const CAPTURE_DRAIN_TIMEOUT_MS = 2_000
/** After Stop, the worker is killed only if it makes no progress for this long. */
const WORKER_FINISH_IDLE_MS = 15_000
/**
 * The live worker holds about 765 MB of model memory when idle. With no
 * recording for this long it is closed, and reloaded (about 4.7 s to the first
 * decode on Dev04) when the next one starts; capture begins at once and its
 * frames are buffered meanwhile.
 */
export const IDLE_UNLOAD_MS = 5 * 60_000

/** At most this much audio (both channels) waits for a reloading worker: 2 minutes. */
const MAX_PENDING_SAMPLES = 2 * 2 * 60 * 16_000
/** Silence standing in for audio past that cap is handed over a second at a time. */
const SILENCE_FRAME_SAMPLES = 16_000

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
  /** The worker is downloading Parakeet in the background (upgrade fallback). */
  private backgroundDownload = false
  /** The live model the worker loaded (serve_ready); dictation needs the preferred Parakeet. */
  private liveModelName: string | null = null
  /** Background Parakeet download progress 0..1 while the worker runs on the fallback model. */
  private parakeetDownloadProgress: number | null = null
  /** Frames captured while a reloading worker loads its model. */
  private pendingFrames: Array<{ channel: string; samples: Float32Array; sentAt: number }> = []
  private startAfterReload = false
  private pendingSamples = 0
  /** Per channel, audio past the buffer cap: saved, and stood in for by silence. */
  private droppedSamples = new Map<string, number>()
  /** The first live calibration, reused when the worker reloads. */
  private calibration: { calibrationRtf: number; captionMode: string } | null = null
  private stopAfterReload = false
  private readonly idleUnloadMs: number
  /**
   * Dictation's capture runs in its own hidden window (raw microphone, no meeting
   * processing); its control messages go there instead of to every window.
   */
  private dictationSink: ((control: EngineCaptureControl) => void) | null = null
  private sessionProfile: 'dictation' | null = null
  /** The session asked for microphone `level` events (dictation's meter). */
  private sessionLevels = false

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
      this.backgroundDownload ||
      this.disposed ||
      this.sessionActive ||
      !this.ready ||
      this.idleUnloadMs <= 0
    )
      return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (
        this.sessionActive ||
        this.keepWarm ||
        this.backgroundDownload ||
        !this.child ||
        !this.ready
      )
        return
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

  /** True while the worker has its model loaded, so a start is immediate. */
  get warm(): boolean {
    return this.ready && this.child !== null && !this.unloaded
  }

  /**
   * Whether dictation may run on the live model. Bark needs the preferred Parakeet, which gives
   * the accuracy the Mac does; a fresh install serves the weaker legacy Zipformer while Parakeet
   * downloads in the background, and Bark refuses until it is ready (matching the Mac, which never
   * dictates on a weaker model).
   */
  dictationModelState(): {
    ready: boolean
    downloadProgress: number | null
    usingFallback: boolean
  } {
    const onParakeet = this.liveModelName === PARAKEET_UNIFIED.name
    const usingFallback = this.liveModelName !== null && !onParakeet
    return {
      ready: this.warm && onParakeet,
      downloadProgress: this.parakeetDownloadProgress,
      usingFallback
    }
  }

  /** Where dictation's capture control messages go (the dictation capture window). */
  setDictationCaptureSink(sink: ((control: EngineCaptureControl) => void) | null): void {
    this.dictationSink = sink
  }

  /**
   * Why a live start would be refused right now, in the words start() would use;
   * null when it would go ahead. Lets callers that are not the recorder ask first.
   */
  liveStartRefusal(): string | null {
    if (this.disposed) return 'The speech engine is shutting down.'
    if (this.sessionActive) return 'The speech engine is busy with another session.'
    const reloading = this.unloaded && !this.child
    if (!reloading && !this.child && this.warmupResult && !this.warmupResult.ok)
      return 'The speech engine is restarting to check its model. Try again in a moment.'
    if (!reloading && (!this.child || !this.ready))
      return 'The speech engine is still loading its model. Try again in a moment.'
    return null
  }

  /**
   * Start a live session only if nothing else is using the engine, the way
   * EngineProcess.tryStartLive does on macOS. Never supersedes a meeting.
   */
  tryStartLive(
    opts: EngineStartOptions = {}
  ): { started: true } | { started: false; reason: string } {
    const refusal = this.liveStartRefusal()
    if (refusal) return { started: false, reason: refusal }
    this.start('live', undefined, opts)
    return { started: true }
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
      this.backgroundDownload = false
      if (this.sessionActive && this.startAfterReload) {
        // Crashed while reloading for this recording: finish it the same way
        // as a reload error, merging its audio now. The next recording
        // starts a fresh worker, which verifies (and repairs) the model.
        this.child = null
        this.ready = false
        this.unloaded = true
        this.failReloadDuringSession(
          `the speech engine stopped while loading its model (exit code ${String(code)}).`
        )
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
    this.child?.postMessage({
      t: 'init',
      modelsDir: join(app.getPath('userData'), 'asr-models'),
      ...(this.calibration ? { calibration: this.calibration } : {})
    })
  }

  private handleEngineEvent(event: Record<string, unknown>): void {
    if (event.event === 'status' && event.stage === 'serve_ready') {
      this.liveModelName = typeof event.model === 'string' ? event.model : null
      // Diagnostics only: model, measured decode cost and caption mode.
      console.info(
        `[win-asr] ready model=${String(event.model ?? '')} loadMs=${String(event.loadMs ?? '')} calibrationRtf=${String(event.calibrationRtf ?? '')} captionMode=${String(event.captionMode ?? '')}`
      )
      this.ready = true
      if (
        !this.calibration &&
        typeof event.calibrationRtf === 'number' &&
        (event.captionMode === 'interim' || event.captionMode === 'utterance')
      ) {
        this.calibration = { calibrationRtf: event.calibrationRtf, captionMode: event.captionMode }
      }
      this.finishWarmup({ ok: true, micGranted: false, screenGranted: false }, { stage: 'ready' })
      if (this.sessionActive) this.resumeAfterReload()
      else this.armIdleTimer()
      return
    }
    if (event.event === 'error' && this.sessionActive && this.startAfterReload) {
      this.failReloadDuringSession(String(event.message ?? 'the speech model could not be loaded'))
      return
    }
    if (event.event === 'status' && event.stage === 'model_download') {
      if (typeof event.progress === 'number') this.parakeetDownloadProgress = event.progress
      if (!this.backgroundDownload) {
        // Closing the worker now would abort the download it is running.
        this.backgroundDownload = true
        if (this.idleTimer) clearTimeout(this.idleTimer)
        this.idleTimer = null
      }
    }
    if (
      event.event === 'status' &&
      (event.stage === 'model_upgraded' || event.stage === 'model_download_failed')
    ) {
      this.backgroundDownload = false
      // On a successful upgrade the next serve_ready reports Parakeet; a failure leaves the fallback.
      if (event.stage === 'model_upgraded') this.liveModelName = PARAKEET_UNIFIED.name
      this.parakeetDownloadProgress = null
      if (!this.sessionActive) this.armIdleTimer()
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
    this.pendingSamples = 0
    this.droppedSamples.clear()
    this.startAfterReload = false
    this.stopAfterReload = false
    if (reloading) this.reload()
    this.activeSessionId = ++this.nextSessionId
    this.workerStarted = false
    this.activeChannels = channels
    this.inputDevice = opts.inputDevice
    this.sessionProfile = opts.captureProfile === 'dictation' ? 'dictation' : null
    this.sessionLevels = opts.levels === true
    // Audio is written only when the session persists it; with no post-stop
    // refinement pass there is no temporary copy any more.
    this.recorder = opts.audioDir ? new WinSessionRecorder(opts.audioDir) : null
    this.emit({ event: 'started', command, filePath, binaryPath: 'sherpa-onnx (in-process)' })
    this.sendCaptureControl({
      action: 'start',
      sessionId: this.activeSessionId,
      channels,
      ...(this.inputDevice ? { inputDevice: this.inputDevice } : {}),
      ...(this.sessionProfile ? { profile: this.sessionProfile } : {})
    })
  }

  /** Meetings: every window, as before (the main window captures). Dictation: its own window. */
  private sendCaptureControl(control: EngineCaptureControl): void {
    if (this.sessionProfile === 'dictation' && this.dictationSink) {
      this.dictationSink(control)
      return
    }
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, control)
  }

  /** Peak of one microphone frame, for the dictation meter. */
  private emitLevel(samples: Float32Array): void {
    let peak = 0
    for (let i = 0; i < samples.length; i++) {
      const value = Math.abs(samples[i] as number)
      if (value > peak) peak = value
    }
    this.emit({ event: 'level', channel: 'mic', peak: Math.min(1, peak) })
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
    if (this.sessionLevels && channel === 'mic') this.emitLevel(samples)
    if (this.startAfterReload) {
      this.recorder?.write(channel, samples)
      // Bounded: a reload takes seconds. Past the cap audio is still saved,
      // and silence stands in for it when the worker is ready.
      if (this.pendingSamples < MAX_PENDING_SAMPLES) {
        this.pendingFrames.push({ channel, samples, sentAt: Date.now() })
        this.pendingSamples += samples.length
      } else {
        this.droppedSamples.set(channel, (this.droppedSamples.get(channel) ?? 0) + samples.length)
      }
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

  /**
   * The worker reloading for this recording reported an error (for example
   * its model could not be prepared): end the capture cleanly, keeping and
   * merging its audio, instead of waiting for a transcript that cannot come.
   */
  private failReloadDuringSession(reason: string): void {
    this.startAfterReload = false
    this.stopAfterReload = false
    this.pendingFrames = []
    this.pendingSamples = 0
    this.droppedSamples.clear()
    if (this.workerFinishTimer) clearTimeout(this.workerFinishTimer)
    this.workerFinishTimer = null
    this.emit({
      event: 'error',
      message: `Transcription could not start: ${reason}${this.recorder ? ' The audio of this recording is saved; use Re-transcribe once the speech model is available.' : ''}`
    })
    // The next recording reloads a fresh worker.
    if (this.child) {
      this.unloading = true
      this.child.kill()
    }
    void this.completeSession()
  }

  /** A reloaded worker is ready mid-session: start it and hand over buffered audio. */
  private resumeAfterReload(): void {
    if (!this.startAfterReload || !this.child || this.activeSessionId === null) return
    this.startAfterReload = false
    this.workerStarted = true
    const sessionId = this.activeSessionId
    this.child.postMessage({ t: 'start', sessionId, channels: this.activeChannels })
    // Stamped now: the reload itself is not lag (it would show "running behind").
    const sentAt = Date.now()
    for (const frame of this.pendingFrames) {
      this.child.postMessage({ t: 'audio', sessionId, ...frame, sentAt })
    }
    // Audio past the cap is in the recording but not in the transcript: the
    // worker hears silence for it, so later words keep their place in time.
    let untranscribed = 0
    for (const [channel, dropped] of this.droppedSamples) {
      console.warn(
        `[win-asr] ${channel}: ${(dropped / 16_000).toFixed(1)} s recorded during a slow model load are not transcribed`
      )
      untranscribed = Math.max(untranscribed, dropped / 16_000)
      for (let left = dropped; left > 0; left -= SILENCE_FRAME_SAMPLES) {
        const samples = new Float32Array(Math.min(left, SILENCE_FRAME_SAMPLES))
        this.child.postMessage({ t: 'audio', sessionId, channel, samples, sentAt })
      }
    }
    this.pendingFrames = []
    this.pendingSamples = 0
    this.droppedSamples.clear()
    if (untranscribed > 0) {
      // A recorder notice, like captions_delayed: the user must know.
      this.emit({
        event: 'status',
        stage: 'audio_not_transcribed',
        seconds: Math.round(untranscribed)
      })
    }
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
    this.sendCaptureControl({
      action: 'switch-input',
      sessionId: this.activeSessionId as number,
      ...(this.inputDevice ? { inputDevice: this.inputDevice } : {}),
      ...(this.sessionProfile ? { profile: this.sessionProfile } : {})
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
    this.sendCaptureControl({
      action: 'stop',
      sessionId,
      ...(this.sessionProfile ? { profile: this.sessionProfile } : {})
    })
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
