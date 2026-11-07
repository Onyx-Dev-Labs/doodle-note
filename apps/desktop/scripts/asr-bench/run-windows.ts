/**
 * Windows ASR benchmark: runs one recognizer configuration over the prepared
 * fixtures with the app's own sherpa-onnx addon and pipeline code, natively.
 *
 *   pnpm exec tsx scripts/asr-bench/run-windows.ts --config <name> --models <dir>
 *       --fixtures <cache>/prepared [--sets read,meeting] [--threads 2]
 *       [--channels 1|2] [--realtime] [--limit N] [--out results.jsonl]
 *
 * One configuration per process, so peak memory is attributable. Each row is
 * one fixture; a final {"summary":...} row aggregates per set. Scoring and
 * normalization come from scoring.cjs, shared with the Mac runner.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  ASR_SAMPLE_RATE,
  BATCH_VAD,
  DecodeLoadMonitor,
  LIVE_VAD,
  UtteranceTranscriber,
  type OfflineRecognizerLike,
  type OfflineStreamLike,
  type TdtResult,
  type VadSettings
} from '../../src/main/windows-asr-pipeline'
import {
  loadSherpa,
  parakeetRecognizerConfig,
  sileroVadConfig,
  vadBufferSeconds
} from '../../src/main/windows-asr-recognizers'
import { SegmentAssembler } from '../../src/main/segmenter'
import { calibrationSignal } from '../../src/main/windows-asr-guard'

const localRequire = createRequire(__filename)
const scoring = localRequire('./scoring.cjs') as {
  NORMALIZATION: string
  score: (ref: string, hyp: string) => Record<string, number | boolean>
  aggregate: (s: Array<{ refWords: number; errors: number }>) => Record<string, number>
}

interface Fixture {
  id: string
  set: string
  reference: string
  seconds: number
  sha256: string
  pairWith?: string
  wordTimings?: string
}

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

const config = arg('config')!
const modelsDir = arg('models')!
const fixturesDir = arg('fixtures')!
const sets = (arg('sets', 'read,meeting') ?? '').split(',')
const threads = Number(arg('threads', '2'))
const channels = Number(arg('channels', '1'))
const realtime = flag('realtime')
const limit = Number(arg('limit', '100000'))
const out = arg('out')
const only = arg('only')
const vadOverride = arg('vad') // e.g. "minSilence=0.5,maxSpeech=15"
const providerConfig = arg('provider-config') // sherpa "cpu:<file>" session options

function write(row: Record<string, unknown>): void {
  const line = JSON.stringify(row)
  console.log(line)
  if (out) appendFileSync(out, line + '\n')
}

function readWav(path: string): Float32Array {
  const buffer = readFileSync(path)
  let offset = 12
  while (offset < buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') {
      const samples = new Float32Array(size / 2)
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buffer.readInt16LE(offset + 8 + i * 2) / 32768
      }
      return samples
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${path}`)
}

const sherpa = loadSherpa() as unknown as {
  OfflineRecognizer: new (c: unknown) => OfflineRecognizerLike<OfflineStreamLike>
  OnlineRecognizer: new (c: unknown) => OnlineRecognizer
  Vad: new (c: unknown, s: number) => import('../../src/main/windows-asr-pipeline').VadLike
}
interface OnlineStream {
  acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}
interface OnlineRecognizer {
  createStream(): OnlineStream
  isReady(s: OnlineStream): boolean
  decode(s: OnlineStream): void
  getResult(s: OnlineStream): { text: string; tokens?: string[]; timestamps?: number[] }
}

/* ---- recognizer factories ---- */

const M = (name: string): string => join(modelsDir, name)
const ZIPFORMER = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const TINY = 'sherpa-onnx-whisper-tiny.en'

function zipformer(): OnlineRecognizer {
  const dir = M(ZIPFORMER)
  // Identical to the shipped live configuration before this change.
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
        decoder: join(dir, 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx'),
        joiner: join(dir, 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      modelType: 'zipformer2'
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: 0
  })
}

function unifiedStreaming(variant: string): OnlineRecognizer {
  const dir = M(`sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-${variant}`)
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0
    },
    decodingMethod: 'greedy_search'
  })
}

function tinyEn(): OfflineRecognizerLike<OfflineStreamLike> {
  const dir = M(TINY)
  // Identical to the shipped final-pass configuration before this change.
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: join(dir, 'tiny.en-encoder.int8.onnx'),
        decoder: join(dir, 'tiny.en-decoder.int8.onnx'),
        language: 'en',
        task: 'transcribe',
        tailPaddings: -1
      },
      tokens: join(dir, 'tiny.en-tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0
    }
  })
}

function ctc110m(): OfflineRecognizerLike<OfflineStreamLike> {
  const dir = M('sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8')
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      nemoCtc: { model: join(dir, 'model.int8.onnx') },
      tokens: join(dir, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0
    }
  })
}

const OFFLINE_DIRS: Record<string, string> = {
  'tdt-v2': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  'tdt-v3': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  'unified-offline': 'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming'
}

function offline(model: string): OfflineRecognizerLike<OfflineStreamLike> {
  if (model === 'tiny-en') return tinyEn()
  if (model === 'ctc-110m') return ctc110m()
  const config = parakeetRecognizerConfig(M(OFFLINE_DIRS[model]!), threads) as {
    modelConfig: { provider: string }
  }
  if (providerConfig) config.modelConfig.provider = `cpu:${providerConfig}`
  return new sherpa.OfflineRecognizer(config)
}

function vadSettings(base: VadSettings): VadSettings {
  if (!vadOverride) return base
  const next = { ...base }
  for (const pair of vadOverride.split(',')) {
    const [key, value] = pair.split('=')
    if (key === 'minSilence') next.minSilenceSec = Number(value)
    if (key === 'maxSpeech') next.maxSpeechSec = Number(value)
    if (key === 'threshold') next.threshold = Number(value)
  }
  return next
}

/* ---- runners: each returns hypothesis text plus timing metrics ---- */

interface RunResult {
  text: string
  processingMs: number
  firstTextAudioSec: number | null
  finalizeMs: number
  commitLagSec?: number[]
  extra?: Record<string, unknown>
  tokens?: Array<{ token: string; startSec: number; endSec: number; confidence: number }>
}

const CHUNK = 4096 // the renderer's capture frame size

function runOnline(make: () => OnlineRecognizer, tracks: Float32Array[]): RunResult[] {
  const recognizer = (runOnline as unknown as { r?: OnlineRecognizer }).r ?? make()
  ;(runOnline as unknown as { r?: OnlineRecognizer }).r = recognizer
  const streams = tracks.map(() => recognizer.createStream())
  const first: Array<number | null> = tracks.map(() => null)
  let processing = 0
  const length = Math.max(...tracks.map((t) => t.length))
  for (let offset = 0; offset < length; offset += CHUNK) {
    tracks.forEach((track, index) => {
      if (offset >= track.length) return
      const began = performance.now()
      const stream = streams[index]!
      stream.acceptWaveform({ samples: track.subarray(offset, offset + CHUNK), sampleRate: 16000 })
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      // The shipped publish() re-read the whole result after every frame.
      const result = recognizer.getResult(stream)
      processing += performance.now() - began
      if (first[index] === null && result.text.trim()) {
        first[index] = Math.min(track.length, offset + CHUNK) / ASR_SAMPLE_RATE
      }
    })
  }
  return tracks.map((_, index) => {
    const began = performance.now()
    const stream = streams[index]!
    stream.acceptWaveform({ samples: new Float32Array(8000), sampleRate: 16000 })
    stream.inputFinished()
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    const result = recognizer.getResult(stream)
    const finalizeMs = performance.now() - began
    processing += finalizeMs
    return {
      text: result.text.replace(/▁/g, ' ').trim(),
      processingMs: processing / tracks.length,
      firstTextAudioSec: first[index]!,
      finalizeMs
    }
  })
}

function runWhole(recognizer: OfflineRecognizerLike<OfflineStreamLike>, track: Float32Array, windowSec: number): RunResult {
  const began = performance.now()
  const texts: string[] = []
  const step = Math.round(windowSec * ASR_SAMPLE_RATE)
  for (let offset = 0; offset < track.length; offset += step) {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples: track.subarray(offset, offset + step), sampleRate: 16000 })
    recognizer.decode(stream)
    const text = (recognizer.getResult(stream) as TdtResult).text.trim()
    if (text) texts.push(text)
  }
  const ms = performance.now() - began
  return { text: texts.join(' '), processingMs: ms, firstTextAudioSec: null, finalizeMs: ms }
}

async function runPipeline(
  recognizer: OfflineRecognizerLike<OfflineStreamLike>,
  tracks: Float32Array[],
  live: boolean,
  vadModel: string
): Promise<RunResult[]> {
  const settings = vadSettings(live ? LIVE_VAD : BATCH_VAD)
  const load = new DecodeLoadMonitor()
  const states = tracks.map((_, index) => {
    const state = {
      fed: 0,
      first: null as number | null,
      lags: [] as number[],
      tokens: [] as RunResult['tokens'] & object,
      text: '',
      finalizeMs: 0,
      partials: 0,
      lagSamples: [] as number[]
    }
    const pipeline = new UtteranceTranscriber(
      recognizer,
      new sherpa.Vad(sileroVadConfig(vadModel, settings), vadBufferSeconds(settings)),
      {
        channel: index === 0 ? 'system' : 'mic',
        interim: live && !flag('no-interim'),
        vadSettings: settings,
        load,
        realtime,
        emit: (event) => {
          const audioSec = state.fed / ASR_SAMPLE_RATE
          if (event.event === 'partial' && typeof event.text === 'string' && event.text) {
            state.partials++
            state.first ??= audioSec
          }
          if (event.event === 'timings' && Array.isArray(event.tokens)) {
            state.first ??= audioSec
            for (const token of event.tokens as NonNullable<RunResult['tokens']>) {
              state.lags.push(audioSec - token.endSec)
              state.tokens.push(token)
            }
          }
          if (event.event === 'final') state.text = String(event.text ?? '')
        }
      }
    )
    return { state, pipeline }
  })
  let processing = 0
  const length = Math.max(...tracks.map((t) => t.length))
  const startedAt = performance.now()
  const cpuAtStart = process.cpuUsage()
  const memory: Array<{ atSec: number; rssMb: number; lagSec: number }> = []
  let nextMemoryAt = 0
  for (let offset = 0; offset < length; offset += CHUNK) {
    // A frame "arrives" when its last sample has been captured.
    const due = startedAt + ((offset + CHUNK) / ASR_SAMPLE_RATE) * 1000
    if (realtime) {
      // Pace input like capture: never earlier than its wall-clock time.
      const wait = due - performance.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    }
    for (const [index, track] of tracks.entries()) {
      if (offset >= track.length) continue
      const { state, pipeline } = states[index]!
      const chunk = track.subarray(offset, offset + CHUNK)
      state.fed += chunk.length
      const began = performance.now()
      pipeline.ingest(chunk, realtime ? due : undefined)
      processing += performance.now() - began
    }
    const atSec = offset / ASR_SAMPLE_RATE
    if (realtime && atSec >= nextMemoryAt) {
      nextMemoryAt += 30
      memory.push({
        atSec: Math.round(atSec),
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        lagSec: Math.round(Math.max(...states.map((s) => s.pipeline.lagSec())) * 100) / 100
      })
    }
  }
  return states.map(({ state, pipeline }) => {
    const began = performance.now()
    pipeline.finish()
    state.finalizeMs = performance.now() - began
    processing += state.finalizeMs
    return {
      text: state.text,
      processingMs: processing / tracks.length,
      firstTextAudioSec: state.first,
      finalizeMs: state.finalizeMs,
      commitLagSec: state.lags,
      tokens: state.tokens,
      extra: {
        ...pipeline.stats,
        partials: state.partials,
        ...(realtime
          ? {
              memory,
              wallSec: (performance.now() - startedAt) / 1000,
              // Average logical CPUs busy over the session (16 on Dev04).
              averageCpus:
                (process.cpuUsage(cpuAtStart).user + process.cpuUsage(cpuAtStart).system) /
                1e6 /
                ((performance.now() - startedAt) / 1000),
              maxLagSec: Math.max(...memory.map((m) => m.lagSec))
            }
          : {})
      }
    }
  })
}

/** Long files through an offline model without the app pipeline (whisper baseline). */
function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

/** Median offset between hypothesis word starts and matched reference words. */
function drift(
  tokens: NonNullable<RunResult['tokens']>,
  referencePath: string
): Array<{ minute: number; medianOffsetSec: number; matches: number }> {
  const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as Array<{ w: string; s: number }>
  const words: Array<{ w: string; s: number }> = []
  for (const token of tokens) {
    if (token.token.startsWith(' ') || words.length === 0) words.push({ w: token.token, s: token.startSec })
    else words[words.length - 1]!.w += token.token
  }
  const norm = (w: string): string => w.toLowerCase().replace(/[^a-z']/g, '')
  const byMinute = new Map<number, number[]>()
  let r = 0
  for (const word of words) {
    const w = norm(word.w)
    if (w.length < 4) continue
    // Nearest unmatched reference word with the same text within ±5 s.
    while (r < reference.length && reference[r]!.s < word.s - 5) r++
    for (let k = r; k < reference.length && reference[k]!.s <= word.s + 5; k++) {
      if (norm(reference[k]!.w) === w) {
        const minute = Math.floor(word.s / 300) * 5
        byMinute.set(minute, [...(byMinute.get(minute) ?? []), word.s - reference[k]!.s])
        break
      }
    }
  }
  return [...byMinute].map(([minute, offsets]) => ({
    minute,
    medianOffsetSec: Math.round((quantile(offsets, 0.5) ?? 0) * 1000) / 1000,
    matches: offsets.length
  }))
}

async function main(): Promise<void> {
  const index = JSON.parse(readFileSync(join(fixturesDir, 'index.json'), 'utf8')) as {
    fixtures: Fixture[]
  }
  const fixtures = index.fixtures
    .filter((f) => sets.includes(f.set) && (!only || f.id === only))
    .slice(0, limit)
  const vadModel = join(modelsDir, 'silero-vad', 'silero_vad.onnx')
  const [family, variant] = config.split(':')
  const loadBegan = performance.now()
  let offlineRecognizer: OfflineRecognizerLike<OfflineStreamLike> | null = null
  let onlineFactory: (() => OnlineRecognizer) | null = null
  if (family === 'zipformer') onlineFactory = zipformer
  else if (family === 'unified-stream') onlineFactory = () => unifiedStreaming(variant!)
  else offlineRecognizer = offline(variant!)
  if (onlineFactory) (runOnline as unknown as { r?: OnlineRecognizer }).r = onlineFactory()
  const loadMs = performance.now() - loadBegan
  const rows: Array<Record<string, unknown> & { set: string; refWords: number; errors: number }> = []
  for (const fixture of fixtures) {
    const wav = join(fixturesDir, `${fixture.id}.wav`)
    const track = readWav(wav)
    let tracks = [track]
    if (channels === 2) {
      const partner = fixture.pairWith ?? index.fixtures.find((f) => f.pairWith === fixture.id)?.id
      tracks = [track, partner ? readWav(join(fixturesDir, `${partner}.wav`)) : track]
    }
    let results: RunResult[]
    if (onlineFactory) results = runOnline(onlineFactory, tracks)
    else if (family === 'whole') {
      results = tracks.map((t) => runWhole(offlineRecognizer!, t, variant === 'tiny-en' ? 25 : 1e9))
    } else if (family === 'pipeline-live' || family === 'pipeline-batch') {
      results = await runPipeline(offlineRecognizer!, tracks, family === 'pipeline-live', vadModel)
    } else throw new Error(`unknown config family ${family}`)
    const result = results[0]!
    const scored = scoring.score(fixture.reference, result.text) as Record<string, number | boolean>
    const lags = result.commitLagSec ?? []
    // The path users see: tokens -> app segmenter -> segment texts in time order.
    let segmentScore: Record<string, number | boolean> | null = null
    if (result.tokens && result.tokens.length > 0) {
      const assembler = new SegmentAssembler()
      const segments = [
        ...assembler.addTimings('system', result.tokens),
        ...assembler.flush('system')
      ].sort((a, b) => a.startMs - b.startMs)
      segmentScore = scoring.score(fixture.reference, segments.map((s) => s.text).join(' '))
    }
    const row = {
      config,
      threads,
      channels,
      realtime,
      fixture: fixture.id,
      set: fixture.set,
      seconds: Math.round(fixture.seconds * 1000) / 1000,
      ...scored,
      refWords: scored.refWords as number,
      errors: scored.errors as number,
      rtf: result.processingMs / 1000 / fixture.seconds,
      processingMs: Math.round(result.processingMs),
      firstTextAudioSec: result.firstTextAudioSec,
      finalizeMs: Math.round(result.finalizeMs),
      commitLagMeanSec: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null,
      commitLagP90Sec: quantile(lags, 0.9),
      commitLagMedianSec: quantile(lags, 0.5),
      segmentErrors: segmentScore ? (segmentScore.errors as number) : null,
      segmentWer: segmentScore ? (segmentScore.wer as number) : null,
      ...(result.extra ?? {}),
      ...(fixture.wordTimings && result.tokens
        ? { drift: drift(result.tokens, join(fixturesDir, `${fixture.id}.words.json`)) }
        : {}),
      ...(results[1]
        ? {
            secondChannel: {
              ...(scoring.score(
                index.fixtures.find(
                  (f) => f.id === (fixture.pairWith ?? index.fixtures.find((p) => p.pairWith === fixture.id)?.id)
                )?.reference ?? fixture.reference,
                results[1].text
              ) as object),
              ...(results[1].extra ?? {})
            }
          }
        : {}),
      hypothesis: fixture.set.startsWith('long') && !flag('full-text') ? result.text.slice(0, 400) : result.text
    }
    rows.push(row)
    write(row)
  }
  const summary: Record<string, unknown> = {}
  for (const set of new Set(rows.map((r) => r.set))) {
    const subset = rows.filter((r) => r.set === set)
    const audio = subset.reduce((sum, r) => sum + (r.seconds as number), 0)
    const processing = subset.reduce((sum, r) => sum + (r.processingMs as number), 0)
    const firsts = subset.map((r) => r.firstTextAudioSec).filter((v): v is number => typeof v === 'number')
    summary[set] = {
      ...scoring.aggregate(subset),
      audioSec: Math.round(audio * 10) / 10,
      rtf: Math.round((processing / 1000 / audio) * 1000) / 1000,
      firstTextAudioSecMedian: quantile(firsts, 0.5),
      finalizeMsMedian: quantile(subset.map((r) => r.finalizeMs as number), 0.5),
      finalizeMsMax: Math.max(...subset.map((r) => r.finalizeMs as number)),
      segmentWer: subset.every((r) => typeof r.segmentErrors === 'number')
        ? subset.reduce((sum, r) => sum + (r.segmentErrors as number), 0) /
          subset.reduce((sum, r) => sum + r.refWords, 0)
        : null,
      commitLagMeanSec:
        subset.some((r) => typeof r.commitLagMeanSec === 'number')
          ? subset.reduce((sum, r) => sum + ((r.commitLagMeanSec as number) ?? 0), 0) / subset.length
          : null,
      commitLagP90SecMax: Math.max(...subset.map((r) => (r.commitLagP90Sec as number) ?? 0)),
      cased: subset.filter((r) => r.hasCase).length,
      punctuated: subset.filter((r) => r.hasPunctuation).length
    }
  }
  // The app's startup calibration, measured after the run so it cannot skew it.
  let calibrationRtf: number | null = null
  if (offlineRecognizer) {
    const signal = calibrationSignal()
    const began = performance.now()
    const stream = offlineRecognizer.createStream()
    stream.acceptWaveform({ samples: signal, sampleRate: ASR_SAMPLE_RATE })
    offlineRecognizer.decode(stream)
    offlineRecognizer.getResult(stream)
    calibrationRtf = Math.round(((performance.now() - began) / 1000 / 4) * 1000) / 1000
  }
  write({
    summary,
    calibrationRtf,
    config,
    threads,
    channels,
    realtime,
    normalization: scoring.NORMALIZATION,
    loadMs: Math.round(loadMs),
    peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    node: process.version,
    sherpa: (localRequire(join(__dirname, '../../node_modules/sherpa-onnx-node/package.json')) as { version: string }).version
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
