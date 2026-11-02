import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DOUBLE_TAP_WINDOW_MS,
  HANDS_FREE_MAX_RECORDING_MS,
  HANDS_FREE_WARNING_LEAD_MS,
  HOLD_MAX_RECORDING_MS,
  MIN_HOLD_MS,
  initialSessionState,
  isBusy,
  isDoubleTap,
  isHandsFree,
  recordingLimitMs,
  reduce,
  type CleanupMode,
  type DictationTrigger,
  type SessionEffect,
  type SessionEvent,
  type SessionState
} from '../shared/dictation-session'

function run(
  events: SessionEvent[],
  from: SessionState = initialSessionState()
): { state: SessionState; effects: SessionEffect[] } {
  let state = from
  const effects: SessionEffect[] = []
  for (const event of events) {
    const next = reduce(state, event)
    state = next.state
    effects.push(...next.effects)
  }
  return { state, effects }
}

const start = (
  cleanupMode: CleanupMode = 'raw',
  trigger: DictationTrigger = 'toggle',
  nowMs = 0,
  holdId?: number
): SessionEvent => ({
  type: 'start',
  trigger,
  cleanupMode,
  nowMs,
  ...(holdId !== undefined ? { holdId } : {})
})
const types = (effects: SessionEffect[]): string[] => effects.map((e) => e.type)

test('toggle: start → ready → stop → final → deliver exactly once', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'toggle', nowMs: 5000 },
    { type: 'final', gen: 1, text: ' hello world ' }
  ])
  assert.equal(r.state.phase, 'delivering')
  const deliveries = r.effects.filter((e) => e.type === 'deliver')
  assert.equal(deliveries.length, 1)
  assert.deepEqual(deliveries[0], { type: 'deliver', gen: 1, text: 'hello world' })
  // A duplicate final for the same session cannot produce a second insertion.
  const again = reduce(r.state, { type: 'final', gen: 1, text: 'hello world' })
  assert.deepEqual(again.effects, [])
})

test('stop drains buffered audio: capture-stop precedes the final, never capture-cancel', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 }
  ])
  assert.equal(r.state.phase, 'finalizing')
  assert.ok(types(r.effects).includes('capture-stop'))
  assert.ok(!types(r.effects).includes('capture-cancel'))
})

test('cancel aborts processing and a late final cannot insert', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'cancel' }
  ])
  assert.equal(r.state.phase, 'idle')
  assert.ok(types(r.effects).includes('capture-cancel'))
  const late = reduce(r.state, { type: 'final', gen: 1, text: 'too late' })
  assert.deepEqual(late.effects, [])
  assert.equal(late.state.phase, 'idle')
})

test('a late result from an older session never reaches a newer one', () => {
  const first = run([start(), { type: 'cancel' }])
  const second = run([start()], first.state)
  assert.equal(second.state.active?.gen, 2)
  for (const stale of [
    { type: 'final', gen: 1, text: 'old words' },
    { type: 'partial', gen: 1, text: 'old' },
    { type: 'capture-ready', gen: 1 },
    { type: 'delivery-done', gen: 1, outcome: { kind: 'delivered' } },
    { type: 'cleanup-done', gen: 1, outcome: { kind: 'cleaned', text: 'x' } },
    { type: 'engine-failed', gen: 1, message: 'boom' }
  ] as SessionEvent[]) {
    const out = reduce(second.state, stale)
    assert.equal(out.state, second.state, `${stale.type} must be ignored`)
    assert.deepEqual(out.effects, [])
  }
})

test('stop during startup defers until the microphone opens, then drains', () => {
  let r = run([start(), { type: 'stop', source: 'toggle', nowMs: 800 }])
  assert.equal(r.state.phase, 'preparing')
  assert.equal(r.state.active?.stopRequested, true)
  assert.ok(!types(r.effects).includes('capture-stop'))
  r = run([{ type: 'capture-ready', gen: 1 }], r.state)
  assert.equal(r.state.phase, 'finalizing')
  assert.ok(types(r.effects).includes('capture-stop'))
})

test('hold: only the paired key-up stops, and an unpaired up is ignored', () => {
  const held = run([start('raw', 'hold', 0, 7), { type: 'capture-ready', gen: 1 }])
  const wrong = reduce(held.state, { type: 'stop', source: 'release', holdId: 6, nowMs: 2000 })
  assert.equal(wrong.state, held.state)
  const right = reduce(held.state, { type: 'stop', source: 'release', holdId: 7, nowMs: 2000 })
  assert.equal(right.state.phase, 'finalizing')
})

test('a toggle session ignores a stray hold release', () => {
  const toggled = run([start('raw', 'toggle'), { type: 'capture-ready', gen: 1 }])
  const out = reduce(toggled.state, { type: 'stop', source: 'release', holdId: 1, nowMs: 5000 })
  assert.equal(out.state, toggled.state)
})

test('a very short hold is discarded instead of transcribed', () => {
  const r = run([
    start('raw', 'hold', 1000, 3),
    { type: 'stop', source: 'release', holdId: 3, nowMs: 1000 + MIN_HOLD_MS - 1 }
  ])
  assert.equal(r.state.phase, 'idle')
  assert.ok(types(r.effects).includes('capture-cancel'))
  assert.ok(!types(r.effects).includes('deliver'))
})

test('silence produces a notice and no insertion', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: '   ' }
  ])
  assert.equal(r.state.phase, 'notice')
  assert.ok(!types(r.effects).includes('deliver'))
})

test('a second start while busy is refused and changes nothing', () => {
  const busy = run([start(), { type: 'capture-ready', gen: 1 }])
  const out = reduce(busy.state, start())
  assert.ok(out.refused)
  assert.equal(out.state, busy.state)
  assert.ok(isBusy(busy.state))
})

test('cleanup mode is snapshotted at start', () => {
  const r = run([start('local'), { type: 'capture-ready', gen: 1 }])
  assert.equal(r.state.active?.cleanupMode, 'local')
  const done = run(
    [
      { type: 'stop', source: 'button', nowMs: 900 },
      { type: 'final', gen: 1, text: 'um so yes' }
    ],
    r.state
  )
  assert.equal(done.state.phase, 'cleaning')
  const effect = done.effects.find((e) => e.type === 'cleanup-start')
  assert.deepEqual(effect && 'mode' in effect && effect.mode, 'local')
})

test('cleanup success delivers the cleaned text; failure keeps raw', () => {
  const base = run([
    start('byok'),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'um so yes' }
  ])
  const ok = reduce(base.state, {
    type: 'cleanup-done',
    gen: 1,
    outcome: { kind: 'cleaned', text: 'So, yes.' }
  })
  assert.deepEqual(
    ok.effects.find((e) => e.type === 'deliver'),
    {
      type: 'deliver',
      gen: 1,
      text: 'So, yes.'
    }
  )
  const failed = reduce(base.state, {
    type: 'cleanup-done',
    gen: 1,
    outcome: { kind: 'kept-raw', reason: 'The model is busy.' }
  })
  assert.deepEqual(
    failed.effects.find((e) => e.type === 'deliver'),
    {
      type: 'deliver',
      gen: 1,
      text: 'um so yes'
    }
  )
  assert.equal(failed.state.active?.cleanupNote, 'The model is busy.')
})

test('cleanup timeout aborts cleanup and keeps the raw transcript', () => {
  const base = run([
    start('local'),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'raw words' },
    { type: 'timeout', gen: 1, stage: 'cleaning' }
  ])
  assert.equal(base.state.phase, 'delivering')
  assert.ok(types(base.effects).includes('cleanup-abort'))
  assert.deepEqual(base.effects.filter((e) => e.type === 'deliver').at(-1), {
    type: 'deliver',
    gen: 1,
    text: 'raw words'
  })
  // The cleanup result arriving after the timeout is stale.
  const late = reduce(base.state, {
    type: 'cleanup-done',
    gen: 1,
    outcome: { kind: 'cleaned', text: 'late polish' }
  })
  assert.deepEqual(late.effects, [])
})

test('cancel during cleanup aborts it and nothing is delivered', () => {
  const r = run([
    start('local'),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'raw words' },
    { type: 'cancel' }
  ])
  assert.equal(r.state.phase, 'idle')
  assert.ok(types(r.effects).includes('cleanup-abort'))
  assert.equal(r.effects.filter((e) => e.type === 'deliver').length, 0)
})

test('cancel during delivery is ignored: insertion cannot be recalled', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'hello' }
  ])
  const cancelled = reduce(r.state, { type: 'cancel' })
  assert.equal(cancelled.state.phase, 'delivering')
})

test('uncertain or refused delivery retains the exact text for recovery', () => {
  const r = run([
    start('local'),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'raw words' },
    { type: 'cleanup-done', gen: 1, outcome: { kind: 'cleaned', text: 'Clean words.' } },
    { type: 'delivery-done', gen: 1, outcome: { kind: 'recover', reason: 'insertion-uncertain' } }
  ])
  assert.equal(r.state.phase, 'recovery')
  assert.equal(r.state.resting?.kind, 'recovery')
  if (r.state.resting?.kind === 'recovery') {
    assert.equal(r.state.resting.text, 'Clean words.')
    assert.equal(r.state.resting.rawText, 'raw words')
    assert.equal(r.state.resting.reason, 'insertion-uncertain')
  }
  assert.ok(types(r.effects).includes('escape-unregister'))
})

test('engine failure during startup or finalize ends the session with an error', () => {
  const r = run([start(), { type: 'engine-failed', gen: 1, message: 'Microphone unplugged' }])
  assert.equal(r.state.phase, 'notice')
  assert.equal(r.state.resting?.kind, 'notice')
  assert.ok(types(r.effects).includes('capture-cancel'))
  const ended = run([start(), { type: 'capture-ready', gen: 1 }, { type: 'engine-ended', gen: 1 }])
  assert.equal(ended.state.phase, 'notice')
})

test('finalize timeout drops the session without inserting', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'timeout', gen: 1, stage: 'finalizing' }
  ])
  assert.equal(r.state.phase, 'notice')
  assert.ok(!types(r.effects).includes('deliver'))
})

test('a new session may start from a resting screen; the generation advances', () => {
  const failed = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'button', nowMs: 900 },
    { type: 'final', gen: 1, text: 'kept' },
    { type: 'delivery-done', gen: 1, outcome: { kind: 'recover', reason: 'focus-changed' } }
  ])
  const next = run([start()], failed.state)
  assert.equal(next.state.active?.gen, 2)
  assert.equal(next.state.resting, null)
})

test('the recording limit is armed at start and cleared on stop', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'limit', nowMs: 180000 }
  ])
  const timers = r.effects.filter((e) => e.type === 'timers-set')
  assert.equal(timers[0]?.type === 'timers-set' && timers[0].stage, 'recording')
  assert.ok(types(r.effects).includes('timers-clear'))
  assert.equal(r.state.phase, 'finalizing')
})

/* ---- hands-free: limits, warning, double tap ---- */

const timersOf = (effects: SessionEffect[]): Array<{ stage: string; ms: number }> =>
  effects.flatMap((e) => (e.type === 'timers-set' ? [{ stage: e.stage, ms: e.ms }] : []))

test('hands-free sessions allow 20 minutes and warn at 19; hold keeps its short bound', () => {
  assert.equal(HANDS_FREE_MAX_RECORDING_MS, 20 * 60_000)
  assert.equal(HANDS_FREE_MAX_RECORDING_MS - HANDS_FREE_WARNING_LEAD_MS, 19 * 60_000)
  for (const trigger of ['toggle', 'handsfree', 'pill', 'menu'] as const) {
    assert.equal(isHandsFree(trigger), true)
    assert.equal(recordingLimitMs(trigger), HANDS_FREE_MAX_RECORDING_MS)
    const r = run([{ type: 'start', trigger, cleanupMode: 'raw', nowMs: 0 }])
    assert.deepEqual(timersOf(r.effects), [
      { stage: 'recording', ms: 20 * 60_000 },
      { stage: 'warning', ms: 19 * 60_000 }
    ])
  }
  assert.equal(isHandsFree('hold'), false)
  assert.equal(recordingLimitMs('hold'), HOLD_MAX_RECORDING_MS)
  const hold = run([start('raw', 'hold', 0, 1)])
  assert.deepEqual(timersOf(hold.effects), [{ stage: 'recording', ms: HOLD_MAX_RECORDING_MS }])
})

test('the 19-minute warning shows once while recording and is dropped after the session', () => {
  const live = run([start(), { type: 'capture-ready', gen: 1 }])
  assert.equal(live.state.active?.limitWarning, false)
  const warned = reduce(live.state, { type: 'limit-warning', gen: 1 })
  assert.equal(warned.state.active?.limitWarning, true)
  // Repeats and wrong generations change nothing.
  assert.equal(reduce(warned.state, { type: 'limit-warning', gen: 1 }).state, warned.state)
  assert.equal(reduce(live.state, { type: 'limit-warning', gen: 9 }).state, live.state)
  // At the limit the dictation is finished and inserted, not thrown away.
  const limited = reduce(warned.state, { type: 'stop', source: 'limit', gen: 1, nowMs: 1_200_000 })
  assert.equal(limited.state.phase, 'finalizing')
  assert.ok(types(limited.effects).includes('capture-stop'))
  // A warning after the session ended is stale.
  const done = run([{ type: 'cancel' }], warned.state)
  assert.equal(reduce(done.state, { type: 'limit-warning', gen: 1 }).state, done.state)
})

test('isDoubleTap: inside the window counts, outside or backwards does not', () => {
  assert.equal(isDoubleTap(null, 1000), false)
  assert.equal(isDoubleTap(1000, 1000), true)
  assert.equal(isDoubleTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS), true)
  assert.equal(isDoubleTap(1000, 1000 + DOUBLE_TAP_WINDOW_MS + 1), false)
  assert.equal(isDoubleTap(1000, 999), false)
})

test('a quick tap with nothing running only remembers when it happened', () => {
  const r = run([{ type: 'tap', nowMs: 5000 }])
  assert.equal(r.state.phase, 'idle')
  assert.equal(r.state.lastTapAtMs, 5000)
  assert.deepEqual(r.effects, [])
})

test('a hold right after a tap latches hands-free; its key-up does not stop it', () => {
  const r = run([
    { type: 'tap', nowMs: 5000 },
    { ...start('raw', 'hold', 5000 + DOUBLE_TAP_WINDOW_MS, 7), doubleTap: true } as SessionEvent,
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'release', holdId: 7, nowMs: 5000 + DOUBLE_TAP_WINDOW_MS + 90 }
  ])
  assert.equal(r.state.active?.trigger, 'handsfree')
  assert.equal(r.state.phase, 'recording', 'letting go of the latching press keeps recording')
  assert.equal(r.state.lastTapAtMs, null, 'the pair is consumed')
  assert.ok(timersOf(r.effects).some((t) => t.stage === 'warning'))
})

test('a hold outside the window, or with double tap off, stays hold-to-talk', () => {
  const late = run([
    { type: 'tap', nowMs: 5000 },
    { ...start('raw', 'hold', 5000 + DOUBLE_TAP_WINDOW_MS + 1, 1), doubleTap: true } as SessionEvent
  ])
  assert.equal(late.state.active?.trigger, 'hold')
  const off = run([{ type: 'tap', nowMs: 5000 }, start('raw', 'hold', 5100, 1)])
  assert.equal(off.state.active?.trigger, 'hold')
  assert.equal(off.state.lastTapAtMs, null)
})

test('a discarded short hold counts as the first tap of a double tap', () => {
  const r = run([
    start('raw', 'hold', 1000, 1),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'release', holdId: 1, nowMs: 1000 + MIN_HOLD_MS - 1 }
  ])
  assert.equal(r.state.phase, 'idle')
  assert.equal(r.state.lastTapAtMs, 1000 + MIN_HOLD_MS - 1)
  assert.ok(types(r.effects).includes('capture-cancel'))
  const second = run(
    [{ ...start('raw', 'hold', 1000 + MIN_HOLD_MS + 100, 2), doubleTap: true } as SessionEvent],
    r.state
  )
  assert.equal(second.state.active?.trigger, 'handsfree')
})

test('a real hold-to-talk (past the tap threshold) does not arm a double tap', () => {
  const r = run([
    start('raw', 'hold', 1000, 1),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'release', holdId: 1, nowMs: 1000 + MIN_HOLD_MS }
  ])
  assert.equal(r.state.phase, 'finalizing')
  assert.equal(r.state.lastTapAtMs, null)
})

test('the next tap stops a latched session; taps never stop other sessions', () => {
  const latched = run([
    { type: 'tap', nowMs: 100 },
    { ...start('raw', 'hold', 200, 1), doubleTap: true } as SessionEvent,
    { type: 'capture-ready', gen: 1 }
  ])
  const stopped = reduce(latched.state, { type: 'tap', nowMs: 9000 })
  assert.equal(stopped.state.phase, 'finalizing')
  assert.ok(types(stopped.effects).includes('capture-stop'))

  for (const trigger of ['toggle', 'hold', 'pill'] as const) {
    const live = run([start('raw', trigger, 0, 1), { type: 'capture-ready', gen: 1 }])
    assert.equal(reduce(live.state, { type: 'tap', nowMs: 5000 }).state, live.state)
    const direct = reduce(live.state, { type: 'stop', source: 'tap', nowMs: 5000 })
    assert.equal(direct.state, live.state, `${trigger}: a tap-sourced stop is ignored`)
  }
})

test('a tap during startup of a latched session drains once the microphone opens', () => {
  const r = run([
    { type: 'tap', nowMs: 100 },
    { ...start('raw', 'hold', 200, 1), doubleTap: true } as SessionEvent,
    { type: 'tap', nowMs: 900 }
  ])
  assert.equal(r.state.active?.stopRequested, true)
  const ready = reduce(r.state, { type: 'capture-ready', gen: 1 })
  assert.equal(ready.state.phase, 'finalizing')
})

test('taps while a session is finishing are ignored and do not arm anything', () => {
  const r = run([
    start(),
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'toggle', nowMs: 900 },
    { type: 'tap', nowMs: 1000 }
  ])
  assert.equal(r.state.phase, 'finalizing')
  assert.equal(r.state.lastTapAtMs, null)
})

test('microphone muted and fallback flags track the live session only', () => {
  const live = run([
    { ...start(), micFellBack: true } as SessionEvent,
    { type: 'capture-ready', gen: 1 }
  ])
  assert.equal(live.state.active?.micFellBack, true)
  const muted = reduce(live.state, { type: 'mic-state', gen: 1, muted: true })
  assert.equal(muted.state.active?.micMuted, true)
  assert.equal(reduce(muted.state, { type: 'mic-state', gen: 1, muted: true }).state, muted.state)
  const cleared = reduce(muted.state, { type: 'mic-state', gen: 1, muted: false })
  assert.equal(cleared.state.active?.micMuted, false)
  assert.equal(reduce(live.state, { type: 'mic-state', gen: 2, muted: true }).state, live.state)
  const preparing = run([start()])
  assert.equal(
    reduce(preparing.state, { type: 'mic-state', gen: 1, muted: true }).state,
    preparing.state,
    'nothing to report before the microphone is open'
  )
  const fell = reduce(preparing.state, { type: 'mic-fallback', gen: 1 })
  assert.equal(fell.state.active?.micFellBack, true)
})
