import { defaultSpeakerId, defaultSpeakerLabel } from '@repo/meetings-store'
import type { EngineChannel, EngineTokenTiming, TranscriptSegment } from '../shared/engine-events'

/**
 * Assembles the engine's raw token timings into speaker-labeled transcript
 * segments, and suppresses acoustic echo that AEC missed.
 *
 * Input: incremental `timings` batches per channel. Parakeet tokens are
 * subwords; a token whose text begins with a space starts a new word, so
 * plain concatenation reproduces the exact transcript text.
 *
 * Segmentation: a segment closes when the next word starts after a pause
 * gap, or when the segment exceeds a max duration (or on flush).
 *
 * Echo suppression: the system channel is a clean digital tap, so echo only
 * flows one way — far-side audio bleeding into the mic. A mic segment is
 * flagged `echo` when most of its words occur in runs of 3+ consecutive
 * words that also appear on the system channel at nearly the same wall-clock
 * time. Genuine "me repeating them" almost never matches 3+ consecutive
 * words within the window.
 */
export interface SegmenterConfig {
  /** Silence between words that closes a segment (seconds). */
  pauseGapSec: number
  /** Hard cut so one monologue doesn't become a single giant segment. */
  maxSegmentSec: number
  /** |mic time − system time| window for an echo word match (seconds). */
  echoWindowSec: number
  /** Consecutive matched words needed before a run counts as echo. */
  echoMinRun: number
  /** Fraction of a segment's words in echo runs that flags the segment. */
  echoDropFraction: number
  /** How much system-channel word history to retain for matching (seconds). */
  systemMemorySec: number
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
  pauseGapSec: 0.8,
  maxSegmentSec: 15,
  echoWindowSec: 2.0,
  echoMinRun: 3,
  echoDropFraction: 0.7,
  systemMemorySec: 120
}

interface Word {
  text: string
  norm: string
  startSec: number
  endSec: number
  confidence: number
}

interface ChannelState {
  /** Tokens of the word currently being assembled. */
  pendingTokens: EngineTokenTiming[]
  /** Words of the currently open segment. */
  segmentWords: Word[]
  epochMs?: number
}

function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']/g, '')
}

export class SegmentAssembler {
  private readonly config: SegmenterConfig
  private readonly channels: Record<EngineChannel, ChannelState> = {
    mic: { pendingTokens: [], segmentWords: [] },
    system: { pendingTokens: [], segmentWords: [] }
  }
  /** Finalized system-channel words, kept for echo matching against the mic. */
  private systemHistory: Word[] = []
  private nextId = 1

  constructor(config: Partial<SegmenterConfig> = {}) {
    this.config = { ...DEFAULT_SEGMENTER_CONFIG, ...config }
  }

  setChannelEpoch(channel: EngineChannel, epochMs: number): void {
    this.channels[channel].epochMs = epochMs
  }

  /** Feed a timings batch; returns any segments this batch completed. */
  addTimings(channel: EngineChannel, tokens: EngineTokenTiming[]): TranscriptSegment[] {
    const state = this.channels[channel]
    const completed: TranscriptSegment[] = []

    for (const token of tokens) {
      const startsWord =
        token.token.startsWith(' ') ||
        state.pendingTokens.length === 0 ||
        token.startSec - state.pendingTokens[state.pendingTokens.length - 1]!.endSec >
          this.config.pauseGapSec
      if (startsWord) {
        const word = this.finalizePendingWord(state)
        if (word) completed.push(...this.acceptWord(channel, state, word))
      }
      state.pendingTokens.push(token)
    }
    return completed
  }

  /** Close pending words/segments (end of channel, or end of session). */
  flush(channel?: EngineChannel): TranscriptSegment[] {
    const targets: EngineChannel[] = channel ? [channel] : ['mic', 'system']
    const completed: TranscriptSegment[] = []
    for (const ch of targets) {
      const state = this.channels[ch]
      const word = this.finalizePendingWord(state)
      if (word) completed.push(...this.acceptWord(ch, state, word))
      const segment = this.closeSegment(ch, state)
      if (segment) completed.push(segment)
    }
    return completed
  }

  /* ---- word/segment assembly ---- */

  private finalizePendingWord(state: ChannelState): Word | null {
    if (state.pendingTokens.length === 0) return null
    const tokens = state.pendingTokens
    state.pendingTokens = []
    const text = tokens.map((t) => t.token).join('')
    const confidence = tokens.reduce((sum, t) => sum + t.confidence, 0) / tokens.length
    return {
      text,
      norm: normalizeWord(text),
      startSec: tokens[0]!.startSec,
      endSec: tokens[tokens.length - 1]!.endSec,
      confidence
    }
  }

  private acceptWord(channel: EngineChannel, state: ChannelState, word: Word): TranscriptSegment[] {
    const completed: TranscriptSegment[] = []

    if (channel === 'system') {
      this.systemHistory.push(word)
      const cutoff = word.endSec - this.config.systemMemorySec
      if (this.systemHistory.length > 0 && this.systemHistory[0]!.endSec < cutoff) {
        this.systemHistory = this.systemHistory.filter((w) => w.endSec >= cutoff)
      }
    }

    const words = state.segmentWords
    if (words.length > 0) {
      const last = words[words.length - 1]!
      const first = words[0]!
      const gap = word.startSec - last.endSec
      const length = word.endSec - first.startSec
      if (gap > this.config.pauseGapSec || length > this.config.maxSegmentSec) {
        const segment = this.closeSegment(channel, state)
        if (segment) completed.push(segment)
      }
    }
    state.segmentWords.push(word)
    return completed
  }

  private closeSegment(channel: EngineChannel, state: ChannelState): TranscriptSegment | null {
    const words = state.segmentWords
    if (words.length === 0) return null
    state.segmentWords = []

    const text = words
      .map((w) => w.text)
      .join('')
      .trim()
    if (text.length === 0) return null

    const startSec = words[0]!.startSec
    const endSec = words[words.length - 1]!.endSec
    const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length
    const epochMs = state.epochMs

    const segment: TranscriptSegment = {
      id: `seg_${this.nextId++}`,
      channel,
      speaker: defaultSpeakerLabel(channel),
      speakerId: defaultSpeakerId(channel),
      text,
      startMs: Math.round(startSec * 1000),
      endMs: Math.round(endSec * 1000),
      confidence: Math.round(confidence * 1000) / 1000,
      ...(epochMs !== undefined ? { absoluteStartMs: epochMs + Math.round(startSec * 1000) } : {})
    }

    if (channel === 'mic' && this.isEcho(words)) {
      segment.echo = true
    }
    return segment
  }

  /* ---- echo detection ---- */

  private isEcho(micWords: Word[]): boolean {
    if (micWords.length < this.config.echoMinRun) return false

    const micEpoch = this.channels.mic.epochMs
    const sysEpoch = this.channels.system.epochMs
    // Channels start at slightly different wall-clock moments; align their
    // timelines when both epochs are known, otherwise compare raw times.
    const skewSec =
      micEpoch !== undefined && sysEpoch !== undefined ? (micEpoch - sysEpoch) / 1000 : 0

    const matched = micWords.map((w) => {
      if (w.norm.length === 0) return false
      const wAligned = w.startSec + skewSec
      return this.systemHistory.some(
        (s) => s.norm === w.norm && Math.abs(s.startSec - wAligned) <= this.config.echoWindowSec
      )
    })

    let inRuns = 0
    let runLength = 0
    for (let i = 0; i <= matched.length; i++) {
      if (i < matched.length && matched[i]) {
        runLength++
      } else {
        if (runLength >= this.config.echoMinRun) inRuns += runLength
        runLength = 0
      }
    }

    return inRuns / micWords.length >= this.config.echoDropFraction
  }
}
