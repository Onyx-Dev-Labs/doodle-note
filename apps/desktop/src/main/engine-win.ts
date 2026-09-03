/**
 * Windows transcription engine — the counterpart of the Swift sidecar,
 * running as an Electron utilityProcess (plain Node). Streaming on-device
 * ASR via sherpa-onnx (zipformer transducer, CPU int8); audio arrives as
 * 16kHz mono Float32 frames from the renderer's capture (WASAPI loopback +
 * mic via Chromium), and events go back to the host shaped exactly like the
 * Swift engine's NDJSON — channel_start / partial / timings / final / done —
 * so the segmenter, renderer, and sync pipeline need zero changes.
 *
 * Protocol (parentPort messages):
 *   in:  {t:'init', modelsDir}            — download/load models once
 *        {t:'start', channels:[...]}      — begin a session
 *        {t:'audio', channel, samples}    — 16k mono Float32Array frame
 *        {t:'stop'}                       — finish session (emit finals+done)
 *   out: {t:'event', event:{...}}         — engine event object
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { join } from 'node:path'
import {
  WINDOWS_ASR_SAMPLE_RATE,
  boundedTokenWindow,
  finishOnlineStream
} from './engine-win-finalize'

const MODEL_NAME = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`
const PARTIAL_THROTTLE_MS = 400
/** endSec for the trailing token when the next one hasn't arrived yet. */
const TOKEN_TAIL_SEC = 0.25

interface AudioMessage {
  t: 'audio'
  sessionId?: number
  channel: string
  samples: Float32Array
  /** Batch imports use an acknowledgement for IPC backpressure. */
  sequence?: number
}

type InMessage =
  | { t: 'init'; modelsDir: string }
  | { t: 'start'; channels: string[]; sessionId?: number }
  | AudioMessage
  | { t: 'stop'; sessionId?: number }

const port = process.parentPort

function emit(event: Record<string, unknown>): void {
  port.postMessage({ t: 'event', event })
}

/* ---- model management ---- */

async function ensureModel(modelsDir: string): Promise<string> {
  const dir = join(modelsDir, MODEL_NAME)
  if (existsSync(join(dir, 'tokens.txt'))) return dir
  mkdirSync(modelsDir, { recursive: true })
  const archive = join(modelsDir, `${MODEL_NAME}.tar.bz2`)

  emit({ event: 'status', stage: 'downloading_model', model: MODEL_NAME })
  await download(MODEL_URL, archive, (pct) => emit({ event: 'download', progress: pct / 100 }))

  emit({ event: 'status', stage: 'extracting_model' })
  // Windows 10+ ships bsdtar as tar.exe; -xjf handles .tar.bz2.
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xjf', archive, '-C', modelsDir])
    tar.on('error', reject)
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))
    )
  })
  rmSync(archive, { force: true })
  if (!existsSync(join(dir, 'tokens.txt'))) {
    throw new Error('Model archive extracted but tokens.txt is missing')
  }
  return dir
}

function download(url: string, dest: string, onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (target: string, redirects: number): void => {
      if (redirects > 5) return reject(new Error('Too many redirects'))
      httpsGet(target, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()
          return follow(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`Model download failed: HTTP ${res.statusCode}`))
        }
        const total = Number(res.headers['content-length'] ?? 0)
        let seen = 0
        let lastPct = -1
        const file = createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          seen += chunk.length
          if (total > 0) {
            const pct = Math.floor((seen / total) * 100)
            if (pct !== lastPct) {
              lastPct = pct
              onPct(pct)
            }
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url, 0)
  })
}

/* ---- per-channel streaming pipeline ---- */

interface SherpaModule {
  OnlineRecognizer: new (config: unknown) => SherpaRecognizer
}
interface SherpaStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}
interface SherpaRecognizer {
  createStream(): SherpaStream
  isReady(stream: SherpaStream): boolean
  decode(stream: SherpaStream): void
  getResult(stream: SherpaStream): { text: string; tokens?: string[]; timestamps?: number[] }
}

class ChannelPipeline {
  private stream: SherpaStream
  private emittedTokens = 0
  private lastPartialAt = 0
  private lastPartialText = ''
  private started = false
  private realSamples = 0
  private readonly startedAtMs = Date.now()

  constructor(
    readonly channel: string,
    private readonly recognizer: SherpaRecognizer
  ) {
    this.stream = recognizer.createStream()
  }

  ingest(samples: Float32Array): void {
    this.realSamples += samples.length
    if (!this.started) {
      this.started = true
      emit({ event: 'channel_start', channel: this.channel, epochMs: Date.now() })
    }
    this.stream.acceptWaveform({ samples, sampleRate: WINDOWS_ASR_SAMPLE_RATE })
    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }
    this.publish(false)
  }

  finish(): void {
    try {
      finishOnlineStream(this.stream, this.recognizer)
      this.publish(true)
      const result = this.recognizer.getResult(this.stream)
      emit({
        event: 'final',
        channel: this.channel,
        text: joinedText(result),
        sessionSeconds: (Date.now() - this.startedAtMs) / 1000
      })
    } catch (err) {
      emit({ event: 'error', channel: this.channel, message: `finish failed: ${String(err)}` })
    }
  }

  /** Emit newly-decoded token timings + a throttled partial. */
  private publish(force: boolean): void {
    const result = this.recognizer.getResult(this.stream)
    const tokens = result.tokens ?? []
    const timestamps = result.timestamps ?? []
    if (tokens.length > this.emittedTokens) {
      const fresh: Array<Record<string, unknown>> = []
      const realAudioSeconds = this.realSamples / WINDOWS_ASR_SAMPLE_RATE
      for (let i = this.emittedTokens; i < tokens.length; i++) {
        const start = timestamps[i] ?? 0
        const end = timestamps[i + 1] ?? start + TOKEN_TAIL_SEC
        const bounded = boundedTokenWindow(start, Math.max(end, start), realAudioSeconds)
        if (!bounded) continue
        fresh.push({
          // sherpa marks word starts with ▁ — the segmenter's contract is a
          // leading space (same as the Parakeet engine).
          token: tokens[i]!.replace(/▁/g, ' '),
          startSec: Math.round(bounded.startSec * 1000) / 1000,
          endSec: Math.round(bounded.endSec * 1000) / 1000,
          confidence: 0.9
        })
      }
      this.emittedTokens = tokens.length
      if (fresh.length > 0) emit({ event: 'timings', channel: this.channel, tokens: fresh })
    }
    const now = Date.now()
    const text = joinedText(result)
    if (
      (force || now - this.lastPartialAt > PARTIAL_THROTTLE_MS) &&
      text !== this.lastPartialText
    ) {
      this.lastPartialAt = now
      this.lastPartialText = text
      emit({ event: 'partial', channel: this.channel, text })
    }
  }
}

function joinedText(result: { text: string }): string {
  return result.text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim()
}

/* ---- session orchestration ---- */

let recognizer: SherpaRecognizer | null = null
let pipelines = new Map<string, ChannelPipeline>()
let sessionActive = false
let activeSessionId: number | null = null

async function init(modelsDir: string): Promise<void> {
  try {
    const dir = await ensureModel(modelsDir)
    emit({ event: 'status', stage: 'serve_loading_models' })
    // Deferred require: the native addon must not load before it's needed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sherpa = require('sherpa-onnx-node') as SherpaModule
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(dir, 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
          decoder: join(dir, 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx'),
          joiner: join(dir, 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx')
        },
        tokens: join(dir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        modelType: 'zipformer2'
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: 0
    })
    emit({ event: 'status', stage: 'serve_ready' })
  } catch (err) {
    emit({ event: 'error', message: `engine init failed: ${String(err)}` })
  }
}

function startSession(channels: string[], sessionId = 0): void {
  if (!recognizer) {
    emit({ event: 'error', message: 'engine is not ready yet' })
    emit({ event: 'done' })
    return
  }
  if (sessionActive) {
    emit({ event: 'error', message: 'a session is already active' })
    return
  }
  sessionActive = true
  activeSessionId = sessionId
  pipelines = new Map(
    channels.map((channel) => [channel, new ChannelPipeline(channel, recognizer!)])
  )
  emit({ event: 'ready', mode: 'live', channels })
  emit({ event: 'status', stage: 'transcribing' })
}

function stopSession(sessionId = 0): void {
  if (!sessionActive || activeSessionId !== sessionId) return
  sessionActive = false
  emit({ event: 'status', stage: 'finishing' })
  for (const pipeline of pipelines.values()) {
    pipeline.finish()
  }
  pipelines = new Map()
  activeSessionId = null
  emit({ event: 'done' })
}

port.on('message', (message: Electron.MessageEvent) => {
  const data = message.data as InMessage
  switch (data.t) {
    case 'init':
      void init(data.modelsDir)
      break
    case 'start':
      startSession(data.channels, data.sessionId)
      break
    case 'audio': {
      if (sessionActive && activeSessionId === (data.sessionId ?? 0)) {
        const pipeline = pipelines.get(data.channel)
        if (pipeline && data.samples instanceof Float32Array && data.samples.length > 0) {
          pipeline.ingest(data.samples)
        }
      }
      if (typeof data.sequence === 'number') {
        port.postMessage({ t: 'ack', sequence: data.sequence })
      }
      break
    }
    case 'stop':
      stopSession(data.sessionId)
      break
  }
})
