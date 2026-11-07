import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { EngineTokenTiming } from '../shared/engine-events'
import {
  ASR_SAMPLE_RATE,
  DecodeLoadMonitor,
  FORCED_CUT_OVERLAP_SEC,
  LIVE_VAD,
  UtteranceTranscriber,
  VAD_WINDOW_SAMPLES,
  keepWords,
  sameWord,
  stitchSeam,
  tokensFromResult,
  type OfflineRecognizerLike,
  type TdtResult,
  type VadLike,
  type VadSettings
} from './windows-asr-pipeline'
import { calibrationSignal, liveCaptionMode } from './windows-asr-guard'

const rate = ASR_SAMPLE_RATE
const seconds = (s: number): number => Math.round(s * rate)

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
    { token: ' Hi', startSec: 10.1, endSec: 10.3, confidence: 0.5 },
    { token: ',', startSec: 10.3, endSec: 10.4, confidence: 0.99 },
    { token: ' there', startSec: 10.4, endSec: 10.72, confidence: 0.9 },
    { token: '.', startSec: 10.9, endSec: 10.95, confidence: 0.9 }
  ])
})

test('words are kept whole by their start time', () => {
  const t = (token: string, startSec: number): EngineTokenTiming => ({
    token,
    startSec,
    endSec: startSec + 0.1,
    confidence: 1
  })
  const tokens = [t(' one', 0.9), t('s', 1.05), t(' two', 1.1), t(',', 1.3), t(' three', 2)]
  assert.deepEqual(
    keepWords(tokens, 1, 2).map((token) => token.token),
    [' two', ',']
  )
  // A word that starts before the cut belongs to the left side, suffix included.
  assert.deepEqual(
    keepWords(tokens, 0, 1).map((token) => token.token),
    [' one', 's']
  )
})

/**
 * Scripted VAD with Silero's timing: detection turns on `minSpeech` after a
 * speech range starts and off `minSilence` after it ends.
 */
class FakeVad implements VadLike {
  private fed = 0
  resets = 0
  /** After a reset, detection needs the minimum speech again. */
  private resetAt = -1
  constructor(
    private readonly speech: Array<[number, number]>,
    private readonly settings: VadSettings = LIVE_VAD
  ) {}
  acceptWaveform(samples: Float32Array): void {
    assert.equal(samples.length, VAD_WINDOW_SAMPLES)
    this.fed += samples.length
  }
  isDetected(): boolean {
    const onset = seconds(this.settings.minSpeechSec)
    const silence = seconds(this.settings.minSilenceSec)
    if (this.resetAt >= 0 && this.fed < this.resetAt + onset) return false
    return this.speech.some(([start, end]) => this.fed >= start + onset && this.fed < end + silence)
  }
  isEmpty(): boolean {
    return true
  }
  reset(): void {
    this.resets++
    this.resetAt = this.fed
  }
  clear(): void {
    /* The fake keeps no segment queue. */
  }
}

/**
 * Audio carries its own absolute sample index (value = index / 1e7), so the
 * fake recognizer knows where each window lies and "hears" one word every
 * 0.25 s of absolute time inside speech ranges, like a model would.
 */
function gridRecognizer(
  speech: Array<[number, number]>,
  windows: Array<[number, number]>,
  jitterSec = 0
): OfflineRecognizerLike<{
  samples: Float32Array
  acceptWaveform(o: { samples: Float32Array }): void
}> {
  return {
    createStream() {
      const stream = {
        samples: new Float32Array(0) as Float32Array,
        acceptWaveform({ samples }: { samples: Float32Array }) {
          stream.samples = samples
        }
      }
      return stream
    },
    decode(stream) {
      const start = Math.round(stream.samples[0]! * 1e7)
      windows.push([start, start + stream.samples.length])
    },
    getResult(stream): TdtResult {
      // Context moves a model's timestamps a little; alternate the shift.
      const shift = windows.length % 2 === 0 ? jitterSec : -jitterSec
      const start = Math.round(stream.samples[0]! * 1e7)
      const end = start + stream.samples.length
      const tokens: string[] = []
      const timestamps: number[] = []
      for (let at = Math.ceil(start / 4000) * 4000; at < end - 1600; at += 4000) {
        if (!speech.some(([a, b]) => at >= a && at < b)) continue
        tokens.push(` w${at / 4000}`)
        timestamps.push(Math.max(0, (at - start) / rate + shift))
      }
      return {
        text: tokens.join(''),
        tokens,
        timestamps,
        durations: tokens.map(() => 0.1),
        ys_log_probs: tokens.map(() => 0)
      }
    }
  }
}

function feed(
  transcriber: { ingest(samples: Float32Array): void },
  totalSamples: number,
  frame = 4096
): void {
  for (let offset = 0; offset < totalSamples; offset += frame) {
    const chunk = new Float32Array(Math.min(frame, totalSamples - offset))
    for (let i = 0; i < chunk.length; i++) chunk[i] = (offset + i) / 1e7
    transcriber.ingest(chunk)
  }
}

function run(
  speech: Array<[number, number]>,
  totalSamples: number,
  settings: VadSettings = LIVE_VAD,
  jitterSec = 0
): {
  words: number[]
  windows: Array<[number, number]>
  events: Array<Record<string, unknown>>
  transcriber: UtteranceTranscriber
} {
  const events: Array<Record<string, unknown>> = []
  const windows: Array<[number, number]> = []
  const transcriber = new UtteranceTranscriber(
    gridRecognizer(speech, windows, jitterSec) as never,
    new FakeVad(speech, settings),
    { channel: 'mic', interim: false, vadSettings: settings, emit: (event) => events.push(event) }
  )
  feed(transcriber, totalSamples)
  transcriber.finish()
  const words = events
    .filter((event) => event.event === 'timings')
    .flatMap((event) => (event.tokens as EngineTokenTiming[]).map((t) => Number(t.token.slice(2))))
  return { words, windows, events, transcriber }
}

function expectedWords(speech: Array<[number, number]>): number[] {
  const words: number[] = []
  for (const [a, b] of speech) {
    for (let at = Math.ceil(a / 4000) * 4000; at < b; at += 4000) words.push(at / 4000)
  }
  return words
}

test('a 100 s utterance with no pause is cut, fully decoded and never doubled', () => {
  const speech: Array<[number, number]> = [[seconds(2), seconds(102)]]
  const { words, windows, transcriber } = run(speech, seconds(105))
  // Every word heard exactly once: nothing lost at the buffer edge or a cut.
  assert.deepEqual(words, expectedWords(speech))
  // The bound is real: no decode is longer than the cap plus context.
  const cap = LIVE_VAD.maxSpeechSec + 2 * FORCED_CUT_OVERLAP_SEC + 0.2
  for (const [a, b] of windows) assert.ok((b - a) / rate <= cap, `${(b - a) / rate}s decode`)
  assert.ok(transcriber.stats.forcedCuts >= 100 / LIVE_VAD.maxSpeechSec - 1)
})

test('words timed on either side of a forced cut by the two decodes are kept exactly once', () => {
  const speech: Array<[number, number]> = [[seconds(2), seconds(80)]]
  for (const jitter of [0.05, 0.12, 0.2]) {
    const { words } = run(speech, seconds(83), LIVE_VAD, jitter)
    assert.deepEqual(words, expectedWords(speech), `jitter ${jitter}s`)
  }
})

/** The seam cases from review: the two decodes disagree in text or timing. */
function seamCase(
  committed: Array<[string, number]>,
  cutSec: number,
  second: Array<[string, number]>
): string {
  const norm = (text: string): string => text.toLowerCase().replace(/[^a-z0-9']/g, '')
  const kept = stitchSeam(
    second.map(([text, startSec]) => ({
      token: ` ${text}`,
      startSec,
      endSec: startSec + 0.25,
      confidence: 0.9
    })),
    {
      cutSec,
      words: committed
        .filter(([, startSec]) => startSec >= cutSec - 1.5)
        .map(([text, startSec]) => ({ norm: norm(text), startSec }))
    }
  )
  return [...committed.map(([text]) => text), ...kept.map((token) => token.token.trim())].join(' ')
}

test('a forced-cut seam survives spelling variants, dropped and repeated words, and silence', () => {
  // The second decode spells the committed name differently, a little later.
  assert.equal(
    seamCase(
      [
        ['notes', 9],
        ['to', 9.35],
        ['Priya', 9.6]
      ],
      10,
      [
        ['notes', 9.05],
        ['to', 9.4],
        ['Pria', 9.75],
        ['before', 10.2],
        ['Friday', 10.5]
      ]
    ),
    'notes to Priya before Friday'
  )
  // It drops a short function word; "the" is not "there".
  assert.equal(
    seamCase(
      [
        ['signed', 9.3],
        ['the', 9.7]
      ],
      10,
      [
        ['signed', 9.3],
        ['contract', 9.9],
        ['over', 10.4],
        ['there', 10.8],
        ['today', 11.1]
      ]
    ),
    'signed the contract over there today'
  )
  // A repeated word next to the cut is not swallowed.
  assert.equal(
    seamCase(
      [
        ['said', 8.9],
        ['no', 9.3]
      ],
      10,
      [
        ['said', 9.2],
        ['no', 9.9],
        ['no', 10.3],
        ['way', 10.6]
      ]
    ),
    'said no no way'
  )
  // The cut landed in silence: nothing committed nearby, so every word is new.
  assert.equal(
    seamCase([['okay', 7.8]], 10, [
      ['budget', 9.6],
      ['review', 10.1]
    ]),
    'okay budget review'
  )
  // A word the first decode placed after the cut and the second before it.
  assert.equal(
    seamCase(
      [
        ['the', 9.2],
        ['vendor', 9.5]
      ],
      10,
      [
        ['the', 9.1],
        ['vendor', 9.4],
        ['contract', 9.8],
        ['expires', 10.3]
      ]
    ),
    'the vendor contract expires'
  )
  assert.equal(sameWord('the', 'there'), false)
  assert.equal(sameWord('priya', 'pria'), true)
  assert.equal(sameWord('redesign', 'redesigned'), true)
})

/** Like gridRecognizer, but every other decode misspells words and drops "of". */
function noisyRecognizer(speech: Array<[number, number]>): OfflineRecognizerLike<{
  samples: Float32Array
  acceptWaveform(o: { samples: Float32Array }): void
}> {
  const vocabulary = [
    'planning',
    'review',
    'of',
    'billing',
    'service',
    'vendor',
    'contract',
    'the',
    'budget',
    'Priya'
  ]
  let decodes = 0
  return {
    createStream() {
      const stream = {
        samples: new Float32Array(0) as Float32Array,
        acceptWaveform({ samples }: { samples: Float32Array }) {
          stream.samples = samples
        }
      }
      return stream
    },
    decode() {
      decodes++
    },
    getResult(stream): TdtResult {
      const noisy = decodes % 2 === 0
      const start = Math.round(stream.samples[0]! * 1e7)
      const end = start + stream.samples.length
      const tokens: string[] = []
      const timestamps: number[] = []
      for (let at = Math.ceil(start / 4000) * 4000; at < end - 1600; at += 4000) {
        if (!speech.some(([a, b]) => at >= a && at < b)) continue
        let word = vocabulary[(at / 4000) % vocabulary.length]!
        if (noisy && word === 'of') continue
        if (noisy && word.length >= 5) word = word.slice(0, -1) // "Priy", "billin"
        tokens.push(` ${word}`)
        timestamps.push(Math.max(0, (at - start) / rate + (noisy ? 0.15 : -0.1)))
      }
      return { text: tokens.join(''), tokens, timestamps }
    }
  }
}

test('decodes that disagree in spelling and drop words never double or lose a word across cuts', () => {
  const speech: Array<[number, number]> = [[seconds(1), seconds(61)]]
  const events: Array<Record<string, unknown>> = []
  const transcriber = new UtteranceTranscriber(
    noisyRecognizer(speech) as never,
    new FakeVad(speech),
    {
      channel: 'mic',
      interim: false,
      emit: (event) => events.push(event)
    }
  )
  feed(transcriber, seconds(63))
  transcriber.finish()
  const words = events
    .filter((event) => event.event === 'timings')
    .flatMap((event) => (event.tokens as EngineTokenTiming[]).map((t) => t.token.trim()))
  // One word per 0.25 s slot of speech, minus at most the "of"s a noisy part dropped.
  const slots = expectedWords(speech).length
  const ofs = expectedWords(speech).filter((slot) => slot % 10 === 2).length
  assert.ok(words.length <= slots, `${words.length} words for ${slots} slots (doubles)`)
  assert.ok(words.length >= slots - ofs, `${words.length} words for ${slots} slots (losses)`)
  for (let i = 1; i < words.length; i++) {
    assert.ok(!(words[i] === words[i - 1] && words[i] !== 'the'), `doubled "${words[i]}" at ${i}`)
  }
})

test('the VAD buffer is bounded during hours-long speech without losing a word', () => {
  const speech: Array<[number, number]> = [[seconds(1), seconds(181)]]
  const { words, transcriber } = run(speech, seconds(183))
  assert.deepEqual(words, expectedWords(speech))
  // A 180 s run resets Silero at least twice (every 60 s of detection).
  assert.ok(transcriber.stats.vadResets >= 2, `${transcriber.stats.vadResets} resets`)
})

test('imports bound utterances the same way with their own cap', () => {
  const settings: VadSettings = { ...LIVE_VAD, minSilenceSec: 1, maxSpeechSec: 30 }
  const speech: Array<[number, number]> = [[seconds(1), seconds(99)]]
  const { words, windows } = run(speech, seconds(102), settings)
  assert.deepEqual(words, expectedWords(speech))
  for (const [a, b] of windows) assert.ok((b - a) / rate <= 31.5)
})

test('adjacent utterances with tiny gaps are decoded without overlap or loss', () => {
  // Gaps of 0.074 s, 0.3 s and 0.6 s, the shortest seen in the AMI meeting,
  // with a VAD that really ends utterances at gaps that short.
  const settings: VadSettings = { ...LIVE_VAD, minSilenceSec: 0.05 }
  const speech: Array<[number, number]> = [
    [seconds(1), seconds(4)],
    [seconds(4.074), seconds(6)],
    [seconds(6.3), seconds(9)],
    [seconds(9.6), seconds(12)]
  ]
  const { words, windows } = run(speech, seconds(15), settings)
  assert.ok(windows.length >= 4, 'each utterance decoded separately')
  assert.deepEqual(words, expectedWords(speech))
  const sorted = [...windows].sort((a, b) => a[0] - b[0])
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i]![0] >= sorted[i - 1]![1], 'padding must not decode audio twice')
  }
})

test('a first word the model times inside the start padding is kept', () => {
  const events: Array<Record<string, unknown>> = []
  const speech: Array<[number, number]> = [[seconds(1), seconds(3)]]
  const transcriber = new UtteranceTranscriber(
    {
      createStream: () => {
        const stream = { acceptWaveform: () => {} }
        return stream
      },
      decode: () => {},
      // TDT often places the first token a little before the VAD's start.
      getResult: () => ({ text: 'Early', tokens: [' Early'], timestamps: [0.05], durations: [0.2] })
    },
    new FakeVad(speech),
    { channel: 'mic', interim: false, emit: (event) => events.push(event) }
  )
  feed(transcriber, seconds(5))
  transcriber.finish()
  assert.deepEqual(events.at(-1), { event: 'final', channel: 'mic', text: 'Early' })
})

test('captions keep growing through a long utterance instead of freezing', () => {
  const events: Array<Record<string, unknown>> = []
  const speech: Array<[number, number]> = [[seconds(0.5), seconds(60)]]
  const transcriber = new UtteranceTranscriber(
    gridRecognizer(speech, []) as never,
    new FakeVad(speech),
    { channel: 'system', interim: true, emit: (event) => events.push(event) }
  )
  feed(transcriber, seconds(40))
  const partialTimes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event === 'partial' && event.text)
  assert.ok(transcriber.stats.interimDecodes >= 8, `${transcriber.stats.interimDecodes} interims`)
  // Committed text arrives at each forced cut, well before the utterance ends.
  assert.ok(events.filter((event) => event.event === 'timings').length >= 2)
  assert.ok(partialTimes.length > 0)
})

test('interim decodes stop when the shared load guard is saturated', () => {
  const clock = 0
  const load = new DecodeLoadMonitor(10_000, 0.5, () => clock)
  const speech: Array<[number, number]> = [[seconds(0.5), seconds(20)]]
  const transcriber = new UtteranceTranscriber(
    gridRecognizer(speech, []) as never,
    new FakeVad(speech),
    {
      channel: 'system',
      interim: true,
      emit: () => {},
      load,
      now: () => clock
    }
  )
  feed(transcriber, seconds(4))
  const interims = transcriber.stats.interimDecodes
  assert.ok(interims >= 2)
  load.record(9_000)
  feed(transcriber, seconds(4))
  assert.equal(transcriber.stats.interimDecodes, interims)
  assert.ok(transcriber.stats.skippedInterims > 0)
})

test('live lag is the queueing delay of the latest frame, and anchors the channel start', () => {
  let clock = 50_000
  const events: Array<Record<string, unknown>> = []
  const transcriber = new UtteranceTranscriber(gridRecognizer([], []) as never, new FakeVad([]), {
    channel: 'mic',
    interim: true,
    realtime: true,
    emit: (event) => events.push(event),
    now: () => clock
  })
  const before = Date.now()
  transcriber.ingest(new Float32Array(4096), clock - 3000)
  assert.ok(Math.abs(transcriber.lagSec() - 3) < 1e-9)
  // The channel starts when its first frame was sent, not when it was processed.
  const epochMs = events[0]!.epochMs as number
  assert.ok(epochMs <= before - 2900 && epochMs >= before - 3100, `${before - epochMs} ms`)
  clock += 30_000
  transcriber.ingest(new Float32Array(4096), clock - 10)
  assert.ok(transcriber.lagSec() < 0.05)
})

test('settled time trails only the utterance still being spoken', () => {
  const speech: Array<[number, number]> = [[seconds(1), seconds(3)]]
  const transcriber = new UtteranceTranscriber(
    gridRecognizer(speech, []) as never,
    new FakeVad(speech),
    {
      channel: 'system',
      interim: false,
      emit: () => {}
    }
  )
  feed(transcriber, seconds(2))
  assert.ok(transcriber.settledThroughSec() <= 1)
  feed(transcriber, seconds(3))
  assert.ok(transcriber.settledThroughSec() > 3)
})

test('slow machines get utterance captions; the calibration signal is deterministic', () => {
  assert.equal(liveCaptionMode(0.1), 'interim')
  assert.equal(liveCaptionMode(0.6), 'utterance')
  assert.equal(liveCaptionMode(Number.NaN), 'utterance')
  assert.deepEqual(calibrationSignal(0.01), calibrationSignal(0.01))
  assert.equal(calibrationSignal().length, 4 * rate)
})

// Optional: the real Silero VAD on real long speech (set both paths to run).
const sileroModel = process.env.DOODLE_TEST_SILERO_VAD
const longSpeech = process.env.DOODLE_TEST_LONG_SPEECH_WAV
test(
  'real Silero VAD on a long meeting channel: every speech sample reaches a bounded decode',
  { skip: !(sileroModel && longSpeech && existsSync(sileroModel) && existsSync(longSpeech)) },
  async () => {
    const { loadSherpa, sileroVadConfig, vadBufferSeconds } =
      await import('./windows-asr-recognizers')
    const sherpa = loadSherpa()
    const wav = readFileSync(longSpeech!)
    const dataAt = wav.indexOf('data') + 8
    const samples = new Float32Array((wav.length - dataAt) / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(dataAt + i * 2) / 32768
    // A reference VAD pass records where Silero hears speech.
    const reference = new sherpa.Vad(sileroVadConfig(sileroModel!, LIVE_VAD), 60)
    const speech: Array<[number, number]> = []
    let open = -1
    for (let i = 0; i + 512 <= samples.length; i += 512) {
      reference.acceptWaveform(samples.slice(i, i + 512))
      if (reference.isDetected() && open < 0) open = i
      if (!reference.isDetected() && open >= 0) {
        speech.push([open, i])
        open = -1
      }
      reference.clear()
    }
    if (open >= 0) speech.push([open, samples.length])
    const windows: Array<[number, number]> = []
    const transcriber = new UtteranceTranscriber(
      {
        createStream: () => {
          const stream = {
            n: 0,
            start: 0,
            acceptWaveform: (o: { samples: Float32Array }) => (stream.n = o.samples.length)
          }
          return stream
        },
        decode: (stream: { n: number }) => windows.push([0, stream.n]),
        getResult: () => ({ text: '', tokens: [], timestamps: [] })
      } as never,
      new sherpa.Vad(sileroVadConfig(sileroModel!, LIVE_VAD), vadBufferSeconds(LIVE_VAD)),
      { channel: 'mic', interim: false, emit: () => {} }
    )
    for (let i = 0; i < samples.length; i += 4096) transcriber.ingest(samples.slice(i, i + 4096))
    transcriber.finish()
    const longest = Math.max(...speech.map(([a, b]) => b - a)) / rate
    const decoded = windows.reduce((sum, [, n]) => sum + n, 0) / rate
    const spoken = speech.reduce((sum, [a, b]) => sum + b - a, 0) / rate
    console.log(
      JSON.stringify({
        longestSpeechSec: longest,
        spokenSec: spoken,
        decodedSec: decoded,
        decodes: windows.length,
        forcedCuts: transcriber.stats.forcedCuts,
        longestDecodeSec: transcriber.stats.longestDecodeSec
      })
    )
    assert.ok(transcriber.stats.longestDecodeSec <= LIVE_VAD.maxSpeechSec + 1.5)
    // Decoded audio covers all detected speech (plus context).
    assert.ok(decoded >= spoken, `${decoded}s decoded for ${spoken}s of speech`)
  }
)
