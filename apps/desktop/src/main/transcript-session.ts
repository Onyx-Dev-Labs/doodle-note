import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineChannel, EngineEvent, TranscriptSegment } from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'
import { reconcileRefinedTranscript } from './transcript-refinement'

/**
 * Owns one live capture session: feeds engine timings through the
 * SegmentAssembler, broadcasts newly completed segments to the renderer,
 * and persists the finished session to disk.
 *
 * Persistence is a JSON file per session for now — the placeholder for the
 * upcoming local-buffer + cloud-sync path. Echo-flagged segments are saved
 * (for tuning) but display layers filter them.
 */
export class TranscriptSession {
  private assembler: SegmentAssembler | null = null
  private segments: TranscriptSegment[] = []
  private finals: Partial<Record<EngineChannel, string>> = {}
  private startedAtIso: string | null = null
  private saved = false
  private error: string | undefined
  private captureId: string | undefined

  constructor(
    private readonly broadcast: (ev: EngineEvent) => void,
    private readonly sessionsDir: string
  ) {}

  handle(ev: EngineEvent): void {
    switch (ev.event) {
      case 'started':
        // File modes don't create a session; a new live run resets everything.
        this.assembler = ev.command === 'live' ? new SegmentAssembler() : null
        this.segments = []
        this.finals = {}
        this.startedAtIso = new Date().toISOString()
        this.saved = false
        this.error = undefined
        this.captureId = ev.captureId
        return
      case 'channel_start':
        this.assembler?.setChannelEpoch(ev.channel, ev.epochMs)
        return
      case 'timings':
        if (this.assembler && ev.channel) {
          this.publish(this.assembler.addTimings(ev.channel, ev.tokens))
        }
        return
      case 'final':
        if (this.assembler && ev.channel) {
          this.finals[ev.channel] = ev.text
          this.publish(this.assembler.flush(ev.channel))
        }
        return
      case 'refined':
        if (this.assembler) {
          this.publish(this.assembler.flush())
          this.segments = reconcileRefinedTranscript(this.segments, ev.transcripts)
          for (const transcript of ev.transcripts) this.finals[transcript.channel] = transcript.text
          this.broadcast({ event: 'segments-replaced', segments: this.segments })
        }
        return
      case 'error':
        this.error = ev.message
        return
      case 'done':
        this.finish()
        return
      case 'exit':
        // Engine is gone (graceful or not) — make sure the session hit disk.
        this.finish(
          'Capture ended before finalization completed. Use the saved transcript or recording to retry.'
        )
        return
      default:
        return
    }
  }

  private publish(newSegments: TranscriptSegment[]): void {
    if (newSegments.length === 0) return
    this.segments.push(...newSegments)
    this.broadcast({ event: 'segments', segments: newSegments })
  }

  private finish(exitError?: string): void {
    if (!this.assembler || this.saved) return
    this.publish(this.assembler.flush())
    this.saved = true
    const error = this.error ?? exitError
    if (this.segments.length === 0) {
      this.broadcast({
        event: 'capture-finalized',
        ...(this.captureId ? { captureId: this.captureId } : {}),
        ...(error ? { error } : {})
      })
      return
    }

    try {
      mkdirSync(this.sessionsDir, { recursive: true })
      const stamp = (this.startedAtIso ?? new Date().toISOString()).replace(/[:.]/g, '-')
      const path = join(this.sessionsDir, `session-${stamp}.json`)
      writeFileSync(
        path,
        JSON.stringify(
          {
            version: 1,
            startedAt: this.startedAtIso,
            savedAt: new Date().toISOString(),
            finals: this.finals,
            segments: this.segments
          },
          null,
          2
        )
      )
      this.broadcast({ event: 'session-saved', path, segmentCount: this.segments.length })
      this.broadcast({
        event: 'capture-finalized',
        ...(this.captureId ? { captureId: this.captureId } : {}),
        ...(error ? { error } : {})
      })
    } catch (err) {
      const message = `Failed to save session: ${String(err)}`
      this.broadcast({ event: 'error', message })
      this.broadcast({
        event: 'capture-finalized',
        ...(this.captureId ? { captureId: this.captureId } : {}),
        error: message
      })
    }
  }
}
