import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import type {
  AppInfoEntry,
  DeliveryGuards,
  HelperDelivery,
  HelperDeliveryTimings,
  HelperStatus,
  HoldFailure,
  FieldReading,
  HoldKey,
  InputState,
  MouseCaptureResult,
  MouseMode,
  MouseStartResult,
  SelectionResult,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import {
  HELPER_DELIVER_MARGIN_MS,
  helperDeliverEstimateMs
} from '../shared/dictation-helper-protocol'

type HelperChild = ChildProcessByStdio<Writable, Readable, Readable>
type Reply = { event: 'reply'; id: string; ok: boolean; reason?: string } & Record<string, unknown>

export interface HelperLaunch {
  command: string
  args?: string[]
  /** Defaults to the running platform; only changes behavior on win32. */
  platform?: NodeJS.Platform
  /** Overrides the readiness timeout; for tests that exercise a late ready. */
  readyTimeoutMs?: number
}

/**
 * How long a Windows helper may take to leave after its stdin closes before it is
 * ended. Windows cannot deliver a catchable signal, and a forced end would skip the
 * helper's own clean-up (giving back muted sound, releasing hooks).
 */
export const WINDOWS_EXIT_GRACE_MS = 3_500

/**
 * How long to wait for a freshly started helper to announce itself. An unsigned .NET exe
 * can be scanned on first launch and take several seconds, so this is generous.
 */
export const WINDOWS_READY_TIMEOUT_MS = 15_000

/** Backoff between automatic helper restarts after a crash, capped. */
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]
/** A helper that stays up this long is considered healthy; the backoff resets only then. */
const HELPER_HEALTHY_MS = 60_000
/** A ceiling on automatic restarts per session, so a helper that always dies cannot spin forever. */
const MAX_RESTARTS_PER_SESSION = 20

/**
 * How long the client waits for a Windows delivery, and the elapsed-ms deadline it passes
 * the helper, both sized from the text length: the typing fallback is ~8 ms/char plus 70 ms
 * at each word boundary, so a long transcript must not time out and land later as doubled text.
 */
export function windowsDeliverBudget(text: string): { timeout: number; deadlineMs: number } {
  // The deadline must clear the helper's own estimate plus a margin, or a short transcript would
  // be refused instead of typed; the wait clears the deadline plus the reply's round trip.
  const estimate = helperDeliverEstimateMs(text)
  const deadlineMs = Math.min(60_000, estimate + HELPER_DELIVER_MARGIN_MS)
  const timeout = Math.min(90_000, deadlineMs + 2_000)
  return { timeout, deadlineMs }
}

/** spawn() error codes Windows reports when Application Control or Smart App Control blocks a program. */
const WINDOWS_BLOCKED_CODES = new Set(['UNKNOWN', 'EACCES', 'EPERM'])

export interface HelperTimeouts {
  status: number
  snapshot: number
  deliver: number
  hold: number
  /** How long a "press a mouse button" capture waits for the button. */
  capture: number
  /** A permission request returns once macOS has shown its dialog, not when it is answered. */
  permission: number
}

export const DEFAULT_HELPER_TIMEOUTS: HelperTimeouts = {
  status: 2_000,
  snapshot: 1_500,
  deliver: 4_000,
  hold: 2_000,
  capture: 12_000,
  permission: 5_000
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
  private mouse: { button: number; swallow: boolean; mode: MouseMode } | null = null
  private readonly holdListeners = new Set<(event: HoldEvent) => void>()
  private readonly tapListeners = new Set<() => void>()
  private readonly clickListeners = new Set<() => void>()
  private readonly exitListeners = new Set<() => void>()
  private lastExitAt = 0
  /** The last spawn error code, cleared once a helper announces readiness. */
  private launchError: string | null = null
  /** The sound output is silenced right now, so a crashed helper must be replaced to give it back. */
  private mutedOutput = false
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempts = 0
  private totalRestarts = 0
  private aliveTimer: NodeJS.Timeout | null = null
  /** True once the current child announced readiness (even if that arrived after the ready timeout). */
  private helperReady = false
  private readonly hookListeners = new Set<(phase: 'lost' | 'restored' | 'failed') => void>()

  constructor(
    private readonly launch: HelperLaunch,
    private readonly timeouts: HelperTimeouts = DEFAULT_HELPER_TIMEOUTS
  ) {}

  get available(): boolean {
    return existsSync(this.launch.command)
  }

  private get windows(): boolean {
    return (this.launch.platform ?? process.platform) === 'win32'
  }

  /**
   * Windows only: the helper exists but Windows would not start it (an unsigned
   * program held back by Application Control or Smart App Control). Always false on macOS.
   */
  get blocked(): boolean {
    return this.windows && this.launchError !== null && WINDOWS_BLOCKED_CODES.has(this.launchError)
  }

  onHold(listener: (event: HoldEvent) => void): () => void {
    this.holdListeners.add(listener)
    return () => this.holdListeners.delete(listener)
  }

  /** A quick press and release of the hold key that never became a hold. */
  onTap(listener: () => void): () => void {
    this.tapListeners.add(listener)
    return () => this.tapListeners.delete(listener)
  }

  /** The mouse trigger in click mode went down: one press, whatever follows. */
  onClick(listener: () => void): () => void {
    this.clickListeners.add(listener)
    return () => this.clickListeners.delete(listener)
  }

  /** Fires whenever the helper process ends, expectedly or not. */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  /** Windows: the low-level hooks were lost and re-installed (or could not be). */
  onHooks(listener: (phase: 'lost' | 'restored' | 'failed') => void): () => void {
    this.hookListeners.add(listener)
    return () => this.hookListeners.delete(listener)
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
      holdActive: reply.holdActive === true,
      mouseActive: reply.mouseActive === true,
      inputMonitoringAccess:
        reply.inputMonitoringAccess === 'granted' ||
        reply.inputMonitoringAccess === 'denied' ||
        reply.inputMonitoringAccess === 'not-determined'
          ? reply.inputMonitoringAccess
          : null,
      fnKeyAction: typeof reply.fnKeyAction === 'number' ? reply.fnKeyAction : null,
      hooksLive: typeof reply.hooksLive === 'boolean' ? reply.hooksLive : null
    }
  }

  /**
   * Mute and volume of the chosen microphone (null uid = the system default
   * input). Null when the helper is down or the device exposes neither.
   */
  async inputState(uid: string | null): Promise<InputState | null> {
    const reply = await this.request('input-state', uid ? { uid } : {}, this.timeouts.status)
    if (!reply?.ok) return null
    return {
      muted: typeof reply.muted === 'boolean' ? reply.muted : null,
      volume: typeof reply.volume === 'number' ? reply.volume : null
    }
  }

  /**
   * Silence the sound output until restoreOutput. True when this call silenced it;
   * false when it was already silent, cannot be silenced, or the helper is down.
   * Starts the helper if it is not running, since the sound must be able to come back.
   */
  async muteOutput(): Promise<boolean> {
    if (!(await this.ensureRunning())) return false
    const reply = await this.request('mute-output', {}, this.timeouts.status)
    const muted = reply?.ok === true && reply.outcome === 'muted'
    if (muted) this.mutedOutput = true
    return muted
  }

  /**
   * Give back the sound muteOutput took. Safe to call when nothing was muted. If the helper
   * crashed while the sound was muted, start a fresh one, which gives it back on launch.
   */
  async restoreOutput(): Promise<void> {
    // Windows: a helper that crashed while the sound was muted is replaced to give it back.
    // macOS keeps the base behaviour exactly: if there is no helper, there is nothing to do.
    if (!this.child) {
      if (!this.windows || !this.mutedOutput) return
      this.mutedOutput = false
      if (!(await this.ensureRunning())) return
    } else {
      this.mutedOutput = false
    }
    await this.request('restore-output', {}, this.timeouts.status)
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
      ...(typeof reply.appPath === 'string' && reply.appPath ? { appPath: reply.appPath } : {}),
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
  async deliver(
    snapshotId: string,
    text: string,
    guards: DeliveryGuards = {}
  ): Promise<HelperDelivery> {
    if (!(await this.ensureRunning())) {
      return {
        outcome: 'refused',
        reason: 'helper-unavailable',
        verified: false,
        clipboard: 'untouched'
      }
    }
    // Windows sizes the wait and the helper's deadline from the text length so a long
    // typing fallback never times out and lands later; macOS keeps its fixed deliver timeout.
    const budget = this.windows ? windowsDeliverBudget(text) : null
    const reply = await this.request(
      'deliver',
      {
        snapshotId,
        text,
        ...(guards.expectSelection !== undefined
          ? { expectSelection: guards.expectSelection }
          : {}),
        ...(guards.replace !== undefined ? { replace: guards.replace } : {}),
        ...(guards.watch ? { watch: true } : {}),
        ...(budget ? { deadlineMs: budget.deadlineMs } : {})
      },
      budget ? budget.timeout : this.timeouts.deliver,
      false
    )
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
      ...(reply.method === 'ax' || reply.method === 'paste' || reply.method === 'type'
        ? { method: reply.method }
        : {}),
      verified: reply.verified === true,
      clipboard: typeof reply.clipboard === 'string' ? reply.clipboard : 'untouched',
      ...(isTimings(reply.timings) ? { timings: reply.timings } : {})
    }
  }

  /** Read the text of a watched field back. Unreachable helper reads as `unreadable`. */
  async watchRead(watchId: string): Promise<FieldReading> {
    const reply = await this.request('watch-read', { watchId }, this.timeouts.snapshot)
    if (!reply?.ok) return { state: 'unreadable' }
    switch (reply.state) {
      case 'ok':
        return typeof reply.value === 'string'
          ? { state: 'ok', value: reply.value, focused: reply.focused === true }
          : { state: 'unreadable' }
      case 'gone':
      case 'secure':
      case 'too-long':
        return { state: reply.state }
      default:
        return { state: 'unreadable' }
    }
  }

  watchStop(watchId: string): void {
    if (this.child) void this.request('watch-stop', { watchId }, this.timeouts.hold, false)
  }

  /** The name and icon of each installed app among these identifiers. Empty when the helper cannot say. */
  async appInfo(bundleIds: string[]): Promise<AppInfoEntry[]> {
    const reply = await this.request('app-info', { bundleIds }, this.timeouts.snapshot)
    if (!reply?.ok || !Array.isArray(reply.apps)) return []
    const out: AppInfoEntry[] = []
    for (const item of reply.apps as unknown[]) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      if (typeof raw.bundleId !== 'string') continue
      out.push({
        bundleId: raw.bundleId,
        name: typeof raw.name === 'string' && raw.name ? raw.name : null,
        icon: typeof raw.png === 'string' && raw.png ? `data:image/png;base64,${raw.png}` : null
      })
    }
    return out
  }

  /** An app's icon as a PNG data URL, for the pill. Null when it cannot be drawn. */
  async appIcon(appPath: string): Promise<string | null> {
    const reply = await this.request('app-icon', { path: appPath }, this.timeouts.snapshot)
    return reply?.ok && typeof reply.png === 'string' && reply.png.length > 0
      ? `data:image/png;base64,${reply.png}`
      : null
  }

  /** The text selected in the field the snapshot was taken from; refused for a secure field. */
  async selection(snapshotId: string): Promise<SelectionResult> {
    const reply = await this.request('selection', { snapshotId }, this.timeouts.snapshot)
    if (!reply) return { ok: false, reason: 'unavailable' }
    if (reply.ok && typeof reply.text === 'string') return { ok: true, text: reply.text }
    const reason = reply.reason
    return {
      ok: false,
      reason:
        reason === 'no-target' || reason === 'focus-changed' || reason === 'secure-field'
          ? reason
          : 'unavailable'
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

  /**
   * Watch one non-primary mouse button as a second hold-to-talk trigger, or
   * stop with null. Remembered so a restarted helper re-arms it.
   */
  async setMouseButton(
    button: number | null,
    swallow: boolean,
    mode: MouseMode = 'hold'
  ): Promise<MouseStartResult | null> {
    if (button === null) {
      this.mouse = null
      if (this.child) await this.request('mouse-stop', {}, this.timeouts.hold, false)
      return null
    }
    const running = await this.ensureRunning()
    this.mouse = { button, swallow, mode }
    if (!running) return { ok: false, failure: 'helper-unavailable' }
    const reply = await this.request(
      'mouse-start',
      { button, swallow, mode, minHoldMs: 150 },
      this.timeouts.hold
    )
    if (!reply) return { ok: false, failure: 'helper-unavailable' }
    if (reply.ok) return { ok: true, swallowing: reply.swallowing === true }
    return {
      ok: false,
      failure:
        reply.reason === 'invalid-button'
          ? 'invalid-button'
          : reply.reason === 'unknown-key'
            ? 'unknown-key'
            : 'input-monitoring-denied'
    }
  }

  /**
   * Ask macOS for Accessibility from this process (the one that inserts text).
   * Returns whether it is granted now; null when the helper cannot be reached.
   */
  async requestAccessibility(): Promise<boolean | null> {
    const reply = await this.request('request-accessibility', {}, this.timeouts.permission)
    return reply?.ok ? reply.trusted === true : null
  }

  /** Ask macOS for Input Monitoring. Returns whether it is granted now; null when unreachable. */
  async requestInputMonitoring(): Promise<boolean | null> {
    const reply = await this.request('request-input-monitoring', {}, this.timeouts.permission)
    return reply?.ok ? reply.granted === true : null
  }

  /** Wait for the user to press a mouse button, for the settings page. */
  async captureMouseButton(): Promise<MouseCaptureResult> {
    const seconds = Math.round(this.timeouts.capture / 1000) - 1
    const reply = await this.request('mouse-capture', { seconds }, this.timeouts.capture)
    if (!reply) return { ok: false, failure: 'helper-unavailable' }
    if (reply.ok && typeof reply.button === 'number') return { ok: true, button: reply.button }
    const failure = reply.reason
    return {
      ok: false,
      failure:
        failure === 'primary-button' ||
        failure === 'timeout' ||
        failure === 'input-monitoring-denied'
          ? failure
          : 'failed'
    }
  }

  /**
   * End the helper process so the next request starts a fresh one, which re-arms
   * the hold key and the mouse button. A process started before a permission was
   * granted may not see the grant until it is replaced.
   */
  restart(): void {
    const child = this.child
    if (child && child.exitCode === null) {
      child.stdin.end()
      this.end(child)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.holdKey = 'off'
    this.mouse = null
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (this.aliveTimer) clearTimeout(this.aliveTimer)
    this.aliveTimer = null
    this.failAll()
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) {
      child.stdin.end()
      this.end(child)
    }
  }

  /**
   * macOS: SIGTERM at once (the helper catches it and restores the sound). Windows:
   * closing stdin already asks the helper to leave; it is ended only if it lingers.
   */
  private end(child: HelperChild): void {
    if (!this.windows) {
      child.kill('SIGTERM')
      return
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }, WINDOWS_EXIT_GRACE_MS)
    timer.unref?.()
  }

  /* ---- plumbing ---- */

  private ensureRunning(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    // A ready that arrived after the readiness timeout still counts for the rest of the session.
    if (this.child && this.helperReady) return Promise.resolve(true)
    if (this.child && this.ready) return this.ready
    if (!this.available) return Promise.resolve(false)
    // Do not spin on a helper that dies immediately.
    if (Date.now() - this.lastExitAt < 500) return Promise.resolve(false)
    let child: HelperChild
    try {
      child = spawn(this.launch.command, this.launch.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      this.launchError = (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
      return Promise.resolve(false)
    }
    this.child = child
    this.buffer = ''
    this.helperReady = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim()) console.error(line.trim())
    })
    child.stdin.on('error', () => {})
    this.ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => resolve(false),
        this.launch.readyTimeoutMs ?? (this.windows ? WINDOWS_READY_TIMEOUT_MS : 3_000)
      )
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
          if (this.handleLine(line)) {
            this.launchError = null
            this.helperReady = true
            // The backoff resets only once this helper has proved healthy (stayed up a while),
            // so a helper that always crashes right after ready cannot restart every 0.5 s.
            if (this.aliveTimer) clearTimeout(this.aliveTimer)
            this.aliveTimer = setTimeout(() => {
              this.restartAttempts = 0
              this.totalRestarts = 0
            }, HELPER_HEALTHY_MS)
            this.aliveTimer.unref?.()
            settle(true)
          }
        }
      })
      child.on('error', (error: NodeJS.ErrnoException) => {
        this.launchError = error.code ?? 'UNKNOWN'
        settle(false)
      })
      child.on('close', () => {
        settle(false)
        if (this.child !== child) return
        this.child = null
        this.ready = null
        this.helperReady = false
        if (this.aliveTimer) clearTimeout(this.aliveTimer)
        this.aliveTimer = null
        this.lastExitAt = Date.now()
        this.failAll()
        for (const listener of this.exitListeners) listener()
        this.scheduleRestart()
      })
    })
    // Re-arm the mouse button and the hold watch on the fresh process.
    void this.ready.then((ok) => {
      if (ok && this.mouse && this.child === child) {
        void this.request(
          'mouse-start',
          { ...this.mouse, minHoldMs: 150 },
          this.timeouts.hold,
          false
        )
      }
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
    if (parsed.event === 'click') {
      for (const listener of this.clickListeners) listener()
      return false
    }
    if (parsed.event === 'tap') {
      for (const listener of this.tapListeners) listener()
      return false
    }
    if (parsed.event === 'hooks') {
      const phase =
        parsed.phase === 'lost' || parsed.phase === 'restored' || parsed.phase === 'failed'
          ? parsed.phase
          : null
      if (phase) for (const listener of this.hookListeners) listener(phase)
      return false
    }
    if (parsed.event === 'parse-error') return false
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

  /**
   * Windows: a crashed helper is replaced automatically with a growing backoff, so hold-to-talk
   * and a muted sound do not stay broken until the next manual request. A fresh helper re-arms
   * the triggers and, on launch, gives back any sound an earlier helper left muted.
   */
  private scheduleRestart(): void {
    if (!this.windows || this.disposed || this.restartTimer) return
    const wantsHelper = this.holdKey !== 'off' || this.mouse !== null || this.mutedOutput
    if (!wantsHelper || this.totalRestarts >= MAX_RESTARTS_PER_SESSION) return
    const delay = RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)]
    this.restartAttempts += 1
    this.totalRestarts += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.disposed || this.child) return
      void this.ensureRunning()
    }, delay)
    this.restartTimer.unref?.()
  }

  private failAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve(null)
    }
    this.pending.clear()
  }
}

function isTimings(value: unknown): value is HelperDeliveryTimings {
  const v = value as Record<string, unknown> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    ['validateMs', 'insertMs', 'confirmMs', 'settleMs'].every((k) => typeof v[k] === 'number') &&
    typeof v.skippedAx === 'boolean'
  )
}

export interface HoldEvent {
  phase: 'down' | 'up'
  holdId: number
}
