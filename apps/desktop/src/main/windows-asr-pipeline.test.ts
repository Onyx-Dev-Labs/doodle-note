import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASR_SAMPLE_RATE,
  DecodeLoadMonitor,
  UtteranceTranscriber,
  VAD_WINDOW_SAMPLES,
  tokensFromResult,
  type OfflineRecognizerLike,
  type SpeechSegmentLike,
  type TdtResult,
  type VadLike
} from './windows-asr-pipeline'
import { calibrationSignal, liveCaptionMode } from './windows-asr-guard'

test('TDT tokens become absolute timings with real ends and confidences', () => {
  const timings = tokensFromResult(
    {
      text: 'Hi, there.',
      tokens: ['Hi', ',', ' there', '.'],
      timestamps: [0.1, 0.3, 0.4, 0.9],
      durations: [0.2, 0, 0.32, 0],
      ys_log_probs: [Math.log(0.5), -0.01, Math.log(0.9), Number.NaN]
    },
    10,
    10.95
  )
  assert.deepEqual(timings, [
    // The first token of an utterance always starts a word.
    { token: ' Hi', startSec: 10.1, endSec: 10.3, confidence: 0.5 },
    { token: ',', startSec: 10.3, endSec: 10.4, confidence: 0.99 },
    { token: ' there', startSec: 10.4, endSec: 10.72, confidence: 0.9 },
    // No duration: ends at the decoded audio limit; no log-prob: fallback.
    { token: '.', startSec: 10.9, endSec: 10.95, confidence: 0.9 }
  ])
})

/** Scripted VAD: speech is detected in the given absolute sample ranges. */
class FakeVad implements VadLike {
  private fed = 0
  private readonly queue: SpeechSegmentLike[] = []
  private emitted = new Set<number>()
  constructor(
    private readonly speech: Array<[number, number]>,
    private readonly silenceSamples = 8000
  ) {}
  acceptWaveform(samples: Float32Array): void {
    assert.equal(samples.length, VAD_WINDOW_SAMPLES)
    this.fed += samples.length
    for (const [start, end] of this.speech) {
      if (!this.emitted.has(start) && this.fed >= end + this.silenceSamples) {
        this.emitted.add(start)
        this.queue.push({ start, samples: new Float32Array(end - start) })
      }
    }
  }
  isEmpty(): boolean {
    return this.queue.length === 0
  }
  isDetected(): boolean {
    return this.speech.some(([start, end]) => this.fed > start + 4000 && this.fed <= end)
  }
  front(enableExternalBuffer?: boolean): SpeechSegmentLike {
    // Electron rejects external buffers; the pipeline must ask for a copy.
    assert.equal(enableExternalBuffer, false)
    return this.queue[0]!
  }
  pop(): void {
    this.queue.shift()
  }
  flush(): void {
    for (const [start, end] of this.speech) {
      if (!this.emitted.has(start) && this.fed > start) {
        this.emitted.add(start)
        this.queue.push({ start, samples: new Float32Array(Math.min(end, this.fed) - start) })
      }
    }
  }
}

interface FakeStream {
  samples: Float32Array
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
}

/** Fake recognizer: one word per decode, timed at 0.25 s into the window. */
function fakeRecognizer(
  words: () => string,
  decodedLengths: number[],
  values: number[] = []
): OfflineRecognizerLike<FakeStream> {
  return {
    createStream(): FakeStream {
      const stream: FakeStream = {
        samples: new Float32Array(0),
        acceptWaveform({ samples }) {
          stream.samples = samples
        }
      }
      return stream
    },
    decode(stream: FakeStream) {
      decodedLengths.push(stream.samples.length)
      values.push(stream.samples[0] ?? Number.NaN)
    },
    getResult(): TdtResult {
      const word = words()
      return {
        text: word,
        tokens: [` ${word}`],
        timestamps: [0.25],
        durations: [0.4],
        ys_log_probs: [Math.log(0.8)]
      }
    }
  }
}

const seconds = (s: number): number => Math.round(s * ASR_SAMPLE_RATE)

test('utterances decode with padding and emit absolute timings, captions and a final', () => {
  const events: Array<Record<string, unknown>> = []
  const lengths: number[] = []
  let n = 0
  const transcriber = new UtteranceTranscriber(
    fakeRecognizer(() => `word${++n}`, lengths),
    new FakeVad([
      [seconds(1), seconds(3)],
      [seconds(5), seconds(6)]
    ]),
    { channel: 'mic', interim: false, emit: (event) => events.push(event) }
  )
  // Feed 8 s in capture-sized frames.
  for (let offset = 0; offset < seconds(8); offset += 4096) {
    transcriber.ingest(new Float32Array(Math.min(4096, seconds(8) - offset)))
  }
  transcriber.finish()

  assert.equal(events[0]!.event, 'channel_start')
  const timings = events.filter((event) => event.event === 'timings')
  assert.equal(timings.length, 2)
  // 0.2 s of context on each side: the first window starts at 0.8 s.
  assert.deepEqual((timings[0]!.tokens as Array<{ startSec: number }>)[0]!.startSec, 1.05)
  assert.deepEqual((timings[1]!.tokens as Array<{ startSec: number }>)[0]!.startSec, 5.05)
  assert.deepEqual(lengths, [seconds(2.4), seconds(1.4)])
  const final = events.at(-1)!
  assert.deepEqual(final, { event: 'final', channel: 'mic', text: 'word1 word2' })
  // The caption keeps showing committed words until the host segment closes.
  const partials = events.filter((event) => event.event === 'partial').map((e) => e.text)
  assert.deepEqual(partials, ['word1', 'word2'])
})

test('interim decodes grow the caption and stop when the load guard is saturated', () => {
  const events: Array<Record<string, unknown>> = []
  const lengths: number[] = []
  const clock = 0
  const load = new DecodeLoadMonitor(10_000, 0.5, () => clock)
  const transcriber = new UtteranceTranscriber(
    fakeRecognizer(() => 'growing', lengths),
    new FakeVad([[seconds(0.5), seconds(6)]]),
    {
      channel: 'system',
      interim: true,
      interimIntervalSec: 1,
      emit: (event) => events.push(event),
      load,
      now: () => clock
    }
  )
  for (let offset = 0; offset < seconds(3.5); offset += 4096)
    transcriber.ingest(new Float32Array(4096))
  const interims = transcriber.stats.interimDecodes
  assert.ok(interims >= 2, `expected interim decodes, got ${interims}`)
  assert.ok(events.some((event) => event.event === 'partial' && event.text === 'growing'))
  // Saturate the decode budget: further interim work is skipped, not queued.
  load.record(9_000)
  for (let offset = 0; offset < seconds(2); offset += 4096)
    transcriber.ingest(new Float32Array(4096))
  assert.equal(transcriber.stats.interimDecodes, interims)
  assert.ok(transcriber.stats.skippedInterims > 0)
  transcriber.finish()
  assert.equal(transcriber.stats.utterances, 1)
})

test('live channels report lag behind the audio clock and skip optional work while late', () => {
  let clock = 0
  const transcriber = new UtteranceTranscriber(
    fakeRecognizer(() => 'x', []),
    new FakeVad([[seconds(0.5), seconds(20)]]),
    { channel: 'mic', interim: true, realtime: true, emit: () => {}, now: () => clock }
  )
  transcriber.ingest(new Float32Array(seconds(1)))
  clock = 10_000 // 10 s of wall time for 1 s of audio
  assert.ok(transcriber.lagSec() > 8)
  const before = transcriber.stats.interimDecodes
  transcriber.ingest(new Float32Array(seconds(2)))
  assert.equal(transcriber.stats.interimDecodes, before)
})

test('live lag is the queueing delay of the latest frame, not capture gaps', () => {
  let clock = 50_000
  const transcriber = new UtteranceTranscriber(
    fakeRecognizer(() => 'x', []),
    new FakeVad([]),
    {
      channel: 'mic',
      interim: true,
      realtime: true,
      emit: () => {},
      now: () => clock
    }
  )
  transcriber.ingest(new Float32Array(4096), clock - 200)
  assert.ok(Math.abs(transcriber.lagSec() - 0.2) < 1e-9)
  // A long gap in capture (device switch) is not lag once frames arrive promptly.
  clock += 30_000
  transcriber.ingest(new Float32Array(4096), clock - 10)
  assert.ok(transcriber.lagSec() < 0.05)
  transcriber.ingest(new Float32Array(4096), clock - 6_000)
  assert.ok(transcriber.lagSec() > 5)
})

test('the retained audio window wraps without corrupting utterance samples', () => {
  const values: number[] = []
  const transcriber = new UtteranceTranscriber(
    fakeRecognizer(() => 'late', [], values),
    // Speech near the end of a long session, after the ring buffer has wrapped.
    new FakeVad([[seconds(100), seconds(101)]]),
    { channel: 'mic', interim: false, paddingSec: 0, emit: () => {} }
  )
  for (let offset = 0; offset < seconds(102); offset += 4096) {
    const frame = new Float32Array(4096)
    for (let i = 0; i < frame.length; i++) frame[i] = (offset + i) / 1e7
    transcriber.ingest(frame)
  }
  transcriber.finish()
  assert.equal(values.length, 1)
  assert.ok(Math.abs(values[0]! - seconds(100) / 1e7) < 1e-6)
})

test('slow machines get utterance captions; the calibration signal is deterministic', () => {
  assert.equal(liveCaptionMode(0.1), 'interim')
  assert.equal(liveCaptionMode(0.6), 'utterance')
  assert.equal(liveCaptionMode(Number.NaN), 'utterance')
  assert.deepEqual(calibrationSignal(0.01), calibrationSignal(0.01))
  assert.equal(calibrationSignal().length, 4 * ASR_SAMPLE_RATE)
})
