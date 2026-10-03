import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TranscriptSegment } from '../../../shared/engine-events'
import { mergeTranscriptSegments, reconcileTranscriptSegments } from './transcript-segments'

function part(count: number, epoch: number, label: string): TranscriptSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `seg_${index + 1}`,
    channel: 'mic',
    speaker: 'You',
    confidence: 1,
    startMs: index * 2000,
    endMs: index * 2000 + 1000,
    absoluteStartMs: epoch + index * 2000,
    text: `${label} synthetic line ${index + 1}`
  }))
}

for (const [firstCount, secondCount] of [
  [5, 8],
  [3, 4]
] as const) {
  test(`legacy ${firstCount}+${secondCount} recording parts survive reopen and snapshot overlap`, () => {
    const first = part(firstCount, 100000, 'First')
    const second = part(secondCount, 200000, 'Second')
    const saved = [...first, ...second]
    const before = JSON.stringify(saved)
    for (const snapshot of [[], second]) {
      const rows = mergeTranscriptSegments(saved, snapshot)
      assert.equal(rows.length, firstCount + secondCount)
      assert.equal(new Set(rows.map((s) => s.id)).size, rows.length, 'unique React/playhead IDs')
      assert.deepEqual(
        rows.map((s) => s.text),
        saved.map((s) => s.text),
        'Copy/AI retain all wording'
      )
      assert.deepEqual(
        rows.map((s) => s.absoluteStartMs),
        saved.map((s) => s.absoluteStartMs)
      )
    }
    assert.deepEqual(
      mergeTranscriptSegments(saved, []).map((s) => s.id),
      mergeTranscriptSegments(saved, second).map((s) => s.id),
      'stable highlight identities'
    )
    assert.equal(JSON.stringify(saved), before, 'no destructive legacy migration')
  })
}

test('snapshot corrections replace a matching copy and keep earlier same-ID parts', () => {
  const first = part(1, 100000, 'First')
  const second = part(1, 200000, 'Second')
  const revised = { ...second[0]!, text: 'Refined wording', endMs: 1500 }
  const rows = mergeTranscriptSegments([...first, ...second], [revised])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.text, first[0]!.text)
  assert.equal(rows[1]!.text, 'Refined wording')
})

test('same-time rows in distinct channels and unanchored legacy occurrences survive', () => {
  const base = part(1, 100000, 'First')[0]!
  const unanchored = { ...base }
  delete unanchored.absoluteStartMs
  const saved = [base, { ...base, channel: 'system' }, unanchored, { ...unanchored }]
  const rows = mergeTranscriptSegments(saved, saved)
  assert.equal(rows.length, 4)
  assert.equal(new Set(rows.map((s) => s.id)).size, 4)
})

test('untimed text keeps provenance and order without manufactured audio fields', () => {
  const saved = [{ id: 'text_1', source: 'text', channel: 'text', text: 'Plain text' }]
  const rows = mergeTranscriptSegments(saved, [])
  assert.equal(rows[0]!.text, 'Plain text')
  assert.equal(rows[0]!.source, 'text')
  assert.equal('startMs' in rows[0]!, false)
  assert.equal('absoluteStartMs' in rows[0]!, false)
})

test('recovered ended snapshots promote once across repeated Resume without wrapping source IDs', () => {
  for (const modernIds of [false, true]) {
    const first = part(3, 100000, 'First')
    const second = part(4, 200000, 'Second')
    if (modernIds) {
      for (const segment of first) segment.id = `session-one-${segment.id}`
      for (const segment of second) segment.id = `session-two-${segment.id}`
    }
    let saved = [...first, ...second]
    const originalIds = saved.map((s) => s.id)
    const originalViewIds = mergeTranscriptSegments(saved, second).map((s) => s.id)
    for (let resume = 0; resume < 2; resume++) {
      saved = reconcileTranscriptSegments(saved, second)
      assert.equal(saved.length, 7)
      assert.deepEqual(
        saved.map((s) => s.id),
        originalIds
      )
      assert.deepEqual(
        mergeTranscriptSegments(saved, []).map((s) => s.id),
        originalViewIds
      )
    }
    const third = part(2, 300000, 'Third')
    saved = reconcileTranscriptSegments(saved, third)
    assert.equal(saved.length, 9, 'a truly new session is still appended')
    assert.equal(reconcileTranscriptSegments(saved, third).length, 9)
  }
})
