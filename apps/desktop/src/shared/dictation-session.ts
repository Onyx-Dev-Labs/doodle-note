/**
 * Pure dictation session model. No I/O: the main-process service feeds events
 * in and executes the effects that come out. Every asynchronous result carries
 * the generation (session id) it was requested under; a result for any other
 * generation is ignored, which is what keeps a late recognizer, cleanup or
 * delivery callback from inserting text after cancel or into a newer session.
 */

export type CleanupMode = 'raw' | 'local' | 'byok'
/**
 * toggle: the global shortcut. hold: a modifier held while speaking.
 * handsfree: two quick taps of the hold key latched recording on.
 * pill: a click on the resting pill (also hands-free). menu: any other menu item.
 */
export type DictationTrigger = 'toggle' | 'hold' | 'handsfree' | 'pill' | 'menu'

export type Phase =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'finalizing'
  | 'cleaning'
  | 'delivering'
  /** Resting: finished text could not be inserted and is being kept for the user. */
  | 'recovery'
  /** Resting: a short outcome message (success, empty, error) is on screen. */
  | 'notice'

export type NoticeLevel = 'success' | 'info' | 'error'

export type RecoveryReason =
  | 'focus-changed'
  | 'secure-field'
  | 'no-target'
  | 'not-editable'
  | 'accessibility-denied'
  | 'insertion-uncertain'
  | 'insertion-failed'
  | 'helper-unavailable'

export type DeliveryOutcome =
  { kind: 'delivered' } | { kind: 'recover'; reason: RecoveryReason; detail?: string }

export type CleanupOutcome =
  { kind: 'cleaned'; text: string } | { kind: 'kept-raw'; reason: string }

/** A hold shorter than this was an accidental tap, not an utterance. */
export const MIN_HOLD_MS = 350
/**
 * Two quick taps of the hold key latch hands-free when the second lands within
 * this long of the first. Measured between the two moments the helper reports:
 * a tap's release, or a longer press's announcement.
 */
export const DOUBLE_TAP_WINDOW_MS = 450
/** Hold-to-talk is bounded by the key; this only covers a missed key-up. */
export const HOLD_MAX_RECORDING_MS = 180_000
/** Hands-free sessions (shortcut, pill click, double tap) stop on their own after this. */
export const HANDS_FREE_MAX_RECORDING_MS = 20 * 60_000
/** The visible warning appears this long before the hands-free limit. */
export const HANDS_FREE_WARNING_LEAD_MS = 60_000
export const FINALIZE_TIMEOUT_MS = 30_000
export const CLEANUP_TIMEOUT_MS = { local: 20_000, byok: 15_000 } as const

/** True for sessions that keep recording without a held key. */
export function isHandsFree(trigger: DictationTrigger): boolean {
  return trigger !== 'hold'
}

export function recordingLimitMs(trigger: DictationTrigger): number {
  return isHandsFree(trigger) ? HANDS_FREE_MAX_RECORDING_MS : HOLD_MAX_RECORDING_MS
}

/** Whether a tap at `nowMs` completes a double tap that began at `lastTapAtMs`. */
export function isDoubleTap(lastTapAtMs: number | null, nowMs: number): boolean {
  return lastTapAtMs !== null && nowMs >= lastTapAtMs && nowMs - lastTapAtMs <= DOUBLE_TAP_WINDOW_MS
}

export interface ActiveSession {
  gen: number
  trigger: DictationTrigger
  /** Pairs a hold's key-up with the key-down that started it. */
  holdId: number | null
  /** Snapshotted at start; later settings changes apply to the next session. */
  cleanupMode: CleanupMode
  startedAtMs: number
  stopRequested: boolean
  asrReady: boolean
  partial: string
  rawText: string | null
  /** Exactly what delivery was asked to insert; recovery keeps this string. */
  deliverText: string | null
  cleanupNote: string | null
  /** The hands-free limit is a minute away; the pill says so. */
  limitWarning: boolean
  /** The chosen input reports muted or zero volume while recording. */
  micMuted: boolean
  /** The saved microphone was missing, so the system default is in use. */
  micFellBack: boolean
}

export type Resting =
  | {
      kind: 'recovery'
      gen: number
      text: string
      rawText: string
      reason: RecoveryReason
      detail?: string
    }
  | { kind: 'notice'; level: NoticeLevel; message: string }

export interface SessionState {
  phase: Phase
  nextGen: number
  active: ActiveSession | null
  resting: Resting | null
  /** When the last unpaired quick tap of the hold key happened; the first half of a double tap. */
  lastTapAtMs: number | null
}

export const initialSessionState = (): SessionState => ({
  phase: 'idle',
  nextGen: 1,
  active: null,
  resting: null,
  lastTapAtMs: null
})

export type SessionEvent =
  | {
      type: 'start'
      trigger: DictationTrigger
      holdId?: number
      cleanupMode: CleanupMode
      nowMs: number
      /** Hands-free by double tap is on: a hold right after a tap latches instead. */
      doubleTap?: boolean
      /** The saved microphone was missing at start. */
      micFellBack?: boolean
    }
  /** A quick press-and-release of the hold key that never became a hold. */
  | { type: 'tap'; nowMs: number }
  | { type: 'capture-ready'; gen: number }
  | { type: 'asr-ready'; gen: number }
  | { type: 'partial'; gen: number; text: string }
  | {
      type: 'stop'
      source: 'toggle' | 'release' | 'button' | 'limit' | 'tap'
      gen?: number
      holdId?: number
      nowMs: number
    }
  | { type: 'cancel'; gen?: number }
  | { type: 'final'; gen: number; text: string }
  | { type: 'engine-failed'; gen: number; message: string }
  | { type: 'engine-ended'; gen: number }
  | { type: 'cleanup-done'; gen: number; outcome: CleanupOutcome }
  | { type: 'delivery-done'; gen: number; outcome: DeliveryOutcome }
  | { type: 'timeout'; gen: number; stage: 'finalizing' | 'cleaning' }
  | { type: 'limit-warning'; gen: number }
  | { type: 'mic-state'; gen: number; muted: boolean }
  /** The engine could not find the saved microphone and used the system default. */
  | { type: 'mic-fallback'; gen: number }
  | { type: 'dismiss' }
  /** A message with no session behind it, e.g. a refused start. Never interrupts a live session. */
  | { type: 'notice'; level: NoticeLevel; message: string }

export type SessionEffect =
  | { type: 'capture-start'; gen: number }
  /** Stop capture and drain buffered audio into a final result. */
  | { type: 'capture-stop'; gen: number }
  /** Stop capture and throw everything away. */
  | { type: 'capture-cancel'; gen: number }
  | { type: 'snapshot-target'; gen: number }
  | { type: 'cleanup-start'; gen: number; mode: Exclude<CleanupMode, 'raw'>; raw: string }
  | { type: 'cleanup-abort'; gen: number }
  | { type: 'deliver'; gen: number; text: string }
  | {
      type: 'timers-set'
      gen: number
      stage: 'recording' | 'warning' | 'finalizing' | 'cleaning'
      ms: number
    }
  | { type: 'timers-clear'; gen: number }
  | { type: 'escape-register' }
  | { type: 'escape-unregister' }

export interface Transition {
  state: SessionState
  effects: SessionEffect[]
  /** Set when a start was refused, so the caller can say why. */
  refused?: string
}

const RESTING: Phase[] = ['idle', 'recovery', 'notice']

export function isBusy(state: SessionState): boolean {
  return !RESTING.includes(state.phase)
}

function toIdle(
  state: SessionState,
  resting: Resting | null,
  effects: SessionEffect[]
): Transition {
  return {
    state: {
      ...state,
      phase: resting?.kind === 'recovery' ? 'recovery' : resting ? 'notice' : 'idle',
      active: null,
      resting
    },
    effects: [...effects, { type: 'escape-unregister' }]
  }
}

function notice(level: NoticeLevel, message: string): Resting {
  return { kind: 'notice', level, message }
}

export function reduce(state: SessionState, event: SessionEvent): Transition {
  const ignore: Transition = { state, effects: [] }
  const active = state.active

  switch (event.type) {
    case 'start': {
      if (isBusy(state)) return { state, effects: [], refused: 'Dictation is already running.' }
      const gen = state.nextGen
      // A hold that follows a quick tap is the second half of a double tap.
      const latched =
        event.trigger === 'hold' &&
        event.doubleTap === true &&
        isDoubleTap(state.lastTapAtMs, event.nowMs)
      const trigger: DictationTrigger = latched ? 'handsfree' : event.trigger
      const session: ActiveSession = {
        gen,
        trigger,
        holdId: event.holdId ?? null,
        cleanupMode: event.cleanupMode,
        startedAtMs: event.nowMs,
        stopRequested: false,
        asrReady: false,
        partial: '',
        rawText: null,
        deliverText: null,
        cleanupNote: null,
        limitWarning: false,
        micMuted: false,
        micFellBack: event.micFellBack === true
      }
      const limitMs = recordingLimitMs(trigger)
      return {
        state: {
          phase: 'preparing',
          nextGen: gen + 1,
          active: session,
          resting: null,
          lastTapAtMs: null
        },
        effects: [
          { type: 'escape-register' },
          { type: 'snapshot-target', gen },
          { type: 'capture-start', gen },
          { type: 'timers-set', gen, stage: 'recording', ms: limitMs },
          ...(isHandsFree(trigger)
            ? [
                {
                  type: 'timers-set',
                  gen,
                  stage: 'warning',
                  ms: limitMs - HANDS_FREE_WARNING_LEAD_MS
                } as const
              ]
            : [])
        ]
      }
    }

    case 'tap': {
      if (active) {
        // The tap that ends a latched hands-free session. Any other session ignores it.
        if (
          active.trigger === 'handsfree' &&
          (state.phase === 'preparing' || state.phase === 'recording')
        ) {
          return reduce(state, { type: 'stop', source: 'tap', gen: active.gen, nowMs: event.nowMs })
        }
        return ignore
      }
      if (isBusy(state)) return ignore
      return { state: { ...state, lastTapAtMs: event.nowMs }, effects: [] }
    }

    case 'capture-ready': {
      if (!active || active.gen !== event.gen || state.phase !== 'preparing') return ignore
      if (active.stopRequested) return beginFinalizing(state, active)
      return { state: { ...state, phase: 'recording' }, effects: [] }
    }

    case 'asr-ready': {
      if (!active || active.gen !== event.gen) return ignore
      return { state: { ...state, active: { ...active, asrReady: true } }, effects: [] }
    }

    case 'partial': {
      if (!active || active.gen !== event.gen) return ignore
      if (state.phase !== 'recording' && state.phase !== 'finalizing') return ignore
      return { state: { ...state, active: { ...active, partial: event.text } }, effects: [] }
    }

    case 'stop': {
      if (!active) return ignore
      if (event.gen !== undefined && event.gen !== active.gen) return ignore
      if (event.source === 'release') {
        // Only the key-up that pairs with this session's key-down may stop it.
        if (active.trigger !== 'hold' || event.holdId !== active.holdId) return ignore
      }
      // A tap only ever ends the session a double tap latched.
      if (event.source === 'tap' && active.trigger !== 'handsfree') return ignore
      if (state.phase !== 'preparing' && state.phase !== 'recording') return ignore
      const heldMs = event.nowMs - active.startedAtMs
      if (event.source === 'release' && heldMs < MIN_HOLD_MS) {
        // An accidental tap: discard instead of transcribing nothing. It may be
        // the first half of a double tap, so remember when it happened.
        const discarded = toIdle(state, null, [
          { type: 'timers-clear', gen: active.gen },
          { type: 'capture-cancel', gen: active.gen }
        ])
        return { ...discarded, state: { ...discarded.state, lastTapAtMs: event.nowMs } }
      }
      if (state.phase === 'preparing') {
        // The microphone is not open yet. Remember the intent; drain on ready.
        return { state: { ...state, active: { ...active, stopRequested: true } }, effects: [] }
      }
      return beginFinalizing(state, active)
    }

    case 'cancel': {
      if (!active) {
        // Cancel on a resting screen simply dismisses it.
        if (state.phase === 'recovery' || state.phase === 'notice') {
          return { state: { ...state, phase: 'idle', resting: null }, effects: [] }
        }
        return ignore
      }
      if (event.gen !== undefined && event.gen !== active.gen) return ignore
      // Delivery may already be touching the target; it cannot be recalled.
      if (state.phase === 'delivering') return ignore
      return toIdle(state, null, [
        { type: 'timers-clear', gen: active.gen },
        { type: 'cleanup-abort', gen: active.gen },
        { type: 'capture-cancel', gen: active.gen }
      ])
    }

    case 'final': {
      if (!active || active.gen !== event.gen) return ignore
      if (!['preparing', 'recording', 'finalizing'].includes(state.phase)) return ignore
      const text = event.text.trim()
      const clear: SessionEffect = { type: 'timers-clear', gen: active.gen }
      if (!text) return toIdle(state, notice('info', 'No speech detected.'), [clear])
      const withRaw = { ...active, rawText: text }
      if (active.cleanupMode === 'raw') {
        return {
          state: { ...state, phase: 'delivering', active: { ...withRaw, deliverText: text } },
          effects: [clear, { type: 'deliver', gen: active.gen, text }]
        }
      }
      return {
        state: { ...state, phase: 'cleaning', active: withRaw },
        effects: [
          clear,
          { type: 'cleanup-start', gen: active.gen, mode: active.cleanupMode, raw: text },
          {
            type: 'timers-set',
            gen: active.gen,
            stage: 'cleaning',
            ms: CLEANUP_TIMEOUT_MS[active.cleanupMode]
          }
        ]
      }
    }

    case 'cleanup-done': {
      if (!active || active.gen !== event.gen || state.phase !== 'cleaning') return ignore
      const raw = active.rawText ?? ''
      const text =
        event.outcome.kind === 'cleaned' && event.outcome.text.trim() ? event.outcome.text : raw
      const note = event.outcome.kind === 'kept-raw' ? event.outcome.reason : null
      return {
        state: {
          ...state,
          phase: 'delivering',
          active: { ...active, cleanupNote: note, deliverText: text }
        },
        effects: [
          { type: 'timers-clear', gen: active.gen },
          { type: 'deliver', gen: active.gen, text }
        ]
      }
    }

    case 'delivery-done': {
      if (!active || active.gen !== event.gen || state.phase !== 'delivering') return ignore
      if (event.outcome.kind === 'delivered') {
        return toIdle(state, notice('success', 'Inserted.'), [])
      }
      return toIdle(
        state,
        {
          kind: 'recovery',
          gen: active.gen,
          text: pendingText(active),
          rawText: active.rawText ?? '',
          reason: event.outcome.reason,
          ...(event.outcome.detail ? { detail: event.outcome.detail } : {})
        },
        []
      )
    }

    case 'engine-failed': {
      if (!active || active.gen !== event.gen) return ignore
      if (!['preparing', 'recording', 'finalizing'].includes(state.phase)) return ignore
      return toIdle(state, notice('error', event.message), [
        { type: 'timers-clear', gen: active.gen },
        { type: 'capture-cancel', gen: active.gen }
      ])
    }

    case 'engine-ended': {
      if (!active || active.gen !== event.gen) return ignore
      if (!['preparing', 'recording', 'finalizing'].includes(state.phase)) return ignore
      return toIdle(state, notice('error', 'The speech engine stopped before returning text.'), [
        { type: 'timers-clear', gen: active.gen }
      ])
    }

    case 'timeout': {
      if (!active || active.gen !== event.gen) return ignore
      if (event.stage === 'finalizing' && state.phase === 'finalizing') {
        return toIdle(state, notice('error', 'Transcription timed out. Nothing was inserted.'), [
          { type: 'timers-clear', gen: active.gen },
          { type: 'capture-cancel', gen: active.gen }
        ])
      }
      if (event.stage === 'cleaning' && state.phase === 'cleaning') {
        return {
          state: {
            ...state,
            phase: 'delivering',
            active: {
              ...active,
              deliverText: active.rawText ?? '',
              cleanupNote: 'Cleanup timed out; the raw transcript was used.'
            }
          },
          effects: [
            { type: 'cleanup-abort', gen: active.gen },
            { type: 'deliver', gen: active.gen, text: active.rawText ?? '' }
          ]
        }
      }
      return ignore
    }

    case 'limit-warning': {
      if (!active || active.gen !== event.gen) return ignore
      if (state.phase !== 'preparing' && state.phase !== 'recording') return ignore
      if (active.limitWarning) return ignore
      return { state: { ...state, active: { ...active, limitWarning: true } }, effects: [] }
    }

    case 'mic-state': {
      if (!active || active.gen !== event.gen || state.phase !== 'recording') return ignore
      if (active.micMuted === event.muted) return ignore
      return { state: { ...state, active: { ...active, micMuted: event.muted } }, effects: [] }
    }

    case 'mic-fallback': {
      if (!active || active.gen !== event.gen || active.micFellBack) return ignore
      if (state.phase !== 'preparing' && state.phase !== 'recording') return ignore
      return { state: { ...state, active: { ...active, micFellBack: true } }, effects: [] }
    }

    case 'dismiss': {
      if (state.phase === 'recovery' || state.phase === 'notice') {
        return { state: { ...state, phase: 'idle', resting: null }, effects: [] }
      }
      return ignore
    }

    case 'notice': {
      // Never replace a recovery the user has not dealt with, or a live session.
      if (state.phase !== 'idle' && state.phase !== 'notice') return ignore
      return {
        state: { ...state, phase: 'notice', resting: notice(event.level, event.message) },
        effects: []
      }
    }
  }
}

function beginFinalizing(state: SessionState, active: ActiveSession): Transition {
  return {
    state: { ...state, phase: 'finalizing', active },
    effects: [
      { type: 'timers-clear', gen: active.gen },
      { type: 'capture-stop', gen: active.gen },
      { type: 'timers-set', gen: active.gen, stage: 'finalizing', ms: FINALIZE_TIMEOUT_MS }
    ]
  }
}

function pendingText(active: ActiveSession): string {
  return active.deliverText ?? active.rawText ?? ''
}
