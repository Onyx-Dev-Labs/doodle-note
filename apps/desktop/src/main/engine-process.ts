import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import type {
  EngineCommand,
  EngineEvent,
  EngineInputDevice,
  EngineSidecarEvent,
  EngineStartOptions
} from '../shared/engine-events'

export type EngineEventListener = (event: EngineEvent) => void

/**
 * How long dispose() waits for a finishing session to exit on its own before
 * escalating to SIGTERM/SIGKILL. Killing the engine mid-finish can strand its
 * ScreenCaptureKit teardown, which leaves a stale "System Audio Recording"
 * attribution in Control Center after the app is gone.
 */
export const FINISHING_EXIT_GRACE_MS = 4_000

/**
 * CaptureRegistry's synchronous ScreenCaptureKit stop is bounded at three
 * seconds. Keep the host's SIGKILL fallback beyond that bound so escalation
 * cannot interrupt the teardown it is meant to protect.
 */
export const CAPTURE_TEARDOWN_GRACE_MS = 4_000

/**
 * Shape produced by spawn(..., { stdio: ['pipe', 'pipe', 'pipe'] }).
 * stdin stays open but unused: it's the engine's parent-death watchdog — if
 * this process dies or hot-restarts, the OS closes the pipe and the engine
 * finishes its session instead of recording forever as an orphan.
 */
type EngineChild = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * Owns the transcription sidecar child process.
 *
 * Spawns `engine <stream|transcribe> --file <path> [--model m] [--realtime]`,
 * parses its NDJSON stdout line by line and forwards typed events to a
 * listener. stdout occasionally contains non-JSON diagnostic noise from
 * CoreML (e.g. "E5RT encountered an STL exception..."), so every line is
 * JSON.parsed inside a try/catch and unparseable lines are silently skipped.
 */
export class EngineProcess {
  private child: EngineChild | null = null
  private stdoutBuffer = ''
  private readonly listeners = new Set<EngineEventListener>()

  /* Persistent `serve` sidecar: models stay loaded across sessions. */
  private serveChild: EngineChild | null = null
  private serveBuffer = ''
  private serveReady = false
  private serveSessionActive = false
  private serveRestartTimer: NodeJS.Timeout | null = null
  private disposed = false
  /** True from the engine's "finishing" status until the session ends. */
  private sessionFinishing = false

  constructor(
    private readonly binaryPath: string,
    /** Overridable for tests; production uses the default. */
    private readonly finishingGraceMs = FINISHING_EXIT_GRACE_MS
  ) {}

  /**
   * Launch the persistent engine. Models load once here; live sessions then
   * start instantly via stdin commands. Restarts itself on crash; while it
   * is down (or still loading), live falls back to the classic per-session
   * spawn, so recording always works.
   */
  startServe(): void {
    if (this.serveChild || this.disposed || !existsSync(this.binaryPath)) return
    let child: EngineChild
    try {
      child = spawn(this.binaryPath, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      console.error('[engine serve] spawn failed:', err)
      return
    }
    this.serveChild = child
    this.serveBuffer = ''
    this.serveReady = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.serveChild !== child) return
      this.serveBuffer += chunk
      let nl = this.serveBuffer.indexOf('\n')
      while (nl !== -1) {
        const line = this.serveBuffer.slice(0, nl)
        this.serveBuffer = this.serveBuffer.slice(nl + 1)
        this.handleServeLine(line)
        nl = this.serveBuffer.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim().length > 0) console.error(`[engine serve] ${line}`)
      }
    })
    child.on('error', (err) => {
      console.error('[engine serve] error:', err.message)
    })
    child.on('close', () => {
      if (this.serveChild !== child) return
      this.serveChild = null
      this.serveReady = false
      // A crash mid-session must end the session for the renderer too.
      if (this.serveSessionActive) {
        this.serveSessionActive = false
        this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
      }
      if (!this.disposed) {
        this.serveRestartTimer = setTimeout(() => this.startServe(), 5_000)
        this.serveRestartTimer.unref()
      }
    })
  }

  private handleServeLine(rawLine: string): void {
    const line = rawLine.trim()
    if (line.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return // CoreML noise
    }
    const event = parsed as { event?: string; stage?: string }
    if (typeof event.event !== 'string') return
    if (event.event === 'status' && event.stage === 'serve_ready') {
      this.serveReady = true
      return
    }
    if (event.event === 'status' && event.stage === 'serve_loading_models') return
    // Session events flow only while a session is active — boot noise stays out.
    if (!this.serveSessionActive) return
    this.emit(parsed as EngineSidecarEvent)
    if (event.event === 'done') {
      this.serveSessionActive = false
      // The legacy path signalled session end with the child's exit; serve
      // stays alive, so synthesize it for unchanged renderer semantics.
      this.emit({ event: 'exit', code: 0, signal: null })
    }
  }

  private serveWrite(command: object): boolean {
    const child = this.serveChild
    if (!child) return false
    try {
      child.stdin.write(`${JSON.stringify(command)}\n`)
      return true
    } catch {
      return false
    }
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Audio input devices, for the renderer's mic picker. Runs the cheap
   * `engine devices` command (no models, no permissions, returns instantly);
   * resolves [] on any failure so the picker just hides.
   */
  listInputDevices(): Promise<EngineInputDevice[]> {
    return new Promise((resolve) => {
      if (!existsSync(this.binaryPath)) {
        resolve([])
        return
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.binaryPath, ['devices'], { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch {
        resolve([])
        return
      }
      let out = ''
      let settled = false
      const finish = (devices: EngineInputDevice[]): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(devices)
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        finish([])
      }, 5_000)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.on('error', () => finish([]))
      child.on('close', () => {
        for (const line of out.split('\n')) {
          try {
            const parsed = JSON.parse(line) as {
              event?: string
              inputs?: Array<{ uid?: string; name?: string; default?: boolean }>
            }
            if (parsed.event === 'devices' && Array.isArray(parsed.inputs)) {
              finish(
                parsed.inputs
                  .filter((d) => typeof d.uid === 'string' && typeof d.name === 'string')
                  .map((d) => ({
                    uid: d.uid as string,
                    name: d.name as string,
                    isDefault: d.default === true
                  }))
              )
              return
            }
          } catch {
            // Not the devices line — keep scanning.
          }
        }
        finish([])
      })
    })
  }

  /** Spawn `engine tap-selftest` and parse its verdict. */
  tapSelfTest(): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
      if (!existsSync(this.binaryPath)) {
        resolve({ ok: false, reason: 'engine binary not found' })
        return
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.binaryPath, ['tap-selftest'], { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch (err) {
        resolve({ ok: false, reason: String(err) })
        return
      }
      let out = ''
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ ok: false, reason: 'self-test timed out' })
      }, 30_000)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.on('error', () => {
        clearTimeout(timeout)
        resolve({ ok: false, reason: 'engine failed to start' })
      })
      child.on('close', () => {
        clearTimeout(timeout)
        for (const line of out.split('\n')) {
          try {
            const parsed = JSON.parse(line) as { event?: string; ok?: boolean; reason?: string }
            if (parsed.event === 'tap_selftest') {
              resolve({
                ok: parsed.ok === true,
                ...(parsed.reason ? { reason: parsed.reason } : {})
              })
              return
            }
          } catch {
            // not the verdict line
          }
        }
        resolve({ ok: false, reason: 'no verdict from the engine' })
      })
    })
  }

  /**
   * Point the mic channel at a different input device. Applies live when a
   * session is running (serve or classic spawn — both parse stdin commands);
   * otherwise it's a no-op and the next start's opts carry the choice.
   */
  setInputDevice(uid: string | null): void {
    const command = { cmd: 'set-input', uid: uid ?? '' }
    if (this.serveSessionActive) {
      this.serveWrite(command)
      return
    }
    const child = this.child
    if (!child) return
    try {
      child.stdin.write(`${JSON.stringify(command)}\n`)
    } catch {
      // Session is tearing down — the next start picks up the new device.
    }
  }

  get running(): boolean {
    return this.child !== null || this.serveSessionActive
  }

  start(command: EngineCommand, filePath?: string, opts: EngineStartOptions = {}): void {
    // Only one sidecar at a time; a new start supersedes (hard-discards) the previous run.
    this.discard()

    // Instant path: the persistent engine has models loaded and is idle.
    if (command === 'live' && this.serveReady && this.serveChild && !this.serveSessionActive) {
      this.serveSessionActive = true
      this.emit({ event: 'started', command, filePath, binaryPath: this.binaryPath })
      const ok = this.serveWrite({
        cmd: 'start',
        source: opts.source ?? 'both',
        inputDevice: opts.inputDevice ?? '',
        audioDir: opts.audioDir ?? '',
        systemBackend: opts.systemBackend ?? ''
      })
      if (ok) return
      this.serveSessionActive = false // fall through to the classic spawn
    }
    // A superseding start while a serve session runs: hard-restart serve (its
    // tail events must not leak into the new session) and use the classic
    // spawn for this one.
    if (command === 'live' && this.serveSessionActive) {
      this.restartServe()
    }

    if (command !== 'stream' && command !== 'transcribe' && command !== 'live') {
      this.emit({ event: 'spawn-error', message: `Unknown engine command: ${String(command)}` })
      return
    }
    if (command !== 'live' && (!filePath || typeof filePath !== 'string')) {
      this.emit({ event: 'spawn-error', message: 'No audio file path provided.' })
      return
    }
    if (!existsSync(this.binaryPath)) {
      this.emit({
        event: 'spawn-error',
        message:
          `Engine binary not found at ${this.binaryPath}. ` +
          'Build it with `pnpm engine:build` from the repo root.'
      })
      return
    }

    const args: string[] = [command]
    if (command === 'live') {
      args.push('--source', opts.source ?? 'both')
      args.push('--exit-on-stdin-close')
      if (opts.inputDevice) args.push('--input-device', opts.inputDevice)
      if (opts.audioDir) args.push('--audio-dir', opts.audioDir)
      if (opts.systemBackend) args.push('--system-backend', opts.systemBackend)
      if (typeof opts.seconds === 'number' && opts.seconds > 0) {
        args.push('--seconds', String(opts.seconds))
      }
    } else {
      args.push('--file', filePath as string)
      if (opts.model) args.push('--model', opts.model)
      if (opts.realtime) args.push('--realtime')
    }

    let child: EngineChild
    try {
      child = spawn(this.binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      this.emit({ event: 'spawn-error', message: `Failed to spawn engine: ${String(err)}` })
      return
    }

    this.child = child
    this.stdoutBuffer = ''
    this.emit({ event: 'started', command, filePath, binaryPath: this.binaryPath })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child === child) this.ingestStdout(chunk)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Sidecar diagnostics: not forwarded to the renderer, but logged so a
      // failed session leaves footprints in the dev terminal.
      for (const line of chunk.split('\n')) {
        if (line.trim().length > 0) console.error(`[engine] ${line}`)
      }
    })

    child.on('error', (err) => {
      if (this.child !== child) return
      this.child = null
      this.emit({
        event: 'spawn-error',
        message: `Failed to spawn engine at ${this.binaryPath}: ${err.message}`
      })
    })

    child.on('close', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      this.flushStdoutBuffer()
      this.emit({ event: 'exit', code, signal })
    })
  }

  /**
   * Graceful stop: SIGTERM while staying attached. The live engine finishes
   * its decode on SIGTERM and emits final/timings/done before exiting, so
   * those events must still reach the renderer; the real close event follows.
   * Escalates to SIGKILL if the sidecar hangs.
   */
  stop(): void {
    if (this.serveSessionActive) {
      this.serveWrite({ cmd: 'stop' })
      // If the serve engine wedges mid-finish, restart it — the close handler
      // ends the session for the renderer.
      const escalate = setTimeout(() => {
        if (this.serveSessionActive) this.restartServe()
      }, 25_000)
      escalate.unref()
      return
    }
    const child = this.child
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      // Generous grace period: on stop the engine may still be finishing model
      // warm-up and then has to transcribe all queued audio before it can emit
      // finals — killing it early throws the user's words away.
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 20_000)
      forceKill.unref()
      child.once('close', () => clearTimeout(forceKill))
    }
  }

  /**
   * Hard-discard the current child when a new run supersedes it (or on app
   * quit): detach listeners first so the old child's tail events can't leak
   * into the new run, then kill. Reports the stop synthetically since the
   * real close event can no longer reach anyone. A session caught mid-finish
   * gets `graceMs` to exit on its own first: killing the engine during the
   * finishing drain can strand its ScreenCaptureKit teardown (stale "System
   * Audio Recording" attribution in Control Center).
   */
  private discard(graceMs = 0): void {
    if (!this.child) return
    const child = this.child
    this.child = null
    this.stdoutBuffer = ''
    child.removeAllListeners()
    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    if (child.exitCode === null && child.signalCode === null) {
      const alive = (): boolean => child.exitCode === null && child.signalCode === null
      const escalate = (): void => {
        if (!alive()) return
        child.kill('SIGTERM')
        const forceKill = setTimeout(() => {
          if (alive()) child.kill('SIGKILL')
        }, CAPTURE_TEARDOWN_GRACE_MS)
        forceKill.unref()
        child.once('close', () => clearTimeout(forceKill))
      }
      if (graceMs > 0) {
        // Closing stdin tells the engine the host is going away (its
        // --exit-on-stdin-close watchdog); it drops its capture taps at once
        // and exits cleanly, usually well inside the grace window.
        try {
          child.stdin.end()
        } catch {
          // stdin already gone — the escalation timer still bounds the exit.
        }
        const grace = setTimeout(escalate, graceMs)
        grace.unref()
        child.once('close', () => clearTimeout(grace))
      } else {
        escalate()
      }
    }
    this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
  }

  /** Hard-restart the persistent engine (crash recovery / supersede). */
  private restartServe(): void {
    const child = this.serveChild
    this.serveChild = null
    this.serveReady = false
    if (this.serveSessionActive) {
      this.serveSessionActive = false
      this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
    }
    if (child) {
      child.removeAllListeners()
      child.stdout.removeAllListeners()
      child.stderr.removeAllListeners()
      if (child.exitCode === null && child.signalCode === null) {
        // SIGTERM first: the engine's signal handler tears its capture taps
        // down synchronously; an immediate SIGKILL would strand the
        // ScreenCaptureKit tap (stale Control Center attribution).
        child.kill('SIGTERM')
        const forceKill = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }, CAPTURE_TEARDOWN_GRACE_MS)
        forceKill.unref()
        child.once('close', () => clearTimeout(forceKill))
      }
    }
    if (!this.disposed) {
      this.serveRestartTimer = setTimeout(() => this.startServe(), 1_000)
      this.serveRestartTimer.unref()
    }
  }

  /**
   * Kill the sidecars on app shutdown. A session still finishing gets a grace
   * window to complete its capture teardown before we escalate to signals.
   */
  dispose(): void {
    this.disposed = true
    if (this.serveRestartTimer) clearTimeout(this.serveRestartTimer)
    const serve = this.serveChild
    this.serveChild = null
    if (serve && serve.exitCode === null && serve.signalCode === null) {
      serve.stdin.end() // its stdin watchdog exits it cleanly
    }
    this.discard(this.sessionFinishing ? this.finishingGraceMs : 0)
    this.listeners.clear()
  }

  /* ---- NDJSON line parsing ---- */

  private ingestStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex)
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      this.parseLine(line)
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  private flushStdoutBuffer(): void {
    const rest = this.stdoutBuffer
    this.stdoutBuffer = ''
    if (rest.trim().length > 0) this.parseLine(rest)
  }

  private parseLine(rawLine: string): void {
    const line = rawLine.trim()
    if (line.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // CoreML sometimes prints non-JSON diagnostic garbage on stdout; skip it.
      return
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { event?: unknown }).event === 'string'
    ) {
      this.emit(parsed as EngineSidecarEvent)
    }
  }

  private emit(event: EngineEvent): void {
    // Track the finishing window (stop acknowledged → session end) so dispose
    // knows when a kill would cut the engine's capture teardown short.
    if (event.event === 'status') {
      if (event.stage === 'finishing' || event.stage === 'saving_audio') {
        this.sessionFinishing = true
      }
    } else if (event.event === 'started' || event.event === 'done' || event.event === 'exit') {
      this.sessionFinishing = false
    }
    for (const listener of this.listeners) listener(event)
  }
}
