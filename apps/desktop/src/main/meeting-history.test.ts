import assert from 'node:assert/strict'
import { test } from 'node:test'
import { meetingHistoryWindow } from '../shared/meeting-history'

const nowMs = new Date('2026-08-01T12:00:00-05:00').getTime()
const items = [
  { id: 'today', createdAt: '2026-08-01T09:00:00-05:00' },
  { id: 'day-seven', createdAt: '2026-07-26T09:00:00-05:00' },
  { id: 'older-1', createdAt: '2026-07-25T09:00:00-05:00' },
  { id: 'older-2', createdAt: '2026-07-01T09:00:00-05:00' }
]

test('the default Home window shows the last seven local calendar days', () => {
  const result = meetingHistoryWindow(items, { nowMs })
  assert.deepEqual(
    result.displayed.map((item) => item.id),
    ['today', 'day-seven']
  )
  assert.equal(result.hiddenOlder, 2)
})

test('older meetings are revealed in explicit bounded batches', () => {
  const first = meetingHistoryWindow(items, { nowMs, olderVisibleCount: 1 })
  assert.deepEqual(
    first.displayed.map((item) => item.id),
    ['today', 'day-seven', 'older-1']
  )
  assert.equal(first.hiddenOlder, 1)

  const all = meetingHistoryWindow(items, { nowMs, olderVisibleCount: 30 })
  assert.equal(all.hiddenOlder, 0)
  assert.equal(all.shownOlder, 2)
})
