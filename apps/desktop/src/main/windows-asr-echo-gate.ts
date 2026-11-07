import type { EngineTokenTiming } from '../shared/engine-events'

/** Mic text is never held longer than this, even if the system channel stalls. */
export const ECHO_HOLD_MAX_MS = 2_000

/**
 * Keeps microphone timings from reaching the host before the system channel
 * has committed the same stretch of time.
 *
 * The host's segmenter flags a mic segment as echo by comparing it with
 * system words it has already seen. Windows commits text per utterance, so a
 * far-side utterance can still be decoding when the mic copy of it (picked up
 * from the speakers) has already been committed and closed: the echo would
 * be missed. Holding mic timings until the system channel is settled past
 * them restores the order the segmenter needs.
 *
 * The hold is bounded in wall time (ECHO_HOLD_MAX_MS), so a stalled, ended or
 * silent-but-frameless system channel cannot keep mic text from the transcript
 * and its checkpoints. While words are held, mic captions still show them.
 */
export class EchoOrderGate {
  private readonly held: Array<{
    endSec: number
    at: number
    text: string
    event: Record<string, unknown>
  }> = []
  private micEpochMs: number | undefined
  private systemEpochMs: number | undefined

  constructor(
    private readonly emit: (event: Record<string, unknown>) => void,
    /** System channel time before which all of its words are committed. */
    private readonly systemSettledSec: () => number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxHoldMs = ECHO_HOLD_MAX_MS
  ) {}

  /** Route one engine event from either channel. */
  push(event: Record<string, unknown>): void {
    if (event.event === 'channel_start' && typeof event.epochMs === 'number') {
      if (event.channel === 'mic') this.micEpochMs = event.epochMs
      if (event.channel === 'system') this.systemEpochMs = event.epochMs
    }
    if (event.event === 'timings' && event.channel === 'mic') {
      const tokens = event.tokens as EngineTokenTiming[]
      this.held.push({
        endSec: tokens[tokens.length - 1]?.endSec ?? 0,
        at: this.now(),
        text: tokens
          .map((token) => token.token)
          .join('')
          .trim(),
        event
      })
      this.release()
      return
    }
    // A mic final must follow its own timings.
    if (event.event === 'final' && event.channel === 'mic') this.release(true)
    if (event.event === 'partial' && event.channel === 'mic' && this.held.length > 0) {
      // Keep held words on screen: the caption drops committed words once the
      // pipeline's mirror of the host segment closes.
      const held = this.held.map((entry) => entry.text).join(' ')
      const text = String(event.text ?? '')
      if (!text.includes(held)) event = { ...event, text: [held, text].filter(Boolean).join(' ') }
    }
    this.emit(event)
    if (event.event === 'timings' && event.channel === 'system') this.release()
  }

  /** Emit held mic timings the system channel has caught up with, or that waited too long. */
  release(force = false): void {
    const skewSec =
      this.micEpochMs !== undefined && this.systemEpochMs !== undefined
        ? (this.micEpochMs - this.systemEpochMs) / 1000
        : 0
    const settled = this.systemSettledSec()
    const now = this.now()
    while (
      this.held.length > 0 &&
      (force ||
        this.held[0]!.endSec + skewSec <= settled ||
        now - this.held[0]!.at >= this.maxHoldMs)
    ) {
      this.emit(this.held.shift()!.event)
    }
  }
}
