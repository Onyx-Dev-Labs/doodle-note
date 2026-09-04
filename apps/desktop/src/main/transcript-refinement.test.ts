import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TranscriptSegment } from '../shared/engine-events'
import { reconcileChannelSegments, reconcileRefinedTranscript } from './transcript-refinement'

function segment(
  id: string,
  channel: 'mic' | 'system',
  text: string,
  startMs: number,
  extra: Partial<TranscriptSegment> = {}
): TranscriptSegment {
  return {
    id,
    channel,
    speaker: channel === 'mic' ? 'Sean' : 'Alec',
    speakerId: channel === 'mic' ? 'speaker:me' : 'speaker:them',
    text,
    startMs,
    endMs: startMs + 2_000,
    absoluteStartMs: 10_000 + startMs,
    confidence: 0.75,
    ...extra
  }
}

test('corrects the reported substitution while preserving live timing and identity', () => {
  const first = segment('seg_1', 'mic', 'THE VAUDE CONFIRMATION NUMBER IS SEVEN FOUR NINE', 0)
  const second = segment('seg_2', 'mic', 'THEN STOP IMMEDIATELY', 4_000)

  const result = reconcileChannelSegments([first, second], {
    channel: 'mic',
    text: 'The final confirmation number is 749, then stop immediately.'
  })

  assert.deepEqual(
    result.map(({ id, text, startMs, absoluteStartMs, speaker }) => ({
      id,
      text,
      startMs,
      absoluteStartMs,
      speaker
    })),
    [
      {
        id: 'seg_1',
        text: 'The final confirmation number is 749,',
        startMs: 0,
        absoluteStartMs: 10_000,
        speaker: 'Sean'
      },
      {
        id: 'seg_2',
        text: 'then stop immediately.',
        startMs: 4_000,
        absoluteStartMs: 14_000,
        speaker: 'Sean'
      }
    ]
  )
})

test('insertions and deletions stay near aligned live segment boundaries', () => {
  const result = reconcileChannelSegments(
    [segment('a', 'mic', 'alpha beta', 0), segment('b', 'mic', 'delta echo', 3_000)],
    { channel: 'mic', text: 'Alpha beta gamma delta.' }
  )
  assert.deepEqual(
    result.map((item) => [item.id, item.text]),
    [
      ['a', 'Alpha beta'],
      ['b', 'gamma delta.']
    ]
  )
})

test('empty or failed refinement cannot erase a usable provisional transcript', () => {
  const source = [segment('a', 'mic', 'keep this text', 0)]
  assert.deepEqual(reconcileChannelSegments(source, { channel: 'mic', text: '  ' }), source)
})

test('both channels are replaced atomically and remain chronologically ordered', () => {
  const source = [
    segment('mic', 'mic', 'helo there', 1_000),
    segment('system', 'system', 'good mornin', 0, { echo: false })
  ]
  const result = reconcileRefinedTranscript(source, [
    { channel: 'mic', text: 'Hello there.' },
    { channel: 'system', text: 'Good morning.' }
  ])
  assert.deepEqual(
    result.map((item) => [item.id, item.text]),
    [
      ['system', 'Good morning.'],
      ['mic', 'Hello there.']
    ]
  )
})

test('a final-only channel gets a bounded fallback segment', () => {
  const result = reconcileChannelSegments([], {
    channel: 'system',
    text: 'A newly detected speaker.',
    audioSeconds: 3.25
  })
  assert.deepEqual(result[0], {
    id: 'refined_system_1',
    channel: 'system',
    speaker: 'Them',
    speakerId: 'far',
    text: 'A newly detected speaker.',
    startMs: 0,
    endMs: 3250,
    confidence: 0.9
  })
})
