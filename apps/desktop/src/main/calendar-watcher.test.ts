import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NOTIFIED_RETENTION_MS,
  PROMPT_LOOKAHEAD_MS,
  PROMPT_LOOKBACK_MS,
  eventsToPromptNow,
  pruneNotified,
  shouldPromptNow,
  type WatchableEvent
} from './calendar-watcher'

const NOW = Date.parse('2026-07-06T10:00:00.000Z')
const NONE: ReadonlySet<string> = new Set()

function eventAt(offsetMs: number, overrides: Partial<WatchableEvent> = {}): WatchableEvent {
  return {
    id: 'ev-1',
    startIso: new Date(NOW + offsetMs).toISOString(),
    isAllDay: false,
    ...overrides
  }
}

test('prompts for an event starting right now', () => {
  assert.equal(shouldPromptNow(eventAt(0), NOW, NONE), true)
})

test('prompts inside the window: started 1min ago through starting in 2min', () => {
  assert.equal(shouldPromptNow(eventAt(-PROMPT_LOOKBACK_MS), NOW, NONE), true, 'lookback edge')
  assert.equal(shouldPromptNow(eventAt(-30_000), NOW, NONE), true, 'started 30s ago')
  assert.equal(shouldPromptNow(eventAt(90_000), NOW, NONE), true, 'starts in 90s')
  assert.equal(shouldPromptNow(eventAt(PROMPT_LOOKAHEAD_MS), NOW, NONE), true, 'lookahead edge')
})

test('does not prompt outside the window', () => {
  assert.equal(shouldPromptNow(eventAt(-PROMPT_LOOKBACK_MS - 1000), NOW, NONE), false, 'too old')
  assert.equal(
    shouldPromptNow(eventAt(PROMPT_LOOKAHEAD_MS + 1000), NOW, NONE),
    false,
    'too far out'
  )
  assert.equal(shouldPromptNow(eventAt(3_600_000), NOW, NONE), false, 'next hour')
})

test('never prompts for all-day events, even inside the window', () => {
  assert.equal(shouldPromptNow(eventAt(0, { isAllDay: true }), NOW, NONE), false)
})

test('does not prompt twice for the same event id', () => {
  const event = eventAt(0)
  assert.equal(shouldPromptNow(event, NOW, new Set([event.id])), false)
})

test('rejects unparseable start times and empty ids instead of throwing', () => {
  assert.equal(shouldPromptNow(eventAt(0, { startIso: 'not-a-date' }), NOW, NONE), false)
  assert.equal(shouldPromptNow(eventAt(0, { id: '' }), NOW, NONE), false)
})

test('eventsToPromptNow filters to the window and sorts by start', () => {
  const later = eventAt(100_000, { id: 'later' })
  const sooner = eventAt(-30_000, { id: 'sooner' })
  const allDay = eventAt(0, { id: 'all-day', isAllDay: true })
  const notified = eventAt(10_000, { id: 'seen' })
  const distant = eventAt(900_000, { id: 'distant' })
  const due = eventsToPromptNow([later, distant, allDay, sooner, notified], NOW, new Set(['seen']))
  assert.deepEqual(
    due.map((e) => e.id),
    ['sooner', 'later']
  )
})

test('pruneNotified keeps recent entries, drops stale and unparseable ones', () => {
  const fresh = new Date(NOW - 60_000).toISOString()
  const edge = new Date(NOW - NOTIFIED_RETENTION_MS).toISOString()
  const stale = new Date(NOW - NOTIFIED_RETENTION_MS - 1000).toISOString()
  const pruned = pruneNotified(
    { keepMe: fresh, edgeCase: edge, dropMe: stale, garbage: 'not-a-date' },
    NOW
  )
  assert.deepEqual(pruned, { keepMe: fresh, edgeCase: edge })
})
