import { resolveLibraryPath, type LibraryPath } from './library-path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  EngineChannel,
  EngineEvent,
  EngineSessionSnapshot,
  TranscriptSegment
} from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'
import type { SavedAudioFailures } from '@repo/meetings-store/types'

/**
 * Owns one live capture session: feeds engine timings through the
 * SegmentAssembler, broadcasts newly completed segments to the renderer,
 * and persists the finished session to disk.
 *
 * Persistence is a JSON file per session for now — the placeholder for the
 * upcoming local-buffer + cloud-sync path. Echo-flagged segments are saved
 * (for tuning) but display layers filter them.
 */
/** Windows-only behaviours; the Mac uses the defaults (all off). */
export interface TranscriptSessionOptions {
  checkpointOpenText?: boolean
  sortOnFinish?: boolean
}

const OPEN_TEXT_CHECKPOINT_MS = 5_000

export class TranscriptSession {
  private assembler: SegmentAssembler | null = null
  private segments: TranscriptSegment[] = []
  private finals: Partial<Record<EngineChannel, string>> = {}
  private startedAtIso: string | null = null
  private saved = false
  private error: string | undefined
  private captureId: string | undefined
  private meetingId: string | undefined
  private pendingMeetingId: string | undefined
  private phase: EngineSessionSnapshot['phase'] = 'starting'
  private partials: Partial<Record<EngineChannel, string>> = {}
  private captionsDelayed = false
  private legacyModel = false
  private legacyDownloadFailed = false
  private untranscribedSec = 0
  private savedAudioFailures: SavedAudioFailures = {}

  bindMeeting(meetingId?: string): void {
    // A start attempt may fail before `started`. Keep the previous capture's
    // snapshot attached to its owner until a new capture actually begins.
    this.pendingMeetingId = meetingId
  }

  snapshot(meetingId: string): EngineSessionSnapshot | null {
    if (meetingId !== this.meetingId || !this.assembler) return null
    return {
      meetingId,
      captureId: this.captureId,
      phase: this.phase,
      segments: [...this.segments],
      partials: { ...this.partials },
      savedAudioFailures: { ...this.savedAudioFailures },
      error: this.error,
      ...(this.captionsDelayed ? { captionsDelayed: true } : {}),
      ...(this.legacyModel ? { legacyModel: true } : {}),
      ...(this.legacyDownloadFailed ? { legacyDownloadFailed: true } : {}),
      ...(this.untranscribedSec > 0 ? { untranscribedSec: this.untranscribedSec } : {})
    }
  }

  private get sessionsDir(): string {
    return resolveLibraryPath(this.sessionsDirSource)
  }

  constructor(
    private readonly broadcast: (ev: EngineEvent) => void,
    private readonly sessionsDirSource: LibraryPath,
    private readonly assertAvailable: () => void = () => {},
    private readonly checkpoint: (
      segments: TranscriptSegment[],
      ended: boolean,
      savedAudioFailures: SavedAudioFailures
    ) => void = () => {},
    private readonly options: TranscriptSessionOptions = {}
  ) {}

  handle(ev: EngineEvent): void {
    if (ev.event !== 'started' && ev.captureId && ev.captureId !== this.captureId) return
    switch (ev.event) {
      case 'started':
        // File modes don't create a session; a new live run resets everything.
        this.meetingId = ev.command === 'live' ? this.pendingMeetingId : undefined
        this.assembler = ev.command === 'live' ? new SegmentAssembler() : null
        this.segments = []
        this.finals = {}
        this.startedAtIso = new Date().toISOString()
        this.saved = false
        this.error = undefined
        this.captureId = ev.captureId
        this.phase = 'starting'
        this.partials = {}
        this.captionsDelayed = false
        this.legacyModel = false
        this.legacyDownloadFailed = false
        this.untranscribedSec = 0
        this.savedAudioFailures = {}
        return
      case 'ready':
        this.phase = 'recording'
        return
      case 'partial':
        if (ev.channel) this.partials[ev.channel] = ev.text
        return
      case 'status':
        if (!this.assembler || this.saved) return
        if (ev.stage === 'audio_save_failed' && (ev.channel === 'mic' || ev.channel === 'system')) {
          if (!this.savedAudioFailures[ev.channel]) {
            this.savedAudioFailures[ev.channel] = true
            this.persistCheckpoint(false)
          }
        }
        if (ev.stage === 'captions_delayed') this.captionsDelayed = true
        if (ev.stage === 'captions_caught_up') this.captionsDelayed = false
        if (ev.stage === 'audio_not_transcribed') {
          this.untranscribedSec += Math.max(1, Math.round(ev.seconds ?? 0))
        }
        if (ev.stage === 'legacy_model') {
          this.legacyModel = true
          this.legacyDownloadFailed = ev.download === 'failed'
        }
        if (ev.stage === 'model_download_failed' && this.legacyModel)
          this.legacyDownloadFailed = true
        if (['finishing', 'saving_audio'].includes(ev.stage ?? '')) this.phase = 'finishing'
        return
      case 'channel_start':
        this.assembler?.setChannelEpoch(ev.channel, ev.epochMs)
        return
      case 'timings':
        if (this.assembler && ev.channel) {
          const closed = this.assembler.addTimings(ev.channel, ev.tokens)
          if (closed.length > 0) this.publish(closed)
          else this.maybeCheckpointOpenText()
        }
        return
      case 'final':
        if (this.assembler && ev.channel) {
          delete this.partials[ev.channel]
          this.finals[ev.channel] = ev.text
          this.publish(this.assembler.flush(ev.channel))
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
    this.persistCheckpoint(false)
    this.broadcast({ event: 'segments', segments: newSegments })
  }

  /** Committed words not yet in a closed segment reach disk at most this often. */
  private lastOpenCheckpoint = 0

  private maybeCheckpointOpenText(): void {
    if (!this.options.checkpointOpenText) return
    const now = Date.now()
    if (now - this.lastOpenCheckpoint < OPEN_TEXT_CHECKPOINT_MS) return
    this.persistCheckpoint(false)
  }

  private persistCheckpoint(ended: boolean): void {
    try {
      // Windows commits whole utterances; include the still-open segment (as
      // provisional text) so a crash keeps it. Each checkpoint rewrites the
      // full list, so the real segment replaces it once it closes.
      const open =
        this.options.checkpointOpenText && !ended && this.assembler ? this.assembler.peekOpen() : []
      this.lastOpenCheckpoint = Date.now()
      const segments = open.length > 0 ? [...this.segments, ...open] : this.segments
      this.checkpoint(segments, ended, { ...this.savedAudioFailures })
    } catch (error) {
      console.error('[transcript] meeting checkpoint failed:', error)
      this.error =
        'Could not save the meeting transcript. Keep this window open and free storage before retrying.'
      this.broadcast({ event: 'error', message: this.error })
    }
  }

  private finish(exitError?: string): void {
    if (!this.assembler || this.saved) return
    this.publish(this.assembler.flush())
    // Segments arrive in commit order; Windows commits per utterance and per
    // channel, so restore time order before the final save.
    if (this.options.sortOnFinish) {
      this.segments.sort(
        (a, b) =>
          (a.absoluteStartMs ?? a.startMs) - (b.absoluteStartMs ?? b.startMs) ||
          a.channel.localeCompare(b.channel)
      )
    }
    this.saved = true
    this.phase = 'ended'
    this.partials = {}
    this.persistCheckpoint(true)
    this.error ??= exitError
    const error = this.error
    if (this.segments.length === 0) {
      this.broadcast({
        event: 'capture-finalized',
        ...(this.captureId ? { captureId: this.captureId } : {}),
        ...(error ? { error } : {})
      })
      return
    }

    try {
      this.assertAvailable()
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
            savedAudioFailures: this.savedAudioFailures,
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
      console.error('[transcript] session save failed:', err)
      const message =
        'Failed to save session. Keep this window open and free storage before retrying.'
      this.error = message
      this.broadcast({ event: 'error', message })
      this.broadcast({
        event: 'capture-finalized',
        ...(this.captureId ? { captureId: this.captureId } : {}),
        error: message
      })
    }
  }
}
