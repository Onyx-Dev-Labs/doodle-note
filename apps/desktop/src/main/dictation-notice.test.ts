import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initialNoticeState,
  reduceNotice,
  restorePending,
  type ClipboardNotice,
  type NoticeEvent,
  type NoticeState
} from './dictation-notice'

const X: ClipboardNotice = { kind: 'clipboard', problem: 'partial', missing: ['X (y)'] }
const Z: ClipboardNotice = { kind: 'clipboard', problem: 'partial', missing: ['Z (z)'] }
const R: ClipboardNotice = {
  kind: 'clipboard',
  problem: 'not-saved',
  reason: 'too-large',
  delivered: true
}

/** Run events; return the final state and how many notices were set. */
function run(
  events: NoticeEvent[],
  state: NoticeState = initialNoticeState()
): { state: NoticeState; shown: number; ignored: number[] } {
  let shown = 0
  const ignored: number[] = []
  events.forEach((event, i) => {
    const step = reduceNotice(state, event)
    state = step.state
    if (step.shown) shown++
    if (step.ignored) ignored.push(i)
  })
  return { state, shown, ignored }
}

test('notice rule (a): a Restore completes exactly once, by its event or its reply, whichever comes first', () => {
  const eventFirst = run([
    { type: 'request', record: 'a' },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'reply', record: 'a', outcome: 'completed', notice: X }
  ])
  assert.equal(eventFirst.shown, 1)
  assert.deepEqual(eventFirst.state.current?.notice, X)
  const replyFirst = run([
    { type: 'request', record: 'a' },
    { type: 'reply', record: 'a', outcome: 'completed', notice: X },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'recovered', record: 'a', notice: X }
  ])
  assert.equal(replyFirst.shown, 1, 'the event and its repeat are consumed')
  // A timed-out request completes by its later event.
  const timedOut = run([
    { type: 'request', record: 'a' },
    { type: 'reply', record: 'a', outcome: 'failed', notice: null },
    { type: 'recovered', record: 'a', notice: X }
  ])
  assert.equal(timedOut.shown, 1)
  assert.deepEqual(timedOut.state.current?.notice, X)
  // Any other answer ends the request: a later event for that record is not a completion of it.
  const other = run([
    { type: 'request', record: 'a' },
    { type: 'reply', record: 'a', outcome: 'other', notice: null },
    { type: 'recovered', record: 'a', notice: X }
  ])
  assert.equal(other.shown, 0)
})

test('notice rule (a): a click while that record is pending is ignored; after the reply a retry is a new request', () => {
  const r = run([
    { type: 'request', record: 'a' },
    { type: 'request', record: 'a' },
    { type: 'reply', record: 'a', outcome: 'failed', notice: null },
    { type: 'request', record: 'a' }
  ])
  assert.deepEqual(r.ignored, [1])
  assert.equal(restorePending(r.state, 'a'), true)
  assert.equal(restorePending(run([{ type: 'request', record: 'b' }]).state, 'a'), false)
})

test('notice rule (b): a superseded notice never comes back by any path of the same completion', () => {
  const r = run([
    { type: 'request', record: 'a' },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'supersede' },
    { type: 'reply', record: 'a', outcome: 'completed', notice: X },
    { type: 'recovered', record: 'a', notice: X }
  ])
  assert.equal(r.state.current, null)
  assert.equal(r.shown, 1)
})

test('notice rule (c): offer events and list refreshes are no events of the slot (only rules a, b, d and expiry change it)', () => {
  const r = run([
    { type: 'request', record: 'a' },
    { type: 'recovered', record: 'a', notice: X }
  ])
  // Nothing here models an offer-gone, an offer-added or a refresh: the slot is untouched by them by construction.
  assert.deepEqual(r.state.current?.notice, X)
})

test('notice rule (d): a newer completion or report replaces an older notice; an older completion never comes back over it', () => {
  const r = run([
    { type: 'request', record: 'a' },
    { type: 'request', record: 'b' },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'recovered', record: 'b', notice: Z },
    { type: 'reply', record: 'a', outcome: 'completed', notice: X },
    { type: 'reply', record: 'b', outcome: 'failed', notice: null }
  ])
  assert.deepEqual(r.state.current?.notice, Z)
  assert.equal(r.state.current?.record, 'b')
  const report = run([
    { type: 'request', record: 'a' },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'report', notice: R }
  ])
  assert.deepEqual(report.state.current?.notice, R)
})

test('notice rule (e): only its own timer ends a notice; an older timer never ends a newer one', () => {
  let state = initialNoticeState()
  const first = reduceNotice(state, { type: 'report', notice: R })
  state = first.state
  const second = reduceNotice(state, { type: 'report', notice: X })
  state = second.state
  state = reduceNotice(state, { type: 'expire', id: first.shown!.id }).state
  assert.deepEqual(state.current?.notice, X, 'the older timer did nothing')
  state = reduceNotice(state, { type: 'expire', id: second.shown!.id }).state
  assert.equal(state.current, null)
})

test('notice: a delivery late result withdraws only its own report, never a Restore notice', () => {
  const restore = run([
    { type: 'request', record: 'a' },
    { type: 'recovered', record: 'a', notice: X },
    { type: 'withdraw-report' }
  ])
  assert.deepEqual(restore.state.current?.notice, X)
  const report = run([{ type: 'report', notice: R }, { type: 'withdraw-report' }])
  assert.equal(report.state.current, null)
})
