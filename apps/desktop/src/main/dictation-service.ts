import type { AppChannel } from '../shared/app-channel'
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationLatency,
  type DictationPermissions,
  type DictationSettings,
  type DictationSettingsUpdate,
  type DictationStatus,
  type MicrophoneAccess,
  type RecoveryItem,
  type ShortcutState
} from '../shared/dictation-api'
import type {
  HelperDelivery,
  HelperStatus,
  HoldFailure,
  HoldKey,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import {
  initialSessionState,
  reduce,
  type CleanupMode,
  type CleanupOutcome,
  type DeliveryOutcome,
  type RecoveryReason,
  type SessionEffect,
  type SessionEvent,
  type SessionState
} from '../shared/dictation-session'
import type { EngineEvent, EngineStartOptions } from '../shared/engine-events'
import type { CaptureLease, CaptureOwnership } from './capture-ownership'
import { MAX_CLEANUP_CHARS, buildCleanupRequest, validateCleanup } from './dictation-cleanup'
import { overlayView, type OverlayContext, type OverlayView } from './dictation-overlay-view'
import type { OverlayAction } from './dictation-overlay'

export interface EngineLike {
  tryStartLive(opts: EngineStartOptions): { started: true } | { started: false; reason: string }
  stop(): void
  readonly running: boolean
  readonly warm: boolean
}

export interface HelperLike {
  readonly available: boolean
  status(): Promise<HelperStatus | null>
  snapshot(snapshotId: string): Promise<TargetDescription | null>
  deliver(snapshotId: string, text: string): Promise<HelperDelivery>
  release(snapshotId: string): void
  setHoldKey(key: HoldKey): Promise<HoldFailure | null>
  onHold(listener: (event: { phase: 'down' | 'up'; holdId: number }) => void): () => void
  onExit(listener: () => void): () => void
  dispose(): Promise<void>
}

export interface ShortcutsLike {
  /** Returns false when another app owns the combination; throws on a malformed one. */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface OverlayLike {
  render(view: OverlayView): void
  dispose(): void
}

/** Runs one cleanup request and returns the model's text. Throws with a user-readable message. */
export type CleanupRunner = (
  mode: 'local' | 'byok',
  request: { system: string; prompt: string },
  signal: AbortSignal,
  consent: { provider: string; model: string } | null
) => Promise<string>

export interface DictationDeps {
  channel: AppChannel
  supported: boolean
  settings: {
    get(): DictationSettings
    update(patch: DictationSettingsUpdate): DictationSettings
  }
  engine: EngineLike
  ownership: CaptureOwnership
  helper: HelperLike
  shortcuts: ShortcutsLike
  overlay: OverlayLike
  cleanup: CleanupRunner
  cleanupOptions(): DictationStatus['cleanup']
  microphoneAccess(): MicrophoneAccess
  /** Electron's clipboard API is asynchronous; resolve only once the text is on it. */
  writeClipboard(text: string): Promise<void> | void
  broadcast(status: DictationStatus): void
  /** The microphone is held (true) or free (false); lets the host quiet meeting detection. */
  onMicHeld(held: boolean): void
  now(): number
  log(line: string): void
  /** Numbers-only latency record; never receives transcript text. */
  recordMetrics(record: Record<string, number | string | boolean | null>): void
}

interface SessionContext {
  gen: number
  snapshotId: string
  target: Promise<TargetDescription | null>
  targetDescription: TargetDescription | null
  consent: { provider: string; model: string } | null
  warmAtStart: boolean
  marks: {
    start: number
    micOpen?: number
    stop?: number
    final?: number
    cleanupStart?: number
    cleanupEnd?: number
    deliverStart?: number
    deliverEnd?: number
  }
}

const MAX_RECOVERIES = 5
const SUCCESS_NOTICE_MS = 1_200
const NOTICE_MS = 6_000
const ESCAPE = 'Escape'

/**
 * Orchestrates one dictation at a time: shortcut and hold events in, engine
 * events and helper replies in, overlay and insertion out. All decisions about
 * ordering live in the pure reducer; this class performs the effects and feeds
 * results back tagged with the session generation they belong to.
 */
export class DictationService {
  private state: SessionState = initialSessionState()
  private readonly sessions = new Map<number, SessionContext>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private cleanupAbort: { gen: number; controller: AbortController } | null = null
  private restingTimer: NodeJS.Timeout | null = null
  /** The engine session, which can outlive the logical session during drain. */
  private capture: { gen: number; lease: CaptureLease } | null = null
  private micOpen = false
  private level = 0
  private lastPartialRender = 0
  private recoveries: RecoveryItem[] = []
  private lastLatency: DictationLatency | null = null
  private helperStatus: HelperStatus | null = null
  private toggleAccelerator: string | null = null
  private toggleState: ShortcutState = 'off'
  private holdState: DictationStatus['holdKey'] = 'off'
  private escapeRegistered = false
  private disposed = false
  private lastToggleAt = 0
  private readonly unsubscribe: Array<() => void> = []

  constructor(private readonly deps: DictationDeps) {
    this.unsubscribe.push(
      deps.helper.onHold((event) => this.onHold(event)),
      deps.helper.onExit(() => this.onHelperExit())
    )
  }

  /* ---- lifecycle ---- */

  /** Apply persisted settings: register shortcuts, arm hold-to-talk. */
  async start(): Promise<void> {
    await this.applySettings()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.dispatch({ type: 'cancel' })
    this.clearAllTimers()
    this.unregisterEscape()
    if (this.toggleAccelerator) this.deps.shortcuts.unregister(this.toggleAccelerator)
    this.toggleAccelerator = null
    for (const stop of this.unsubscribe) stop()
    this.deps.overlay.dispose()
    await this.deps.helper.dispose()
  }

  async setSettings(update: DictationSettingsUpdate): Promise<DictationStatus> {
    const before = this.deps.settings.get()
    const next = this.deps.settings.update(update)
    // The consent belongs to one provider/model pair. A different pair clears it.
    if (
      next.byokConsent &&
      update.byokConsent === undefined &&
      JSON.stringify(before.byokConsent) !== JSON.stringify(next.byokConsent)
    ) {
      this.deps.settings.update({ byokConsent: null })
    }
    await this.applySettings()
    return this.status()
  }

  private async applySettings(): Promise<void> {
    const settings = this.deps.settings.get()
    if (!this.deps.supported || !settings.enabled) {
      this.dispatch({ type: 'cancel' })
      this.setToggleShortcut('')
      this.holdState = 'off'
      void this.deps.helper.setHoldKey('off')
      return
    }
    this.setToggleShortcut(settings.toggleShortcut)
    if (settings.holdKey === 'off') {
      this.holdState = 'off'
      await this.deps.helper.setHoldKey('off')
    } else {
      const failure = await this.deps.helper.setHoldKey(settings.holdKey)
      this.holdState =
        failure === null
          ? 'active'
          : failure === 'input-monitoring-denied'
            ? 'needs-permission'
            : 'unavailable'
    }
  }

  private setToggleShortcut(accelerator: string): void {
    if (this.toggleAccelerator === accelerator && this.toggleState === 'registered') return
    if (this.toggleAccelerator) this.deps.shortcuts.unregister(this.toggleAccelerator)
    this.toggleAccelerator = null
    if (!accelerator) {
      this.toggleState = 'off'
      return
    }
    try {
      const ok = this.deps.shortcuts.register(accelerator, () => this.toggle())
      this.toggleState = ok ? 'registered' : 'conflict'
      if (ok) this.toggleAccelerator = accelerator
    } catch {
      this.toggleState = 'invalid'
    }
  }

  /* ---- user actions ---- */

  /** The shortcut, tray item and settings button all land here. */
  toggle(): void {
    if (this.disposed) return
    const now = this.deps.now()
    // Key auto-repeat or a double tap must not stop a session that just began.
    if (now - this.lastToggleAt < 250) return
    this.lastToggleAt = now
    if (this.state.phase === 'preparing' || this.state.phase === 'recording') {
      this.dispatch({ type: 'stop', source: 'toggle', nowMs: now })
      return
    }
    this.begin('toggle')
  }

  cancel(): void {
    this.dispatch({ type: 'cancel' })
  }

  private onHold(event: { phase: 'down' | 'up'; holdId: number }): void {
    if (this.disposed) return
    if (event.phase === 'down') {
      this.begin('hold', event.holdId)
    } else {
      this.dispatch({
        type: 'stop',
        source: 'release',
        holdId: event.holdId,
        nowMs: this.deps.now()
      })
    }
  }

  /** The helper died. A hold can no longer see its key-up, so finish what was said. */
  private onHelperExit(): void {
    if (this.disposed) return
    const active = this.state.active
    if (active?.trigger === 'hold' && ['preparing', 'recording'].includes(this.state.phase)) {
      this.dispatch({ type: 'stop', source: 'button', nowMs: this.deps.now() })
    }
    this.helperStatus = null
  }

  onOverlayAction(action: OverlayAction, gen: number | null): void {
    switch (action) {
      case 'stop':
        this.dispatch({
          type: 'stop',
          source: 'button',
          ...(gen !== null ? { gen } : {}),
          nowMs: this.deps.now()
        })
        break
      case 'cancel':
        this.dispatch({ type: 'cancel', ...(gen !== null ? { gen } : {}) })
        break
      case 'copy':
        if (gen !== null) void this.copyRecovery(gen)
        break
      case 'dismiss':
        this.dispatch({ type: 'dismiss' })
        break
    }
  }

  async copyRecovery(gen: number): Promise<boolean> {
    const item = this.recoveries.find((r) => r.gen === gen)
    if (!item) return false
    try {
      await this.deps.writeClipboard(item.text)
      return true
    } catch {
      return false
    }
  }

  dismissRecovery(gen: number): void {
    this.recoveries = this.recoveries.filter((r) => r.gen !== gen)
    if (this.state.resting?.kind === 'recovery' && this.state.resting.gen === gen) {
      this.dispatch({ type: 'dismiss' })
    } else {
      this.broadcast()
    }
  }

  /* ---- starting a session ---- */

  private begin(trigger: 'toggle' | 'hold', holdId?: number): void {
    const settings = this.deps.settings.get()
    if (!this.deps.supported || !settings.enabled) return
    if (
      this.state.phase !== 'idle' &&
      this.state.phase !== 'notice' &&
      this.state.phase !== 'recovery'
    ) {
      return // a live session already owns the shortcut
    }
    if (!this.deps.helper.available) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: 'The dictation helper is missing from this build.'
      })
      return
    }
    const access = this.deps.microphoneAccess()
    if (access === 'denied' || access === 'restricted') {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message:
          'Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.'
      })
      return
    }
    const claim = this.deps.ownership.claim('dictation', this.deps.engine.running)
    if (!claim.ok) {
      const finishing = claim.heldBy === 'dictation'
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: finishing
          ? 'Finishing the previous dictation. Try again in a moment.'
          : claim.message
      })
      return
    }
    // From here the lease is ours; every exit path below must release it.
    const now = this.deps.now()
    const gen = this.state.nextGen
    const snapshotId = `dn-${gen}-${now}`
    const context: SessionContext = {
      gen,
      snapshotId,
      target: Promise.resolve(null),
      targetDescription: null,
      consent: settings.byokConsent,
      warmAtStart: this.deps.engine.warm,
      marks: { start: now }
    }
    this.sessions.set(gen, context)
    this.capture = { gen, lease: claim.lease }
    this.deps.onMicHeld(true)
    this.micOpen = false
    this.level = 0
    this.dispatch({
      type: 'start',
      trigger,
      cleanupMode: settings.cleanupMode,
      nowMs: now,
      ...(holdId !== undefined ? { holdId } : {})
    })
  }

  /* ---- engine events (routed here by the host while dictation owns capture) ---- */

  /** Returns true when the event belonged to dictation and was consumed. */
  handleEngineEvent(event: EngineEvent): boolean {
    const capture = this.capture
    if (!capture) return false
    const gen = capture.gen
    switch (event.event) {
      case 'status':
        if (event.stage === 'transcribing') this.dispatch({ type: 'asr-ready', gen })
        if (event.stage === 'input_default_fallback' || event.stage === 'mic_restarting') {
          this.deps.log(`engine ${event.stage}`)
        }
        break
      case 'ready':
        this.micOpen = true
        this.mark(gen, 'micOpen')
        this.dispatch({ type: 'capture-ready', gen })
        break
      case 'level':
        this.handleLevel(Math.min(1, Math.sqrt(event.peak) * 1.3))
        break
      case 'partial':
        if (event.channel === undefined || event.channel === 'mic') {
          this.dispatch({ type: 'partial', gen, text: event.text })
        }
        break
      case 'final':
        if (event.channel === undefined || event.channel === 'mic') {
          this.mark(gen, 'final')
          this.dispatch({ type: 'final', gen, text: event.text })
        }
        break
      case 'error':
        this.onEngineError(gen, event.message)
        break
      case 'done':
        // A finished session that produced no final text ended without speech.
        this.dispatch({ type: 'engine-ended', gen })
        break
      case 'spawn-error':
        this.dispatch({ type: 'engine-failed', gen, message: event.message })
        this.releaseCapture()
        break
      case 'exit':
        this.dispatch({ type: 'engine-ended', gen })
        this.releaseCapture()
        break
      default:
        break
    }
    return true
  }

  /** Whether a sidecar event stream is currently owned by dictation. */
  get ownsCapture(): boolean {
    return this.capture !== null
  }

  /** Microphone level, 0..1, from the engine; drives the meter. */
  handleLevel(peak: number): void {
    this.level = Math.max(0, Math.min(1, peak))
    if (this.state.phase === 'recording' && this.deps.now() - this.lastPartialRender > 90) {
      this.lastPartialRender = this.deps.now()
      this.render()
    }
  }

  private onEngineError(gen: number, message: string): void {
    this.deps.log(`engine error: ${message.slice(0, 120)}`)
    const active = this.state.active
    // Words already heard are worth keeping: drain instead of discarding.
    if (active?.gen === gen && this.state.phase === 'recording' && active.partial.trim()) {
      this.dispatch({ type: 'stop', source: 'button', gen, nowMs: this.deps.now() })
      return
    }
    this.dispatch({
      type: 'engine-failed',
      gen,
      message: /microphone/i.test(message)
        ? 'The microphone stopped delivering audio. Check your input device and try again.'
        : 'The speech engine reported an error. Nothing was inserted.'
    })
  }

  private releaseCapture(): void {
    const capture = this.capture
    if (!capture) return
    this.capture = null
    this.micOpen = false
    this.deps.ownership.release(capture.lease)
    this.deps.onMicHeld(false)
  }

  /* ---- reducer plumbing ---- */

  private dispatch(event: SessionEvent): void {
    if (this.disposed && event.type !== 'cancel') return
    const previous = this.state
    const result = reduce(this.state, event)
    this.state = result.state
    for (const effect of result.effects) this.perform(effect)
    if (result.state !== previous) this.afterTransition(previous)
  }

  private perform(effect: SessionEffect): void {
    switch (effect.type) {
      case 'escape-register':
        this.registerEscape()
        break
      case 'escape-unregister':
        this.unregisterEscape()
        break
      case 'snapshot-target':
        this.takeSnapshot(effect.gen)
        break
      case 'capture-start':
        this.startCapture(effect.gen)
        break
      case 'capture-stop':
        this.mark(effect.gen, 'stop')
        if (this.capture?.gen === effect.gen) this.deps.engine.stop()
        break
      case 'capture-cancel':
        // The sidecar drains whatever it buffered; the result is ignored
        // because the session is gone, and the lease stays until it exits.
        if (this.capture?.gen === effect.gen) this.deps.engine.stop()
        this.finishSession(effect.gen)
        break
      case 'timers-set':
        this.setTimer(effect.gen, effect.stage, effect.ms)
        break
      case 'timers-clear':
        this.clearTimers(effect.gen)
        break
      case 'cleanup-start':
        void this.runCleanup(effect.gen, effect.mode, effect.raw)
        break
      case 'cleanup-abort':
        if (this.cleanupAbort?.gen === effect.gen) {
          this.cleanupAbort.controller.abort()
          this.cleanupAbort = null
        }
        break
      case 'deliver':
        void this.runDelivery(effect.gen, effect.text)
        break
    }
  }

  private afterTransition(previous: SessionState): void {
    const state = this.state
    if (state.phase === 'recovery' && state.resting?.kind === 'recovery') {
      const resting = state.resting
      if (!this.recoveries.some((r) => r.gen === resting.gen)) {
        this.recoveries = [
          { gen: resting.gen, text: resting.text, reason: resting.reason, at: this.deps.now() },
          ...this.recoveries
        ].slice(0, MAX_RECOVERIES)
      }
    }
    if (previous.active && !state.active) this.finishSession(previous.active.gen)
    this.scheduleRestingDismiss()
    this.render()
    this.broadcast()
  }

  private scheduleRestingDismiss(): void {
    if (this.restingTimer) clearTimeout(this.restingTimer)
    this.restingTimer = null
    const resting = this.state.resting
    if (this.state.phase !== 'notice' || resting?.kind !== 'notice') return
    const ms = resting.level === 'success' ? SUCCESS_NOTICE_MS : NOTICE_MS
    this.restingTimer = setTimeout(() => this.dispatch({ type: 'dismiss' }), ms)
    this.restingTimer.unref?.()
  }

  /** Drop per-session bookkeeping once the logical session is over. */
  private finishSession(gen: number): void {
    this.clearTimers(gen)
    if (this.cleanupAbort?.gen === gen) {
      this.cleanupAbort.controller.abort()
      this.cleanupAbort = null
    }
    const context = this.sessions.get(gen)
    if (context) this.deps.helper.release(context.snapshotId)
    // Keep the context a moment for latency accounting by delivery; the map is
    // tiny and bounded, so prune old entries instead of timing precisely.
    for (const key of [...this.sessions.keys()]) if (key < gen - 3) this.sessions.delete(key)
  }

  private render(): void {
    const context: OverlayContext = {
      micOpen: this.micOpen,
      level: this.level,
      insertionUnavailable: this.helperStatus !== null && !this.helperStatus.accessibility
    }
    this.deps.overlay.render(overlayView(this.state, context))
  }

  private mark(gen: number, key: keyof SessionContext['marks']): void {
    const context = this.sessions.get(gen)
    if (context && context.marks[key] === undefined) context.marks[key] = this.deps.now()
  }

  /* ---- effects ---- */

  private registerEscape(): void {
    if (this.escapeRegistered) return
    try {
      this.escapeRegistered = this.deps.shortcuts.register(ESCAPE, () =>
        this.dispatch({ type: 'cancel' })
      )
    } catch {
      this.escapeRegistered = false
    }
  }

  private unregisterEscape(): void {
    if (!this.escapeRegistered) return
    this.escapeRegistered = false
    this.deps.shortcuts.unregister(ESCAPE)
  }

  private takeSnapshot(gen: number): void {
    const context = this.sessions.get(gen)
    if (!context) return
    context.target = this.deps.helper.snapshot(context.snapshotId).then((description) => {
      context.targetDescription = description
      if (description && this.helperStatus)
        this.helperStatus.accessibility = description.accessibility
      if (description && !this.helperStatus) {
        this.helperStatus = {
          accessibility: description.accessibility,
          inputMonitoring: false,
          secureInput: false,
          conflicts: [],
          holdActive: false
        }
      }
      if (this.state.active?.gen === gen) this.render()
      return description
    })
  }

  private startCapture(gen: number): void {
    const started = this.deps.engine.tryStartLive({ source: 'mic', levels: true })
    if (started.started) return
    this.deps.log(`capture refused: ${started.reason}`)
    this.dispatch({ type: 'engine-failed', gen, message: started.reason })
    this.releaseCapture()
  }

  private setTimer(gen: number, stage: 'recording' | 'finalizing' | 'cleaning', ms: number): void {
    const key = `${gen}:${stage}`
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      if (stage === 'recording') {
        this.dispatch({ type: 'stop', source: 'limit', gen, nowMs: this.deps.now() })
      } else {
        this.dispatch({ type: 'timeout', gen, stage })
      }
    }, ms)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  private clearTimers(gen: number): void {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${gen}:`)) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    if (this.restingTimer) clearTimeout(this.restingTimer)
    this.restingTimer = null
  }

  private async runCleanup(
    gen: number,
    mode: Exclude<CleanupMode, 'raw'>,
    raw: string
  ): Promise<void> {
    const context = this.sessions.get(gen)
    const finish = (outcome: CleanupOutcome): void => {
      this.mark(gen, 'cleanupEnd')
      this.dispatch({ type: 'cleanup-done', gen, outcome })
    }
    this.mark(gen, 'cleanupStart')
    if (raw.length > MAX_CLEANUP_CHARS) {
      finish({ kind: 'kept-raw', reason: 'Too long to clean up; the raw transcript was used.' })
      return
    }
    const controller = new AbortController()
    this.cleanupAbort = { gen, controller }
    try {
      const output = await this.deps.cleanup(
        mode,
        buildCleanupRequest(raw),
        controller.signal,
        context?.consent ?? null
      )
      // Cancelled, timed out, or superseded while the model was working.
      if (controller.signal.aborted || this.state.active?.gen !== gen) return
      const verdict = validateCleanup(raw, output)
      finish(
        verdict.ok
          ? { kind: 'cleaned', text: verdict.text }
          : { kind: 'kept-raw', reason: verdict.reason }
      )
    } catch (error) {
      if (controller.signal.aborted || this.state.active?.gen !== gen) return
      const message = error instanceof Error ? error.message : 'Cleanup failed.'
      finish({ kind: 'kept-raw', reason: `${message.slice(0, 120)} The raw transcript was used.` })
    } finally {
      if (this.cleanupAbort?.controller === controller) this.cleanupAbort = null
    }
  }

  private async runDelivery(gen: number, text: string): Promise<void> {
    const context = this.sessions.get(gen)
    this.mark(gen, 'deliverStart')
    const outcome = await this.deliver(context, text)
    this.mark(gen, 'deliverEnd')
    if (context) this.recordLatency(context)
    // A newer session may exist by now; the reducer ignores a stale generation.
    this.dispatch({ type: 'delivery-done', gen, outcome })
  }

  private async deliver(
    context: SessionContext | undefined,
    text: string
  ): Promise<DeliveryOutcome> {
    if (!context) return { kind: 'recover', reason: 'no-target' }
    const target = await context.target
    if (!target) return { kind: 'recover', reason: 'helper-unavailable' }
    if (!target.accessibility) return { kind: 'recover', reason: 'accessibility-denied' }
    if (!target.hasElement) return { kind: 'recover', reason: 'no-target' }
    if (target.secure) return { kind: 'recover', reason: 'secure-field' }
    const result = await this.deps.helper.deliver(context.snapshotId, text)
    this.deps.log(
      `delivery ${result.outcome}${result.reason ? ` (${result.reason})` : ''} via ${result.method ?? 'none'}, clipboard ${result.clipboard}`
    )
    if (result.outcome === 'delivered') return { kind: 'delivered' }
    if (result.outcome === 'uncertain') return { kind: 'recover', reason: 'insertion-uncertain' }
    if (result.outcome === 'refused')
      return { kind: 'recover', reason: refusalReason(result.reason) }
    return { kind: 'recover', reason: 'insertion-failed' }
  }

  private recordLatency(context: SessionContext): void {
    const m = context.marks
    const diff = (a?: number, b?: number): number | null =>
      a !== undefined && b !== undefined ? b - a : null
    this.lastLatency = {
      startMs: diff(m.start, m.micOpen),
      stopToFinalMs: diff(m.stop, m.final),
      cleanupMs: diff(m.cleanupStart, m.cleanupEnd),
      insertMs: diff(m.deliverStart, m.deliverEnd),
      recordedMs: diff(m.micOpen, m.stop),
      warm: context.warmAtStart
    }
    this.deps.recordMetrics({ at: this.deps.now(), ...this.lastLatency })
  }

  /* ---- status ---- */

  async status(): Promise<DictationStatus> {
    const helper = await this.deps.helper.status()
    if (helper) this.helperStatus = helper
    return this.snapshotStatus()
  }

  private snapshotStatus(): DictationStatus {
    const helper = this.helperStatus
    const permissions: DictationPermissions = {
      microphone: this.deps.microphoneAccess(),
      accessibility: helper ? helper.accessibility : null,
      inputMonitoring: helper ? helper.inputMonitoring : null
    }
    return {
      channel: this.deps.channel,
      supported: this.deps.supported,
      settings: this.deps.settings.get() ?? DEFAULT_DICTATION_SETTINGS,
      phase: this.state.phase,
      permissions,
      helper: this.deps.helper.available ? 'ready' : 'unavailable',
      toggleShortcut: this.toggleState,
      holdKey: this.holdState,
      conflicts: helper?.conflicts ?? [],
      speech: this.deps.engine.warm ? 'warm' : 'cold',
      cleanup: this.deps.cleanupOptions(),
      recoveries: this.recoveries,
      lastLatency: this.lastLatency
    }
  }

  private broadcast(): void {
    this.deps.broadcast(this.snapshotStatus())
  }

  /** Exposed for tests: the reducer state, never persisted. */
  get phase(): SessionState['phase'] {
    return this.state.phase
  }
}

function refusalReason(reason: string | undefined): RecoveryReason {
  switch (reason) {
    case 'focus-changed':
    case 'secure-field':
    case 'no-target':
    case 'not-editable':
    case 'accessibility-denied':
      return reason
    case 'helper-unavailable':
      return 'helper-unavailable'
    default:
      return 'insertion-failed'
  }
}
