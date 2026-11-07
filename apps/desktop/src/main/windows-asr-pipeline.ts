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
 * last few seconds; the next part is decoded from a second before the cut and
 * aligned on text with the words already committed (stitchSeam). That
 * alignment handles the usual disagreements (re-timed, respelled, split or
 * dropped words) but is a best effort: a word both decodes misheard in
 * different ways can still be doubled or lost at a cut.
 * Every sample from an utterance's start is retained until it is decoded, so
 * no speech is ever dropped. Padding before an utterance never reaches back
 * into audio that was already decoded.
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
  /** Forget all state, including Silero's buffer of the speech in progress. */
  reset(): void
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
/**
 * Silero keeps every sample of the speech it is tracking (AMI meetings had
 * 127-172 s runs; music could run for hours). After this much continuous
 * detection the pipeline resets the VAD at its next forced cut, bounding that
 * buffer; the utterance carries on through the reset.
 */
export const VAD_RESET_AFTER_SEC = 60
const VAD_RESET_GRACE_SEC = 1
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
  words: Array<{ norm: string; startSec: number; endSec: number }>
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
  vadResets: number
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

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  ok: 'okay'
}

/**
 * A word as two decodes might both write it: lower case, letters and digits
 * only ("it's" / "its", "follow-up" / "followup"), number words as digits
 * ("ten" / "10") and "ok" as "okay".
 */
export function wordNorm(text: string): string {
  const plain = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  return NUMBER_WORDS[plain] ?? plain
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

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]!
}

/**
 * Whether two decodes heard the same word (both given as wordNorm): words of
 * up to four letters must match exactly ("the" is not "there", "this" is not
 * "thus"); longer ones may differ by a quarter of their letters ("Priya" /
 * "Pria", "redesign" / "redesigned").
 */
export function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) < 4 || Math.max(a.length, b.length) < 5) return false
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4))
}

/** Two decodes may time the same word up to this far apart. */
const SEAM_MATCH_SEC = 1
/** Second-decode words starting this soon after the cut are compared with the first part. */
const SEAM_WINDOW_SEC = 1.5
/** The part before a cut contributes its words from this long before the cut. */
export const SEAM_PRIOR_SEC = 2
/**
 * Cost of a second-decode word left unmatched before a match: an alignment
 * may not claim that words the first part never wrote were already committed
 * just to reach a repeated word ("signed the | contract with the bank" must
 * not match the second "the"). Committed words the second decode dropped
 * cost nothing.
 */
const SEAM_GAP_COST = 0.6

/** Two decodes of one word start this close together, once their shift is allowed for. */
const SEAM_SAME_START_SEC = 0.4

interface SeamWord {
  norm: string
  startSec: number
  endSec: number
}

/** The seam a forced cut at `cutSec` leaves for the next part. */
export function seamFrom(committed: EngineTokenTiming[], cutSec: number): Seam {
  return {
    cutSec,
    words: groupWords(committed)
      .filter((word) => word[0]!.startSec >= cutSec - SEAM_PRIOR_SEC)
      .map((word) => ({
        norm: wordNorm(word.map((t) => t.token).join('')),
        startSec: word[0]!.startSec,
        endSec: word[word.length - 1]!.endSec
      }))
  }
}

/** How much of `word` lies inside [startSec, endSec), as a fraction of it. */
function overlapFraction(word: SeamWord, startSec: number, endSec: number): number {
  const length = word.endSec - word.startSec
  if (length <= 0) return word.startSec >= startSec && word.startSec < endSec ? 1 : 0
  return Math.max(0, Math.min(word.endSec, endSec) - Math.max(word.startSec, startSec)) / length
}

/**
 * Two decodes around a forced cut disagree at the seam: timestamps move by up
 * to a second with context, and words can be spelled differently, split
 * ("follow-up" / "follow up") or dropped. The part after a cut is decoded
 * from a second before the cut, and its words near the cut are aligned with
 * the words the part before committed in its last two seconds: matches are
 * words that sound the same (sameWord on wordNorm, or one word spelled
 * exactly as two joined) within a second of each other; the best alignment maximises
 * matches, ties broken by time, and pays SEAM_GAP_COST for each second-decode
 * word skipped before a match. Matched words and anything between them
 * were already committed; the part resumes after its last match. Then any
 * second-decode word that starts with, and mostly overlaps, a committed word
 * left unmatched after that match (allowing for the time shift seen at the
 * match) is the same word written differently ("Siobhan" / "Shivon") and is
 * skipped too.
 * Words beyond the window are always new.
 *
 * This is a best effort, not a guarantee: a word both decodes got wrong in
 * different ways, at shifted times, can still be doubled or dropped.
 */
export function stitchSeam(tokens: EngineTokenTiming[], seam: Seam): EngineTokenTiming[] {
  const words = groupWords(tokens)
  const all: SeamWord[] = words.map((word) => ({
    norm: wordNorm(word.map((t) => t.token).join('')),
    startSec: word[0]!.startSec,
    endSec: word[word.length - 1]!.endSec
  }))
  const prior = seam.words
  const n = all.filter((word) => word.startSec < seam.cutSec + SEAM_WINDOW_SEC).length
  const head = all.slice(0, n)
  let resume = 0
  if (prior.length > 0) {
    const m = prior.length
    // best[i][j]: best alignment whose last match ends at prior i and head j.
    const best = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(-Infinity))
    // The first prior and head word of that last match, for the time shift there.
    const anchor = Array.from({ length: m + 1 }, () => new Array<[number, number]>(n + 1))
    const shapes: Array<[number, number]> = [
      [1, 1],
      [1, 2],
      [2, 1]
    ]
    const gain = (i: number, j: number, a: number, b: number): number => {
      const p = prior.slice(i - a, i)
      const h = head.slice(j - b, j)
      const dt = Math.abs(p[0]!.startSec - h[0]!.startSec)
      if (dt > SEAM_MATCH_SEC) return -Infinity
      const pn = p.map((w) => w.norm).join('')
      const hn = h.map((w) => w.norm).join('')
      // A word split in two must join back exactly: fuzzy matching would let
      // "message" absorb the "or" after it.
      if (a + b > 2 ? pn !== hn : !sameWord(pn, hn)) return -Infinity
      // A split word covers more of both decodes than its first half alone.
      return (a + b) / 2 - dt / 100
    }
    let top = -Infinity
    let end: [number, number] | null = null
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        for (const [a, b] of shapes) {
          if (i < a || j < b) continue
          const g = gain(i, j, a, b)
          if (g === -Infinity) continue
          // A first match, or one after an earlier match; skipped head words cost.
          let score = g - SEAM_GAP_COST * (j - b)
          for (let pi = 1; pi <= i - a; pi++) {
            for (let pj = 1; pj <= j - b; pj++) {
              if (best[pi]![pj] === -Infinity) continue
              score = Math.max(score, best[pi]![pj]! + g - SEAM_GAP_COST * (j - b - pj))
            }
          }
          if (score > best[i]![j]!) {
            best[i]![j] = score
            anchor[i]![j] = [i - a, j - b]
          }
        }
        if (best[i]![j]! > top + 1e-9) {
          top = best[i]![j]!
          end = [i, j]
        }
      }
    }
    // Committed words left unmatched after the alignment, and the time shift there.
    let unmatched: SeamWord[]
    let shift = 0
    if (end) {
      resume = end[1]
      unmatched = prior.slice(end[0])
      const [pa, ha] = anchor[end[0]]![end[1]]!
      shift = head[ha]!.startSec - prior[pa]!.startSec
    } else {
      const lastStart = prior[m - 1]!.startSec
      resume = all.findIndex((word) => word.startSec > lastStart + 0.05)
      if (resume < 0) resume = all.length
      unmatched = prior.slice(-1)
    }
    // The same word heard differently starts where the committed one did and
    // lies mostly inside it. (Word ends alone are unreliable: a word before a
    // pause can be timed to run on through it.)
    const sameSpot = (word: SeamWord, committed: SeamWord): boolean =>
      Math.abs(word.startSec - (committed.startSec + shift)) <= SEAM_SAME_START_SEC &&
      overlapFraction(word, committed.startSec + shift, committed.endSec + shift) >= 0.5
    while (resume < n && unmatched.some((word) => sameSpot(all[resume]!, word))) resume++
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
  /** Where Silero's current detection began, and when it was last reset. */
  private detectedSince: number | null = null
  private vadResetAt: number | null = null
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
    vadResets: 0,
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
    const detected = this.vad.isDetected()
    if (detected) {
      this.vadResetAt = null
      this.detectedSince ??= this.fed
    } else this.detectedSince = null
    // Right after a reset Silero needs its minimum speech again: not a pause.
    const speaking =
      detected ||
      (this.vadResetAt !== null &&
        this.fed - this.vadResetAt < VAD_RESET_GRACE_SEC * ASR_SAMPLE_RATE)
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
    if (
      this.detectedSince !== null &&
      this.fed - this.detectedSince > VAD_RESET_AFTER_SEC * ASR_SAMPLE_RATE
    ) {
      this.vad.reset()
      this.stats.vadResets++
      this.vadResetAt = this.fed
      this.detectedSince = null
    }
    const cutSec = cut / ASR_SAMPLE_RATE
    this.utterance = {
      keepFrom: cut,
      decodeFrom: cut - this.overlapSamples,
      seam: seamFrom(committed, cutSec)
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
