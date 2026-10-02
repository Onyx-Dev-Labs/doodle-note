import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeetingTranscriptSegment } from '@repo/meetings-store/types'
import { transcriptAudioPosition, transcriptDisplayTime } from './transcript-audio'

const imported: MeetingTranscriptSegment = {
  id: 'import',
  channel: 'mic',
  speaker: 'Speaker',
  speakerId: 'imported-speaker',
  text: 'Synthetic import',
  startMs: 0,
  endMs: 10000,
  confidence: 1
}
const recorded: MeetingTranscriptSegment = {
  ...imported,
  id: 'record',
  speaker: 'Them',
  speakerId: 'far',
  channel: 'system',
  startMs: 3000,
  endMs: 6000,
  absoluteStartMs: 1790979993000
}
const parts = [
  { url: 'import', startEpochMs: 0, durationMs: 12000 },
  { url: 'record', startEpochMs: 1790979990000, durationMs: 40000 }
]

test('imported and resumed rows resolve to their own audio after switching parts', () => {
  assert.deepEqual(transcriptAudioPosition(imported, parts, 1), { partIndex: 0, offsetSec: 0 })
  assert.deepEqual(transcriptAudioPosition(recorded, parts, 0), { partIndex: 1, offsetSec: 3 })
  assert.equal(transcriptDisplayTime(imported, parts, true), 0)
  assert.equal(transcriptDisplayTime(recorded, parts, true), 15000)
})

test('mixed timeline stays bounded before the recording part is finalized or loaded', () => {
  assert.equal(transcriptDisplayTime(recorded, parts.slice(0, 1), true), 15000)
  assert.equal(transcriptDisplayTime(recorded, [], true), 3000)
})

test('recorded-only wall-clock ordering and legacy active-part fallback remain intact', () => {
  assert.equal(transcriptDisplayTime(recorded, parts.slice(1), false), 1790979993000)
  const legacyParts = [
    { ...parts[1]!, startEpochMs: 100000 },
    { ...parts[1]!, startEpochMs: 200000 }
  ]
  assert.deepEqual(transcriptAudioPosition(imported, legacyParts, 1), {
    partIndex: 1,
    offsetSec: 0
  })
})

test('untimed TXT rows never acquire playback positions or timestamps', () => {
  const text: MeetingTranscriptSegment = {
    id: 'txt',
    source: 'text',
    channel: 'text',
    speaker: 'Speaker',
    text: 'Synthetic plain text'
  }
  assert.equal(transcriptAudioPosition(text, parts), null)
  assert.equal(transcriptDisplayTime(text, parts, true), 0)
  assert.equal('startMs' in text, false)
})
