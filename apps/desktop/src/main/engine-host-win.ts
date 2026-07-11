import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import {
  ENGINE_CAPTURE_CONTROL_CHANNEL,
  type EngineCommand,
  type EngineEvent,
  type EngineSidecarEvent,
  type EngineStartOptions
} from '../shared/engine-events'
import type { EngineEventListener } from './engine-process'
import { WinSessionRecorder } from './win-audio-recorder'
import { join as joinPath } from 'node:path'

const RESTART_DELAY_MS = 3_000

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
  private restartTimer: NodeJS.Timeout | null = null
  private disposed = false
  private readonly listeners = new Set<EngineEventListener>()
  /** Tees renderer PCM frames to disk when the session persists audio. */
  private recorder: WinSessionRecorder | null = null

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
        this.sessionActive = false
        this.stopCaptureInRenderer()
        // Engine crashed mid-session: keep the checkpoint chunks on disk —
        // next launch's orphan recovery merges them.
        this.recorder?.abort()
        this.recorder = null
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
      return
    }
    // Model download/boot progress is host-side noise, not session traffic.
    if (!this.sessionActive) return
    this.emit(event as unknown as EngineSidecarEvent)
    if (event.event === 'done') {
      this.sessionActive = false
      this.stopCaptureInRenderer()
      // Merge the session's audio off the event path; the 'audio' event
      // follows 'exit' here (order is not part of the contract — listeners
      // react to each event independently).
      const recorder = this.recorder
      this.recorder = null
      if (recorder) {
        void recorder
          .finish()
          .then((saved) => {
            if (saved) {
              this.emit({
                event: 'audio',
                path: joinPath(recorder.dir, 'audio.wav'),
                durationMs: saved.durationMs,
                startEpochMs: saved.startEpochMs
              })
            }
          })
          .catch((err) => console.error('[win-audio] merge failed:', err))
      }
      this.emit({ event: 'exit', code: 0, signal: null })
    }
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
      // Supersede: end the old session; its tail events stop at 'done'.
      // Its unmerged audio stays on disk for orphan recovery.
      this.child.postMessage({ t: 'stop' })
      this.recorder?.abort()
      this.recorder = null
    }
    const source = opts.source ?? 'both'
    const channels = [
      source === 'mic' || source === 'both' ? 'mic' : null,
      source === 'system' || source === 'both' ? 'system' : null
    ].filter((c): c is string => c !== null)

    this.sessionActive = true
    this.recorder = opts.audioDir ? new WinSessionRecorder(opts.audioDir) : null
    this.emit({ event: 'started', command, filePath, binaryPath: 'sherpa-onnx (in-process)' })
    this.child.postMessage({ t: 'start', channels })
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, { action: 'start', channels })
  }

  stop(): void {
    if (!this.sessionActive || !this.child) return
    this.stopCaptureInRenderer()
    this.child.postMessage({ t: 'stop' })
    const escalate = setTimeout(() => {
      if (this.sessionActive && this.child) {
        this.child.kill() // exit handler synthesizes the session end
      }
    }, 15_000)
    escalate.unref()
  }

  /** Renderer capture frames land here (via ENGINE_AUDIO_CHANNEL). */
  pushAudio(channel: string, samples: Float32Array): void {
    if (!this.sessionActive || !this.child) return
    this.recorder?.write(channel, samples)
    this.child.postMessage({ t: 'audio', channel, samples })
  }

  /** Renderer-side capture failed (permission etc.) — surface + end session. */
  captureFailed(message: string): void {
    if (!this.sessionActive) return
    this.emit({ event: 'error', message })
    this.stop()
  }

  private stopCaptureInRenderer(): void {
    this.broadcast(ENGINE_CAPTURE_CONTROL_CHANNEL, { action: 'stop' })
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    // Quit mid-recording: chunks stay for next-launch recovery.
    this.recorder?.abort()
    this.recorder = null
    this.child?.kill()
    this.child = null
    this.listeners.clear()
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
