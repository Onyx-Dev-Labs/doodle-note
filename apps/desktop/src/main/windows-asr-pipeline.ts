import type { EngineTokenTiming } from '../shared/engine-events'
import { DEFAULT_SEGMENTER_CONFIG } from './segmenter'

/**
 * Windows speech pipeline shared by live captions and imports.
 *
 * Silero VAD cuts each channel into utterances; every utterance is decoded by
 * an offline Parakeet TDT recognizer, whose tokens carry real start times,
 * durations and log-probabilities. Decoding whole utterances keeps the full
 * model context while bounding cost: unlike the buffered streaming export of
 * Parakeet Unified, nothing is re-encoded per 80 ms step, so two channels fit
 * comfortably on ordinary laptop CPUs. Live captions additionally re-decode
 * the utterance in progress at a fixed interval, under a load guard, to show
 * a growing caption before the utterance ends.
 */

export const ASR_SAMPLE_RATE = 16_000
/** Silero VAD consumes fixed 512-sample (32 ms) windows at 16 kHz. */
export const VAD_WINDOW_SAMPLES = 512

export interface TdtResult {
  text: string
  tokens?: string[]
  timestamps?: number[]
  durations?: number[]
  ys_log_probs?: number[]
}

export interface OfflineStreamLike {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
}

export interface OfflineRecognizerLike<S extends OfflineStreamLike = OfflineStreamLike> {
  createStream(): S
  decode(stream: S): void
  getResult(stream: S): TdtResult
}

export interface SpeechSegmentLike {
  /** Absolute sample index of the segment's first sample. */
  start: number
  samples: Float32Array
}

export interface VadLike {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  isDetected(): boolean
  /** Pass false: Electron's V8 sandbox rejects external (addon-owned) buffers. */
  front(enableExternalBuffer?: boolean): SpeechSegmentLike
  pop(): void
  flush(): void
}

export interface VadSettings {
  threshold: number
  minSilenceSec: number
  minSpeechSec: number
  maxSpeechSec: number
}

/** Live: end utterances quickly so committed text follows speech closely. */
export const LIVE_VAD: VadSettings = {
  threshold: 0.5,
  minSilenceSec: 0.5,
  minSpeechSec: 0.25,
  maxSpeechSec: 15
}

/**
 * Imports and Re-transcribe: no caption latency to protect, so utterances end
 * only at a 1 s pause and may run to 30 s, giving the model more context
 * (Dev04 meeting clips: TDT v2 11.8% -> 10.5% WER versus the live settings).
 */
export const BATCH_VAD: VadSettings = {
  threshold: 0.5,
  minSilenceSec: 1,
  minSpeechSec: 0.25,
  maxSpeechSec: 30
}

export interface PipelineOptions {
  channel: string
  /** Re-decode the utterance in progress to show a growing caption. */
  interim: boolean
  /**
   * First interim decode after this much speech; later ones when the
   * utterance has grown by `interimGrowth` (and at least this much again).
   * Each interim re-decodes the whole utterance, so a geometric schedule keeps
   * their total cost proportional to the utterance instead of quadratic.
   */
  interimIntervalSec?: number
  interimGrowth?: number
  /** Utterances longer than this get no further interim decodes. */
  maxInterimSec?: number
  /** Context added on both sides of a VAD segment before decoding. */
  paddingSec?: number
  vadSettings?: VadSettings
  emit: (event: Record<string, unknown>) => void
  /** Shared across channels: keeps optional interim work within budget. */
  load?: DecodeLoadMonitor
  /**
   * Live capture: audio arrives in real time, so lag is meaningful. Lag is the
   * queueing delay of the latest frame when the caller passes its send time
   * to ingest(), else the gap between wall time and audio received.
   */
  realtime?: boolean
  /** Interim decodes stop while the channel lags real time by more than this. */
  maxInterimLagSec?: number
  now?: () => number
}

/**
 * Tracks recent decode time against wall time. Interim decodes are skipped
 * once decoding uses `maxShare` of the recent window, so committed text never
 * falls behind real time because of optional caption updates.
 */
export class DecodeLoadMonitor {
  private readonly samples: Array<{ at: number; ms: number }> = []

  constructor(
    private readonly windowMs = 10_000,
    private readonly maxShare = 0.5,
    private readonly now: () => number = () => performance.now()
  ) {}

  record(ms: number): void {
    const at = this.now()
    this.samples.push({ at, ms })
    this.trim(at)
  }

  share(): number {
    const at = this.now()
    this.trim(at)
    return this.samples.reduce((sum, sample) => sum + sample.ms, 0) / this.windowMs
  }

  allowsOptionalWork(): boolean {
    return this.share() < this.maxShare
  }

  private trim(at: number): void {
    while (this.samples.length > 0 && at - this.samples[0]!.at > this.windowMs) this.samples.shift()
  }
}

/**
 * Convert one decoded utterance into the engine's token timings. Times are
 * absolute seconds on the channel timeline; TDT durations give real token
 * ends, and log-probabilities become confidences.
 */
export function tokensFromResult(
  result: TdtResult,
  offsetSec: number,
  limitSec: number
): EngineTokenTiming[] {
  const tokens = result.tokens ?? []
  const starts = result.timestamps ?? []
  const durations = result.durations ?? []
  const logProbs = result.ys_log_probs ?? []
  const timings: EngineTokenTiming[] = []
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!.replace(/▁/g, ' ')
    if (raw.length === 0 || starts[i] === undefined) continue
    const startSec = Math.min(limitSec, offsetSec + starts[i]!)
    const nextStart = starts[i + 1] !== undefined ? offsetSec + starts[i + 1]! : undefined
    const duration = durations[i]
    let endSec =
      duration !== undefined && duration > 0 ? startSec + duration : (nextStart ?? startSec + 0.08)
    endSec = Math.max(startSec, Math.min(endSec, limitSec))
    const logProb = logProbs[i]
    const confidence =
      typeof logProb === 'number' && Number.isFinite(logProb)
        ? Math.min(1, Math.max(0, Math.exp(logProb)))
        : 0.9
    timings.push({
      // The first token of an utterance always starts a new word.
      token: timings.length === 0 && !raw.startsWith(' ') ? ` ${raw}` : raw,
      startSec: Math.round(startSec * 1000) / 1000,
      endSec: Math.round(endSec * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000
    })
  }
  return timings
}

function joinedText(result: TdtResult): string {
  return result.text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Ring buffer of the most recent channel audio, addressed by absolute sample index. */
class RecentAudio {
  private readonly buffer: Float32Array
  private total = 0

  constructor(seconds: number) {
    this.buffer = new Float32Array(Math.ceil(seconds * ASR_SAMPLE_RATE))
  }

  get length(): number {
    return this.total
  }

  push(samples: Float32Array): void {
    const capacity = this.buffer.length
    let source = samples
    if (source.length > capacity) {
      // Only the newest `capacity` samples can be retained.
      this.total += source.length - capacity
      source = source.subarray(source.length - capacity)
    }
    const at = this.total % capacity
    const first = Math.min(source.length, capacity - at)
    this.buffer.set(source.subarray(0, first), at)
    if (first < source.length) this.buffer.set(source.subarray(first), 0)
    this.total += source.length
  }

  /** Copy [from, to) clamped to what is still retained. */
  slice(from: number, to: number): { start: number; samples: Float32Array } {
    const capacity = this.buffer.length
    const start = Math.max(from, this.total - capacity, 0)
    const end = Math.min(to, this.total)
    const out = new Float32Array(Math.max(0, end - start))
    const at = start % capacity
    const first = Math.min(out.length, capacity - at)
    out.set(this.buffer.subarray(at, at + first))
    if (first < out.length) out.set(this.buffer.subarray(0, out.length - first), first)
    return { start, samples: out }
  }
}

interface OpenWord {
  startSec: number
  endSec: number
  text: string
}

export interface PipelineStats {
  audioSeconds: number
  decodeMs: number
  utterances: number
  interimDecodes: number
  skippedInterims: number
}

export class UtteranceTranscriber<S extends OfflineStreamLike = OfflineStreamLike> {
  private readonly audio: RecentAudio
  private readonly pending: Float32Array
  private pendingLength = 0
  private fed = 0
  private activeStart: number | null = null
  /** Utterance length (samples) at which the next interim decode runs. */
  private nextInterimLength = 0
  private lastSegmentEnd = 0
  private lastPartial = ''
  private openWords: OpenWord[] = []
  private readonly texts: string[] = []
  private started = false
  private firstAudioAt = 0
  private queueLagSec: number | null = null
  private readonly interimSamples: number
  private readonly maxInterimSamples: number
  private readonly paddingSamples: number
  private readonly minSpeechSamples: number
  private readonly minSilenceSamples: number
  private lastDetectedAt = 0
  readonly stats: PipelineStats = {
    audioSeconds: 0,
    decodeMs: 0,
    utterances: 0,
    interimDecodes: 0,
    skippedInterims: 0
  }

  constructor(
    private readonly recognizer: OfflineRecognizerLike<S>,
    private readonly vad: VadLike,
    private readonly options: PipelineOptions
  ) {
    const settings = options.vadSettings ?? LIVE_VAD
    this.interimSamples = Math.round((options.interimIntervalSec ?? 1) * ASR_SAMPLE_RATE)
    this.nextInterimLength = this.interimSamples
    this.maxInterimSamples = Math.round((options.maxInterimSec ?? 12) * ASR_SAMPLE_RATE)
    this.paddingSamples = Math.round((options.paddingSec ?? 0.2) * ASR_SAMPLE_RATE)
    this.minSpeechSamples = Math.round(settings.minSpeechSec * ASR_SAMPLE_RATE)
    this.minSilenceSamples = Math.round(settings.minSilenceSec * ASR_SAMPLE_RATE)
    // Must cover the longest utterance plus padding.
    this.audio = new RecentAudio(settings.maxSpeechSec * 2 + 10)
    this.pending = new Float32Array(VAD_WINDOW_SAMPLES)
  }

  get channel(): string {
    return this.options.channel
  }

  /** Seconds this channel's processing trails the audio clock (live only). */
  lagSec(): number {
    if (!this.options.realtime || !this.started) return 0
    if (this.queueLagSec !== null) return this.queueLagSec
    return Math.max(0, (this.now() - this.firstAudioAt) / 1000 - this.stats.audioSeconds)
  }

  private now(): number {
    return this.options.now ? this.options.now() : performance.now()
  }

  /**
   * Feed 16 kHz mono samples. `queuedAt` (same clock as `now`) is when the
   * frame was sent; processing it later than that means the engine is behind.
   */
  ingest(samples: Float32Array, queuedAt?: number): void {
    if (queuedAt !== undefined) this.queueLagSec = Math.max(0, (this.now() - queuedAt) / 1000)
    if (!this.started) {
      this.started = true
      this.firstAudioAt = this.now()
      this.options.emit({ event: 'channel_start', channel: this.channel, epochMs: Date.now() })
    }
    this.audio.push(samples)
    this.stats.audioSeconds += samples.length / ASR_SAMPLE_RATE
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(VAD_WINDOW_SAMPLES - this.pendingLength, samples.length - offset)
      this.pending.set(samples.subarray(offset, offset + take), this.pendingLength)
      this.pendingLength += take
      offset += take
      if (this.pendingLength === VAD_WINDOW_SAMPLES) {
        this.vad.acceptWaveform(this.pending.slice())
        this.fed += VAD_WINDOW_SAMPLES
        this.pendingLength = 0
        this.trackActivity()
        this.drainSegments(false)
      }
    }
    this.maybeInterim()
  }

  /** End of input: decode what remains and emit the channel's final text. */
  finish(extra: Record<string, unknown> = {}): void {
    if (this.pendingLength > 0) {
      const tail = new Float32Array(VAD_WINDOW_SAMPLES)
      tail.set(this.pending.subarray(0, this.pendingLength))
      this.vad.acceptWaveform(tail)
      this.fed += VAD_WINDOW_SAMPLES
      this.pendingLength = 0
    }
    this.vad.flush()
    this.drainSegments(true)
    this.activeStart = null
    this.options.emit({
      event: 'final',
      channel: this.channel,
      text: this.texts.join(' '),
      ...extra
    })
  }

  private trackActivity(): void {
    if (!this.vad.isDetected()) {
      // A blip shorter than Silero's minimum speech never becomes a segment;
      // forget it so the next interim decode starts at the next real speech.
      if (
        this.activeStart !== null &&
        this.fed - this.lastDetectedAt > 2 * this.minSilenceSamples
      ) {
        this.activeStart = null
        this.nextInterimLength = this.interimSamples
      }
      return
    }
    this.lastDetectedAt = this.fed
    // Mirrors Silero's own segment start (two windows plus min speech back).
    this.activeStart ??= Math.max(
      this.lastSegmentEnd,
      this.fed - 2 * VAD_WINDOW_SAMPLES - this.minSpeechSamples,
      0
    )
  }

  private drainSegments(final: boolean): void {
    while (!this.vad.isEmpty()) {
      // A copied segment: Electron forbids addon-owned external ArrayBuffers.
      const segment = this.vad.front(false)
      const start = segment.start
      const length = segment.samples.length
      this.vad.pop()
      this.decodeSegment(start, start + length, final)
      this.activeStart = null
      this.nextInterimLength = this.interimSamples
      if (this.vad.isDetected()) this.trackActivity()
    }
  }

  private decode(samples: Float32Array): { result: TdtResult; ms: number } {
    const began = this.now()
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: ASR_SAMPLE_RATE })
    this.recognizer.decode(stream)
    const result = this.recognizer.getResult(stream)
    const ms = this.now() - began
    this.stats.decodeMs += ms
    this.options.load?.record(ms)
    return { result, ms }
  }

  private decodeSegment(start: number, end: number, final: boolean): void {
    const audioEnd = this.audio.length
    const window = this.audio.slice(
      start - this.paddingSamples,
      Math.min(audioEnd, end + this.paddingSamples)
    )
    this.lastSegmentEnd = Math.max(this.lastSegmentEnd, end)
    if (window.samples.length < VAD_WINDOW_SAMPLES) return
    const { result } = this.decode(window.samples)
    this.stats.utterances++
    const offsetSec = window.start / ASR_SAMPLE_RATE
    const limitSec = (window.start + window.samples.length) / ASR_SAMPLE_RATE
    const tokens = tokensFromResult(result, offsetSec, limitSec)
    const text = joinedText(result)
    if (text) this.texts.push(text)
    if (tokens.length > 0) {
      this.options.emit({ event: 'timings', channel: this.channel, tokens })
      this.trackOpenWords(tokens)
    }
    if (!final) this.publishPartial('')
  }

  /** Mirror the host segmenter so captions show exactly the not-yet-closed text. */
  private trackOpenWords(tokens: EngineTokenTiming[]): void {
    const { pauseGapSec, maxSegmentSec } = DEFAULT_SEGMENTER_CONFIG
    for (const token of tokens) {
      const last = this.openWords[this.openWords.length - 1]
      if (!last || token.token.startsWith(' ')) {
        const first = this.openWords[0]
        if (
          last &&
          first &&
          (token.startSec - last.endSec > pauseGapSec ||
            token.endSec - first.startSec > maxSegmentSec)
        ) {
          this.openWords = []
        }
        this.openWords.push({ startSec: token.startSec, endSec: token.endSec, text: token.token })
      } else {
        last.text += token.token
        last.endSec = token.endSec
      }
    }
  }

  private maybeInterim(): void {
    if (!this.options.interim || this.activeStart === null) return
    const length = this.fed - this.activeStart
    if (length < this.nextInterimLength || length > this.maxInterimSamples) return
    this.nextInterimLength = Math.max(
      length + this.interimSamples,
      Math.round(length * (this.options.interimGrowth ?? 1.5))
    )
    if (
      (this.options.load && !this.options.load.allowsOptionalWork()) ||
      this.lagSec() > (this.options.maxInterimLagSec ?? 1.5)
    ) {
      this.stats.skippedInterims++
      return
    }
    const window = this.audio.slice(this.activeStart - this.paddingSamples, this.fed)
    const { result } = this.decode(window.samples)
    this.stats.interimDecodes++
    this.publishPartial(joinedText(result))
  }

  private publishPartial(interim: string): void {
    const open = this.openWords
      .map((word) => word.text)
      .join('')
      .trim()
    const text = [open, interim].filter(Boolean).join(' ')
    if (text === this.lastPartial) return
    this.lastPartial = text
    this.options.emit({ event: 'partial', channel: this.channel, text })
  }
}
