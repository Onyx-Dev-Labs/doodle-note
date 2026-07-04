import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EngineTokenTiming } from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'

/** Build subword tokens the way Parakeet emits them: leading space = new word. */
function tokens(
  spec: Array<[text: string, startSec: number, endSec: number]>
): EngineTokenTiming[] {
  return spec.map(([token, startSec, endSec]) => ({ token, startSec, endSec, confidence: 0.95 }))
}

/** Turn a sentence into evenly spaced word tokens starting at `at` seconds. */
function sentence(text: string, at: number, wordSec = 0.3): EngineTokenTiming[] {
  return text.split(' ').map((word, i) => ({
    token: ` ${word}`,
    startSec: at + i * wordSec,
    endSec: at + i * wordSec + wordSec * 0.8,
    confidence: 0.95
  }))
}

test('reconstructs text from subword tokens, splitting words on leading spaces', () => {
  const a = new SegmentAssembler()
  a.addTimings(
    'mic',
    tokens([
      [' Hel', 0.5, 0.6],
      ['lo', 0.6, 0.7],
      [' wor', 0.75, 0.85],
      ['ld.', 0.85, 0.95]
    ])
  )
  const segments = a.flush('mic')
  assert.equal(segments.length, 1)
  assert.equal(segments[0]!.text, 'Hello world.')
  assert.equal(segments[0]!.speaker, 'You')
  assert.equal(segments[0]!.startMs, 500)
  assert.equal(segments[0]!.endMs, 950)
})

test('closes a segment on a pause gap', () => {
  const a = new SegmentAssembler()
  const first = a.addTimings('system', [
    ...sentence('let us review the numbers', 1.0),
    ...sentence('next topic is hiring', 4.0)
  ])
  const rest = a.flush('system')
  const all = [...first, ...rest]
  assert.equal(all.length, 2)
  assert.equal(all[0]!.text, 'let us review the numbers')
  assert.equal(all[1]!.text, 'next topic is hiring')
  assert.equal(all[0]!.speaker, 'Them')
})

test('hard-cuts very long segments', () => {
  const a = new SegmentAssembler({ maxSegmentSec: 5 })
  // 30 words, 0.5s apart, no pauses: 15s of continuous speech.
  const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
  const completed = [...a.addTimings('mic', sentence(words, 0, 0.5)), ...a.flush('mic')]
  assert.ok(completed.length >= 3, `expected >=3 segments, got ${completed.length}`)
})

test('flags mic segments that mirror the system channel as echo', () => {
  const a = new SegmentAssembler()
  a.setChannelEpoch('mic', 1_000_000)
  a.setChannelEpoch('system', 1_000_000)
  // Far side says a phrase; the mic hears it ~0.4s later (speaker bleed).
  // Segments can complete mid-stream, so collect from every call.
  const segments = [
    ...a.addTimings('system', sentence('the quarterly budget review starts today', 10.0)),
    ...a.addTimings('mic', sentence('the quarterly budget review starts today', 10.4)),
    // The user also says something of their own.
    ...a.addTimings('mic', sentence('note to self follow up with henderson', 14.0)),
    ...a.flush()
  ]
  const mic = segments.filter((s) => s.channel === 'mic')
  assert.equal(mic.length, 2)
  assert.equal(mic[0]!.echo, true, 'bleed segment should be flagged as echo')
  assert.equal(mic[1]!.echo, undefined, 'genuine speech must not be flagged')
})

test('does not flag the same words spoken far apart in time', () => {
  const a = new SegmentAssembler()
  a.addTimings('system', sentence('we should ship this next week', 5.0))
  a.addTimings('mic', sentence('we should ship this next week', 25.0))
  const mic = a.flush().filter((s) => s.channel === 'mic')
  assert.equal(mic.length, 1)
  assert.equal(mic[0]!.echo, undefined)
})

test('accounts for channel start skew when matching echo', () => {
  const a = new SegmentAssembler()
  // System capture started 1.5s after the mic: same wall-clock words have
  // system startSec 1.5 lower than mic startSec.
  a.setChannelEpoch('mic', 1_000_000)
  a.setChannelEpoch('system', 1_001_500)
  a.addTimings('system', sentence('this phrase came from the video', 8.0))
  a.addTimings('mic', sentence('this phrase came from the video', 9.6)) // 9.6 - 1.5 skew ≈ 8.1
  const mic = a.flush().filter((s) => s.channel === 'mic')
  assert.equal(mic[0]!.echo, true)
})

test('assembles words split across timings batches', () => {
  const a = new SegmentAssembler()
  a.addTimings('mic', tokens([[' Hen', 1.0, 1.1]]))
  a.addTimings(
    'mic',
    tokens([
      ['der', 1.1, 1.2],
      ['son', 1.2, 1.3]
    ])
  )
  const segments = a.flush('mic')
  assert.equal(segments[0]!.text, 'Henderson')
})

test('stamps absolute wall-clock time from the channel epoch', () => {
  const a = new SegmentAssembler()
  a.setChannelEpoch('mic', 1_750_000_000_000)
  a.addTimings('mic', sentence('hello there', 2.0))
  const [seg] = a.flush('mic')
  assert.equal(seg!.absoluteStartMs, 1_750_000_000_000 + 2000)
})
