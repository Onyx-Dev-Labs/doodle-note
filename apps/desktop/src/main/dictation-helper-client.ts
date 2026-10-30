import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import type {
  HelperDelivery,
  HelperStatus,
  HoldFailure,
  HoldKey,
  TargetDescription
} from '../shared/dictation-helper-protocol'

type HelperChild = ChildProcessByStdio<Writable, Readable, Readable>
type Reply = { event: 'reply'; id: string; ok: boolean; reason?: string } & Record<string, unknown>

export interface HelperLaunch {
  command: string
  args?: string[]
}

export interface HelperTimeouts {
  status: number
  snapshot: number
  deliver: number
  hold: number
}

export const DEFAULT_HELPER_TIMEOUTS: HelperTimeouts = {
  status: 2_000,
  snapshot: 1_500,
  deliver: 4_000,
  hold: 2_000
}

/**
 * Owns the native dictation helper process. Requests carry ids and deadlines;
 * the helper is started lazily and restarted on demand after a crash, with its
 * hold-key watch re-armed. It never receives a credential or provider key.
 */
export class DictationHelperClient {
  private child: HelperChild | null = null
  private ready: Promise<boolean> | null = null
  private buffer = ''
  private disposed = false
  private readonly pending = new Map<
    string,
    { resolve: (reply: Reply | null) => void; timer: NodeJS.Timeout }
  >()
  private holdKey: HoldKey = 'off'
  private readonly holdListeners = new Set<(event: HoldEvent) => void>()
  private readonly exitListeners = new Set<() => void>()
  private lastExitAt = 0

  constructor(
    private readonly launch: HelperLaunch,
    private readonly timeouts: HelperTimeouts = DEFAULT_HELPER_TIMEOUTS
  ) {}

  get available(): boolean {
    return existsSync(this.launch.command)
  }

  onHold(listener: (event: HoldEvent) => void): () => void {
    this.holdListeners.add(listener)
    return () => this.holdListeners.delete(listener)
  }

  /** Fires whenever the helper process ends, expectedly or not. */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async status(): Promise<HelperStatus | null> {
    const reply = await this.request('status', {}, this.timeouts.status)
    if (!reply?.ok) return null
    return {
      accessibility: reply.accessibility === true,
      inputMonitoring: reply.inputMonitoring === true,
      secureInput: reply.secureInput === true,
      conflicts: Array.isArray(reply.conflicts)
        ? reply.conflicts.filter((c): c is string => typeof c === 'string')
        : [],
      holdActive: reply.holdActive === true
    }
  }

  /** The focused app and control right now; null when the helper cannot say. */
  async snapshot(snapshotId: string): Promise<TargetDescription | null> {
    const reply = await this.request('snapshot', { snapshotId }, this.timeouts.snapshot)
    if (!reply?.ok) return null
    return {
      snapshotId: String(reply.snapshotId ?? snapshotId),
      pid: Number(reply.pid ?? 0),
      bundleId: String(reply.bundleId ?? ''),
      appName: String(reply.appName ?? ''),
      hasElement: reply.hasElement === true,
      accessibility: reply.accessibility === true,
      ...(typeof reply.role === 'string' ? { role: reply.role } : {}),
      ...(typeof reply.secure === 'boolean' ? { secure: reply.secure } : {}),
      ...(typeof reply.editable === 'boolean' ? { editable: reply.editable } : {})
    }
  }

  /**
   * Insert text once. If the helper dies or stalls mid-request the outcome is
   * `uncertain`, never a silent failure: the text may already be in the target,
   * so the caller keeps it and must not resend.
   */
  async deliver(snapshotId: string, text: string): Promise<HelperDelivery> {
    if (!(await this.ensureRunning())) {
      return {
        outcome: 'refused',
        reason: 'helper-unavailable',
        verified: false,
        clipboard: 'untouched'
      }
    }
    const reply = await this.request('deliver', { snapshotId, text }, this.timeouts.deliver, false)
    if (!reply) {
      return {
        outcome: 'uncertain',
        reason: 'helper-timeout',
        verified: false,
        clipboard: 'untouched'
      }
    }
    const outcome = reply.outcome
    return {
      outcome:
        outcome === 'delivered' || outcome === 'uncertain' || outcome === 'refused'
          ? outcome
          : 'failed',
      ...(typeof reply.reason === 'string' ? { reason: reply.reason } : {}),
      ...(reply.method === 'ax' || reply.method === 'paste' ? { method: reply.method } : {}),
      verified: reply.verified === true,
      clipboard: typeof reply.clipboard === 'string' ? reply.clipboard : 'untouched'
    }
  }

  release(snapshotId: string): void {
    if (this.child) void this.request('release', { snapshotId }, this.timeouts.hold, false)
  }

  /** Arm or disarm hold-to-talk. Remembered so a restarted helper re-arms it. */
  async setHoldKey(key: HoldKey): Promise<HoldFailure | null> {
    if (key === 'off') {
      this.holdKey = 'off'
      if (this.child) await this.request('hold-stop', {}, this.timeouts.hold, false)
      return null
    }
    // Start the process before remembering the key: the restart hook re-arms a
    // remembered key, and a first start must not be armed twice.
    const running = await this.ensureRunning()
    this.holdKey = key
    if (!running) return 'helper-unavailable'
    const reply = await this.request('hold-start', { key, minHoldMs: 150 }, this.timeouts.hold)
    if (!reply) return 'helper-unavailable'
    if (reply.ok) return null
    return reply.reason === 'unknown-key' ? 'unknown-key' : 'input-monitoring-denied'
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.holdKey = 'off'
    this.failAll()
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) {
      child.stdin.end()
      child.kill('SIGTERM')
    }
  }

  /* ---- plumbing ---- */

  private ensureRunning(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.child && this.ready) return this.ready
    if (!this.available) return Promise.resolve(false)
    // Do not spin on a helper that dies immediately.
    if (Date.now() - this.lastExitAt < 500) return Promise.resolve(false)
    let child: HelperChild
    try {
      child = spawn(this.launch.command, this.launch.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch {
      return Promise.resolve(false)
    }
    this.child = child
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim()) console.error(line.trim())
    })
    child.stdin.on('error', () => {})
    this.ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3_000)
      const settle = (ok: boolean): void => {
        clearTimeout(timer)
        resolve(ok)
      }
      child.stdout.on('data', (chunk: string) => {
        if (this.child !== child) return
        this.buffer += chunk
        for (let nl = this.buffer.indexOf('\n'); nl !== -1; nl = this.buffer.indexOf('\n')) {
          const line = this.buffer.slice(0, nl)
          this.buffer = this.buffer.slice(nl + 1)
          if (this.handleLine(line)) settle(true)
        }
      })
      child.on('error', () => settle(false))
      child.on('close', () => {
        settle(false)
        if (this.child !== child) return
        this.child = null
        this.ready = null
        this.lastExitAt = Date.now()
        this.failAll()
        for (const listener of this.exitListeners) listener()
      })
    })
    // Re-arm the hold watch on the fresh process.
    void this.ready.then((ok) => {
      if (ok && this.holdKey !== 'off' && this.child === child) {
        void this.request(
          'hold-start',
          { key: this.holdKey, minHoldMs: 150 },
          this.timeouts.hold,
          false
        )
      }
    })
    return this.ready
  }

  /** Returns true when the helper announced readiness. */
  private handleLine(raw: string): boolean {
    const line = raw.trim()
    if (!line) return false
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      return false
    }
    if (parsed.event === 'ready') return true
    if (parsed.event === 'hold') {
      const phase = parsed.phase === 'down' || parsed.phase === 'up' ? parsed.phase : null
      const holdId = Number(parsed.holdId)
      if (phase && Number.isInteger(holdId)) {
        for (const listener of this.holdListeners) listener({ phase, holdId })
      }
      return false
    }
    if (parsed.event === 'reply' && typeof parsed.id === 'string') {
      const entry = this.pending.get(parsed.id)
      if (entry) {
        clearTimeout(entry.timer)
        this.pending.delete(parsed.id)
        entry.resolve(parsed as Reply)
      }
    }
    return false
  }

  private async request(
    op: string,
    fields: Record<string, unknown>,
    timeoutMs: number,
    start = true
  ): Promise<Reply | null> {
    if (start && !(await this.ensureRunning())) return null
    const child = this.child
    if (!child || child.exitCode !== null) return null
    const id = randomUUID()
    return new Promise<Reply | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      try {
        child.stdin.write(`${JSON.stringify({ op, id, ...fields })}\n`)
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(null)
      }
    })
  }

  private failAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve(null)
    }
    this.pending.clear()
  }
}

export interface HoldEvent {
  phase: 'down' | 'up'
  holdId: number
}
