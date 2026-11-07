import { join } from 'node:path'
import type { EngineTokenTiming } from '../shared/engine-events'
import { modelFilesMatch } from './windows-asr-models'
import { ASR_SAMPLE_RATE } from './windows-asr-pipeline'

/**
 * Upgrade fallback: the streaming Zipformer earlier Windows builds downloaded.
 *
 * An existing user who updates while offline (or on a slow link) still has
 * this model cached. Until Parakeet Unified is installed, live captions use it
 * so recording works and every recording gets a transcript; the engine
 * downloads Parakeet in the background and switches between sessions. New
 * installs never download it, and the folder is never deleted.
 */
export const LEGACY_ZIPFORMER = {
  name: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
  files: {
    'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx': 70_108_816,
    'decoder-epoch-99-avg-1-chunk-16-left-128.onnx': 2_093_080,
    'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx': 259_416,
    'tokens.txt': 5_048
  }
} as const

export function legacyZipformerInstalled(modelsDir: string): boolean {
  return modelFilesMatch(join(modelsDir, LEGACY_ZIPFORMER.name), LEGACY_ZIPFORMER.files)
}

export interface LegacyStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}

export interface LegacyRecognizer {
  createStream(): LegacyStream
  isReady(stream: LegacyStream): boolean
  decode(stream: LegacyStream): void
  getResult(stream: LegacyStream): { text: string; tokens?: string[]; timestamps?: number[] }
}

/** The exact configuration earlier builds shipped. */
export function legacyRecognizerConfig(modelsDir: string): Record<string, unknown> {
  const dir = join(modelsDir, LEGACY_ZIPFORMER.name)
  return {
    featConfig: { sampleRate: ASR_SAMPLE_RATE, featureDim: 80 },
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
  }
}

const PARTIAL_THROTTLE_MS = 400
const TOKEN_TAIL_SEC = 0.25
const TAIL_SILENCE_SEC = 0.5

function joinedText(text: string): string {
  return text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim()
}

/** One channel on the legacy streaming model (the previous live pipeline). */
export class LegacyStreamingChannel {
  private readonly stream: LegacyStream
  private emittedTokens = 0
  private lastPartialAt = 0
  private lastPartialText = ''
  private started = false
  private samples = 0
  private queueLagSec = 0

  constructor(
    readonly channel: string,
    private readonly recognizer: LegacyRecognizer,
    private readonly emit: (event: Record<string, unknown>) => void,
    private readonly now: () => number = () => Date.now()
  ) {
    this.stream = recognizer.createStream()
  }

  lagSec(): number {
    return this.queueLagSec
  }

  /** Streaming: everything fed so far is decoded or still in the model's window. */
  settledThroughSec(): number {
    return Math.max(0, this.samples / ASR_SAMPLE_RATE - 1)
  }

  ingest(samples: Float32Array, queuedAt?: number): void {
    const lag = queuedAt !== undefined ? Math.max(0, this.now() - queuedAt) : 0
    this.queueLagSec = lag / 1000
    if (!this.started) {
      this.started = true
      this.emit({
        event: 'channel_start',
        channel: this.channel,
        epochMs: Math.round(Date.now() - lag)
      })
    }
    this.samples += samples.length
    this.stream.acceptWaveform({ samples, sampleRate: ASR_SAMPLE_RATE })
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    this.publish(false)
  }

  finish(): void {
    this.stream.acceptWaveform({
      samples: new Float32Array(Math.round(ASR_SAMPLE_RATE * TAIL_SILENCE_SEC)),
      sampleRate: ASR_SAMPLE_RATE
    })
    this.stream.inputFinished()
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream)
    this.publish(true)
    this.emit({
      event: 'final',
      channel: this.channel,
      text: joinedText(this.recognizer.getResult(this.stream).text)
    })
  }

  private publish(force: boolean): void {
    const result = this.recognizer.getResult(this.stream)
    const tokens = result.tokens ?? []
    const timestamps = result.timestamps ?? []
    const realSec = this.samples / ASR_SAMPLE_RATE
    if (tokens.length > this.emittedTokens) {
      const fresh: EngineTokenTiming[] = []
      for (let i = this.emittedTokens; i < tokens.length; i++) {
        const start = timestamps[i] ?? 0
        if (start > realSec) continue // tail padding is never real speech
        const end = Math.min(realSec, Math.max(start, timestamps[i + 1] ?? start + TOKEN_TAIL_SEC))
        fresh.push({
          token: tokens[i]!.replace(/▁/g, ' '),
          startSec: Math.round(start * 1000) / 1000,
          endSec: Math.round(end * 1000) / 1000,
          confidence: 0.9
        })
      }
      this.emittedTokens = tokens.length
      if (fresh.length > 0) this.emit({ event: 'timings', channel: this.channel, tokens: fresh })
    }
    const at = this.now()
    const text = joinedText(result.text)
    if ((force || at - this.lastPartialAt > PARTIAL_THROTTLE_MS) && text !== this.lastPartialText) {
      this.lastPartialAt = at
      this.lastPartialText = text
      this.emit({ event: 'partial', channel: this.channel, text })
    }
  }
}
