import type { EngineTokenTiming } from '../shared/engine-events'

/**
 * Keeps microphone timings from reaching the host before the system channel
 * has committed the same stretch of time.
 *
 * The host's segmenter flags a mic segment as echo by comparing it with
 * system words it has already seen. Windows commits text per utterance, so a
 * far-side utterance can still be decoding when the mic copy of it (picked up
 * from the speakers) has already been committed and closed: the echo would
 * be missed. Holding mic timings until the system channel is settled past
 * them restores the order the segmenter needs. The hold is bounded by the
 * utterance cap, and captions are unaffected (partials pass straight through).
 */
export class EchoOrderGate {
  private readonly held: Array<{ endSec: number; event: Record<string, unknown> }> = []
  private micEpochMs: number | undefined
  private systemEpochMs: number | undefined

  constructor(
    private readonly emit: (event: Record<string, unknown>) => void,
    /** System channel time before which all of its words are committed. */
    private readonly systemSettledSec: () => number
  ) {}

  /** Route one engine event from either channel. */
  push(event: Record<string, unknown>): void {
    if (event.event === 'channel_start' && typeof event.epochMs === 'number') {
      if (event.channel === 'mic') this.micEpochMs = event.epochMs
      if (event.channel === 'system') this.systemEpochMs = event.epochMs
    }
    if (event.event === 'timings' && event.channel === 'mic') {
      const tokens = event.tokens as EngineTokenTiming[]
      this.held.push({ endSec: tokens[tokens.length - 1]?.endSec ?? 0, event })
      this.release()
      return
    }
    // A mic final must follow its own timings.
    if (event.event === 'final' && event.channel === 'mic') this.release(true)
    this.emit(event)
    if (event.event === 'timings' && event.channel === 'system') this.release()
  }

  /** Emit held mic timings the system channel has caught up with (all if `force`). */
  release(force = false): void {
    const skewSec =
      this.micEpochMs !== undefined && this.systemEpochMs !== undefined
        ? (this.micEpochMs - this.systemEpochMs) / 1000
        : 0
    const settled = this.systemSettledSec()
    while (this.held.length > 0 && (force || this.held[0]!.endSec + skewSec <= settled)) {
      this.emit(this.held.shift()!.event)
    }
  }
}
