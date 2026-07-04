import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import type {
  EngineCommand,
  EngineEvent,
  EngineSidecarEvent,
  EngineStartOptions
} from '../shared/engine-events'

export type EngineEventListener = (event: EngineEvent) => void

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

  constructor(private readonly binaryPath: string) {}

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get running(): boolean {
    return this.child !== null
  }

  start(command: EngineCommand, filePath?: string, opts: EngineStartOptions = {}): void {
    // Only one sidecar at a time; a new start supersedes (hard-discards) the previous run.
    this.discard()

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
    const child = this.child
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 3000)
      forceKill.unref()
      child.once('close', () => clearTimeout(forceKill))
    }
  }

  /**
   * Hard-discard the current child when a new run supersedes it (or on app
   * quit): detach listeners first so the old child's tail events can't leak
   * into the new run, then kill. Reports the stop synthetically since the
   * real close event can no longer reach anyone.
   */
  private discard(): void {
    if (!this.child) return
    const child = this.child
    this.child = null
    this.stdoutBuffer = ''
    child.removeAllListeners()
    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
      forceKill.unref()
      child.once('close', () => clearTimeout(forceKill))
    }
    this.emit({ event: 'exit', code: null, signal: 'SIGTERM' })
  }

  /** Kill the sidecar on app shutdown. */
  dispose(): void {
    this.discard()
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
    for (const listener of this.listeners) listener(event)
  }
}
