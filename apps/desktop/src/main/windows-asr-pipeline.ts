import type { EngineTokenTiming } from '../shared/engine-events'
import { DEFAULT_SEGMENTER_CONFIG } from './segmenter'

/**
 * Windows speech pipeline shared by live captions and imports.
 *
 * Silero VAD says when someone is speaking; this pipeline turns that into
 * utterances itself and decodes each one whole with an offline Parakeet
 * recognizer, whose tokens carry real start times and log-probabilities.
 * Decoding whole utterances keeps the full model context while bounding cost:
 * unlike the buffered streaming export of Parakeet Unified, nothing is
 * re-encoded per 80 ms step, so two channels fit on ordinary laptop CPUs.
 *
 * Utterance length is bounded here, not by the VAD: sherpa's VAD only raises
 * its threshold past its maximum and can run on for minutes. When an
 * utterance reaches `maxSpeechSec`, it is cut at the quietest 100 ms of the
 * last few seconds; both sides are decoded with overlapping context and each
 * word is kept by exactly one side (by its start time), so a forced cut can
 * neither drop nor double a word. Every sample from an utterance's start is
 * retained until it is decoded, so no speech is ever dropped. Padding before
 * an utterance never reaches back into audio that was already decoded.
 *
 * Live captions additionally re-decode the utterance in progress on a
 * geometric schedule, under a load guard, to show a growing caption.
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
  /** True from a detected speech start until its required silence has passed. */
  isDetected(): boolean
  isEmpty(): boolean
  /** Drop sherpa's queued segments; the pipeline forms its own. */
  clear(): void
}

export interface VadSettings {
  threshold: number
  minSilenceSec: number
  minSpeechSec: number
  /** Hard utterance bound enforced by the pipeline (forced cut). */
  maxSpeechSec: number
}

/** Passed to sherpa so its own maximum-length behaviour never engages. */
export const VAD_UNBOUNDED_SEC = 36_000
/** A forced cut picks the quietest point in this many trailing seconds. */
export const FORCED_CUT_SEARCH_SEC = 3
/** Context shared by the two decodes around a forced cut. */
export const FORCED_CUT_OVERLAP_SEC = 1

/**
 * Live: utterances end at a 0.5 s pause and are force-cut at 8 s. Measured on
 * the 30-minute AMI meeting (Unified, final stitching): cap 8 s -> 14.6% WER,
 * words committed 4.4 s (p90 7.1 s) after they end; 12 s -> 15.3%, 6.0 s
 * (p90 10.4 s); 15 s -> 15.1%, 7.1 s (p90 12.8 s). Meeting clips: 10.1%,
 * 10.3%, 10.6%. Captions fill the gap with interim decodes.
 */
export const LIVE_VAD: VadSettings = {
  threshold: 0.5,
  minSilenceSec: 0.5,
  minSpeechSec: 0.25,
  maxSpeechSec: 8
}

/**
 * Imports and Re-transcribe: no caption latency to protect, so utterances end
 * only at a 1 s pause and are cut at 30 s (30-minute meeting: TDT v2 15.3%
 * at 30 s vs 15.6% at 20 s; v3 17.3% vs 17.9%; meeting clips unchanged).
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

/** Contiguous channel audio from `base` (absolute sample index) to `end`. */
class SampleStore {
  private data = new Float32Array(16_000 * 8)
  private base = 0
  private length = 0

  get end(): number {
    return this.base + this.length
  }

  get start(): number {
    return this.base
  }

  push(samples: Float32Array): void {
    if (this.length + samples.length > this.data.length) {
      const next = new Float32Array(Math.max(this.data.length * 2, this.length + samples.length))
      next.set(this.data.subarray(0, this.length))
      this.data = next
    }
    this.data.set(samples, this.length)
    this.length += samples.length
  }

  /** Forget samples before `index` (never forgets anything after it). */
  dropBefore(index: number): void {
    const drop = Math.min(this.length, index - this.base)
    if (drop <= 0) return
    this.data.copyWithin(0, drop, this.length)
    this.length -= drop
    this.base += drop
  }

  /** Copy [from, to), clamped to what is retained. */
  slice(from: number, to: number): { start: number; samples: Float32Array } {
    const start = Math.max(from, this.base)
    const end = Math.min(to, this.end)
    if (end <= start) return { start, samples: new Float32Array(0) }
    return { start, samples: this.data.slice(start - this.base, end - this.base) }
  }

  /** Absolute index of the quietest 100 ms window centred in [from, to). */
  quietest(from: number, to: number): number {
    const hop = 160
    const width = 1600
    let best = from
    let bestEnergy = Number.POSITIVE_INFINITY
    for (let centre = from; centre < to; centre += hop) {
      const a = Math.max(this.base, centre - width / 2) - this.base
      const b = Math.min(this.end, centre + width / 2) - this.base
      let energy = 0
      for (let i = a; i < b; i++) energy += this.data[i]! * this.data[i]!
      energy /= Math.max(1, b - a)
      if (energy < bestEnergy) {
        bestEnergy = energy
        best = centre
      }
    }
    return best
  }
}

interface OpenWord {
  startSec: number
  endSec: number
  text: string
}

/** The words committed just before a forced cut, to stitch the next part. */
interface Seam {
  cutSec: number
  words: Array<{ norm: string; startSec: number }>
}

interface Utterance {
  /** First sample whose words this utterance owns. */
  keepFrom: number
  /** Set on the part after a forced cut. */
  seam?: Seam
  /** First sample given to the decoder (keepFrom minus context). */
  decodeFrom: number
}

export interface PipelineStats {
  audioSeconds: number
  decodeMs: number
  utterances: number
  forcedCuts: number
  /** Longest stretch of audio given to one decode, in seconds. */
  longestDecodeSec: number
  interimDecodes: number
  skippedInterims: number
}

/** Group tokens into words (a leading space starts one) and keep words starting in [from, to). */
export function keepWords(
  tokens: EngineTokenTiming[],
  fromSec: number,
  toSec: number
): EngineTokenTiming[] {
  const kept: EngineTokenTiming[] = []
  let keeping = false
  tokens.forEach((token, index) => {
    if (index === 0 || token.token.startsWith(' ')) {
      keeping = token.startSec >= fromSec && token.startSec < toSec
    }
    if (keeping) kept.push(token)
  })
  if (kept.length > 0 && !kept[0]!.token.startsWith(' ')) {
    kept[0] = { ...kept[0]!, token: ` ${kept[0]!.token}` }
  }
  return kept
}

function wordNorm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']/g, '')
}

/** Words as token runs (a leading space starts one). */
function groupWords(tokens: EngineTokenTiming[]): EngineTokenTiming[][] {
  const words: EngineTokenTiming[][] = []
  for (const token of tokens) {
    if (words.length === 0 || token.token.startsWith(' ')) words.push([token])
    else words[words.length - 1]!.push(token)
  }
  return words
}

/**
 * Two decodes around a forced cut can place the same word on either side of
 * it: timestamps move by up to a second with different context, so time alone
 * cannot decide ownership. The part after a cut is decoded from a second
 * before the cut and aligned on text: it resumes after its copy of the last
 * word the part before committed (the copy nearest in time, within 1.5 s).
 * Only when that word cannot be found does time decide (words after it).
 */
export function stitchSeam(tokens: EngineTokenTiming[], seam: Seam): EngineTokenTiming[] {
  const words = groupWords(tokens)
  const last = seam.words[seam.words.length - 1]
  let resume = 0
  if (last) {
    let best = -1
    let bestDistance = Number.POSITIVE_INFINITY
    words.forEach((word, index) => {
      const startSec = word[0]!.startSec
      const distance = Math.abs(startSec - last.startSec)
      if (startSec > seam.cutSec + 1.5 || distance > 1.5) return
      const norm = wordNorm(word.map((t) => t.token).join(''))
      const same =
        norm.length > 0 &&
        (norm === last.norm ||
          (Math.min(norm.length, last.norm.length) >= 3 &&
            (norm.startsWith(last.norm) || last.norm.startsWith(norm))))
      if (same && distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    })
    resume =
      best >= 0
        ? best + 1
        : Math.max(
            0,
            words.findIndex((word) => word[0]!.startSec > last.startSec + 0.05)
          )
    if (best < 0 && words.every((word) => word[0]!.startSec <= last.startSec + 0.05)) {
      resume = words.length
    }
  } else {
    const first = words.findIndex((word) => word[0]!.startSec >= seam.cutSec - 0.3)
    resume = first < 0 ? words.length : first
  }
  const kept = words.slice(resume).flat()
  if (kept.length > 0 && !kept[0]!.token.startsWith(' ')) {
    kept[0] = { ...kept[0]!, token: ` ${kept[0]!.token}` }
  }
  return kept
}

function tokensText(tokens: EngineTokenTiming[]): string {
  return tokens
    .map((token) => token.token)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export class UtteranceTranscriber<S extends OfflineStreamLike = OfflineStreamLike> {
  private readonly audio = new SampleStore()
  private readonly pending: Float32Array
  private pendingLength = 0
  /** Samples given to the VAD (whole windows). */
  private fed = 0
  private utterance: Utterance | null = null
  /** End of the last decoded window; padding never reaches before it. */
  private decodedThrough = 0
  /** Utterance length (samples) at which the next interim decode runs. */
  private nextInterimLength = 0
  private lastPartial = ''
  private openWords: OpenWord[] = []
  private readonly texts: string[] = []
  private started = false
  private firstAudioAt = 0
  private queueLagSec: number | null = null
  private readonly settings: VadSettings
  private readonly interimSamples: number
  private readonly maxSamples: number
  private readonly paddingSamples: number
  private readonly onsetSamples: number
  private readonly minSilenceSamples: number
  private readonly overlapSamples: number
  private readonly searchSamples: number
  readonly stats: PipelineStats = {
    audioSeconds: 0,
    decodeMs: 0,
    utterances: 0,
    forcedCuts: 0,
    longestDecodeSec: 0,
    interimDecodes: 0,
    skippedInterims: 0
  }

  constructor(
    private readonly recognizer: OfflineRecognizerLike<S>,
    private readonly vad: VadLike,
    private readonly options: PipelineOptions
  ) {
    this.settings = options.vadSettings ?? LIVE_VAD
    const rate = ASR_SAMPLE_RATE
    this.interimSamples = Math.round((options.interimIntervalSec ?? 1) * rate)
    this.nextInterimLength = this.interimSamples
    this.maxSamples = Math.round(this.settings.maxSpeechSec * rate)
    this.paddingSamples = Math.round((options.paddingSec ?? 0.2) * rate)
    // Silero backdates a speech start by two windows plus the minimum speech.
    this.onsetSamples = 2 * VAD_WINDOW_SAMPLES + Math.round(this.settings.minSpeechSec * rate)
    this.minSilenceSamples = Math.round(this.settings.minSilenceSec * rate)
    this.overlapSamples = Math.round(FORCED_CUT_OVERLAP_SEC * rate)
    this.searchSamples = Math.round(
      Math.min(FORCED_CUT_SEARCH_SEC, this.settings.maxSpeechSec / 2) * rate
    )
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

  /**
   * Channel time (seconds) before which every word has been committed or the
   * audio is known not to contain speech. Used to hold back echo checks.
   */
  settledThroughSec(): number {
    const settled = this.utterance
      ? this.utterance.keepFrom
      : Math.max(this.decodedThrough, this.fed - this.onsetSamples)
    return Math.max(0, settled) / ASR_SAMPLE_RATE
  }

  private now(): number {
    return this.options.now ? this.options.now() : performance.now()
  }

  /**
   * Feed 16 kHz mono samples. `queuedAt` (same clock as `now`) is when the
   * frame was sent; processing it later than that means the engine is behind.
   */
  ingest(samples: Float32Array, queuedAt?: number): void {
    const lag = queuedAt !== undefined ? Math.max(0, this.now() - queuedAt) : 0
    if (queuedAt !== undefined) this.queueLagSec = lag / 1000
    if (!this.started) {
      this.started = true
      this.firstAudioAt = this.now()
      // Anchor the channel to when its first frame arrived, not when a busy
      // worker got round to it.
      this.options.emit({
        event: 'channel_start',
        channel: this.channel,
        epochMs: Math.round(Date.now() - lag)
      })
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
        this.step(false)
      }
    }
    this.maybeInterim()
    this.trim()
  }

  /** End of input: decode what remains and emit the channel's final text. */
  finish(extra: Record<string, unknown> = {}): void {
    if (this.pendingLength > 0) {
      const tail = new Float32Array(VAD_WINDOW_SAMPLES)
      tail.set(this.pending.subarray(0, this.pendingLength))
      this.vad.acceptWaveform(tail)
      this.fed += VAD_WINDOW_SAMPLES
      this.pendingLength = 0
      this.step(true)
    }
    if (this.utterance) this.decodeUtterance(this.audio.end, Number.POSITIVE_INFINITY, true)
    this.utterance = null
    this.vad.clear()
    this.options.emit({
      event: 'final',
      channel: this.channel,
      text: this.texts.join(' '),
      ...extra
    })
  }

  /** One VAD window: open, close or force-cut the current utterance. */
  private step(final: boolean): void {
    const speaking = this.vad.isDetected()
    // Segments are formed here; sherpa's own queue is not used.
    if (!this.vad.isEmpty()) this.vad.clear()
    if (speaking && !this.utterance) {
      const start = Math.max(0, this.fed - this.onsetSamples, this.decodedThrough)
      const decodeFrom = Math.max(
        this.decodedThrough,
        start - this.paddingSamples,
        this.audio.start
      )
      // Padding never overlaps an earlier decode, so every word heard in this
      // window is this utterance's (models often time the first word early).
      this.utterance = { keepFrom: decodeFrom, decodeFrom }
      this.nextInterimLength = this.interimSamples
    } else if (!speaking && this.utterance) {
      const end = Math.max(this.utterance.keepFrom, this.fed - this.minSilenceSamples)
      this.decodeUtterance(
        Math.min(this.audio.end, end + this.paddingSamples),
        Number.POSITIVE_INFINITY,
        final
      )
      this.utterance = null
    }
    if (this.utterance && this.fed - this.utterance.keepFrom >= this.maxSamples)
      this.forceCut(final)
  }

  /** Cut a long utterance at its quietest recent point; decode the first part. */
  private forceCut(final: boolean): void {
    const utterance = this.utterance!
    const latest = this.fed - this.overlapSamples
    const earliest = Math.max(utterance.keepFrom + this.overlapSamples, latest - this.searchSamples)
    const cut = this.audio.quietest(earliest, Math.max(earliest + 1, latest))
    // The first part sees `overlap` beyond the cut; words starting before it are its own.
    const committed = this.decodeUtterance(cut + this.overlapSamples, cut, final)
    this.stats.forcedCuts++
    const cutSec = cut / ASR_SAMPLE_RATE
    this.utterance = {
      keepFrom: cut,
      decodeFrom: cut - this.overlapSamples,
      seam: {
        cutSec,
        words: groupWords(committed)
          .filter((word) => word[0]!.startSec >= cutSec - 1.5)
          .map((word) => ({
            norm: wordNorm(word.map((t) => t.token).join('')),
            startSec: word[0]!.startSec
          }))
      }
    }
    this.nextInterimLength = this.interimSamples
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

  /**
   * Decode [utterance.decodeFrom, to) and commit the words that start in
   * [utterance.keepFrom, keepUntil).
   */
  /** This utterance's words from one decode of it. */
  private ownWords(
    all: EngineTokenTiming[],
    utterance: Utterance,
    keepUntilSec: number
  ): EngineTokenTiming[] {
    const rate = ASR_SAMPLE_RATE
    if (!utterance.seam) return keepWords(all, utterance.keepFrom / rate, keepUntilSec)
    return stitchSeam(keepWords(all, utterance.decodeFrom / rate, keepUntilSec), utterance.seam)
  }

  private decodeUtterance(to: number, keepUntil: number, final: boolean): EngineTokenTiming[] {
    const utterance = this.utterance!
    const window = this.audio.slice(utterance.decodeFrom, to)
    if (window.start > utterance.decodeFrom) {
      // Unreachable by construction (audio is kept from decodeFrom); never silent.
      this.options.emit({
        event: 'error',
        channel: this.channel,
        message: 'Speech audio was released before it was transcribed.'
      })
    }
    this.decodedThrough = Math.max(this.decodedThrough, Math.min(to, keepUntil))
    if (window.samples.length < VAD_WINDOW_SAMPLES) return []
    const { result } = this.decode(window.samples)
    this.stats.utterances++
    this.stats.longestDecodeSec = Math.max(
      this.stats.longestDecodeSec,
      window.samples.length / ASR_SAMPLE_RATE
    )
    const rate = ASR_SAMPLE_RATE
    const all = tokensFromResult(
      result,
      window.start / rate,
      (window.start + window.samples.length) / rate
    )
    const tokens = this.ownWords(all, utterance, keepUntil / rate)
    const text = tokensText(tokens)
    if (text) this.texts.push(text)
    if (tokens.length > 0) {
      this.options.emit({ event: 'timings', channel: this.channel, tokens })
      this.trackOpenWords(tokens)
    }
    if (!final) this.publishPartial('')
    return tokens
  }

  /** Keep only what an open or upcoming utterance can still need. */
  private trim(): void {
    const keep = this.utterance
      ? this.utterance.decodeFrom
      : Math.max(this.decodedThrough, this.fed - this.onsetSamples - this.paddingSamples)
    this.audio.dropBefore(Math.max(0, keep - VAD_WINDOW_SAMPLES))
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
    const utterance = this.utterance
    if (!this.options.interim || !utterance) return
    const length = this.fed - utterance.keepFrom
    if (length < this.nextInterimLength) return
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
    const window = this.audio.slice(utterance.decodeFrom, this.audio.end)
    if (window.samples.length < VAD_WINDOW_SAMPLES) return
    const { result } = this.decode(window.samples)
    this.stats.interimDecodes++
    const rate = ASR_SAMPLE_RATE
    const tokens = this.ownWords(
      tokensFromResult(result, window.start / rate, (window.start + window.samples.length) / rate),
      utterance,
      Number.POSITIVE_INFINITY
    )
    this.publishPartial(tokensText(tokens))
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
