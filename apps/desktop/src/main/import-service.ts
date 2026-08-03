import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { MeetingFileStore } from '@repo/meetings-store'
import type { TranscriptSegment } from '../shared/engine-events'
import {
  IMPORT_AUDIO_CHANNEL,
  IMPORT_PROGRESS_CHANNEL,
  IMPORT_RETRANSCRIBE_CHANNEL,
  type ImportProgress,
  type ImportResult,
  type RetranscribeResult
} from '../shared/import-api'
import { AudioService, IMPORTABLE_EXTENSIONS } from './audio-service'
import {
  transcribeFileToSegments,
  type BatchProgress,
  type BatchTranscription
} from './import-logic'

/** Sanity ceiling — a 2GB "audio file" is a mistake, not a meeting. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Audio import & re-transcription. Both run the engine's batch transcriber
 * in a dedicated process (import-logic.ts) so a live recording session is
 * never superseded, then write the meeting store directly — sync and
 * connectors pick the change up through the store's onDidWrite hook like
 * any other edit.
 */
export class ImportService {
  /** One batch job at a time keeps memory and thermal behavior sane. */
  private busy = false

  constructor(
    private readonly enginePath: string,
    private readonly meetings: MeetingFileStore,
    private readonly audio: AudioService,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly platformTranscriber?: (
      filePath: string,
      onProgress?: (progress: BatchProgress) => void
    ) => Promise<BatchTranscription>
  ) {}

  registerIpc(): void {
    ipcMain.handle(IMPORT_AUDIO_CHANNEL, () => this.importAudio())
    ipcMain.handle(IMPORT_RETRANSCRIBE_CHANNEL, (_event, meetingId: unknown) =>
      this.retranscribe(String(meetingId ?? ''))
    )
  }

  private progress(payload: ImportProgress): void {
    this.broadcast(IMPORT_PROGRESS_CHANNEL, payload)
  }

  private toBatchProgress(
    kind: ImportProgress['kind'],
    meetingId: string
  ): (p: BatchProgress) => void {
    return (p) =>
      this.progress({
        kind,
        meetingId,
        stage: p.stage === 'downloading_model' ? 'downloading_model' : p.stage,
        ...(typeof p.progress === 'number' ? { progress: p.progress } : {})
      })
  }

  async importAudio(): Promise<ImportResult> {
    if (this.busy) return { error: 'Another import is still running — one at a time.' }
    if (!this.platformTranscriber && !existsSync(this.enginePath)) {
      return { error: 'The transcription engine is not available on this platform yet.' }
    }
    const picked = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0]!, {
      title: 'Import audio',
      filters: [{ name: 'Audio', extensions: [...IMPORTABLE_EXTENSIONS] }],
      properties: ['openFile']
    })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    const filePath = picked.filePaths[0]!
    const ext = extname(filePath).slice(1).toLowerCase()
    if (!(IMPORTABLE_EXTENSIONS as readonly string[]).includes(ext)) {
      return { error: `Only ${IMPORTABLE_EXTENSIONS.join(', ')} files can be imported right now.` }
    }
    try {
      if (statSync(filePath).size > MAX_IMPORT_BYTES) {
        return { error: 'That file is too large to import (2 GB max).' }
      }
    } catch {
      return { error: 'Could not read that file.' }
    }

    this.busy = true
    const meetingId = randomUUID()
    try {
      this.progress({ kind: 'import', meetingId, stage: 'starting' })
      const result = await this.transcribe(filePath, this.toBatchProgress('import', meetingId))
      const kept = result.segments.filter((s) => !s.echo)
      if (kept.length === 0) {
        return { error: 'No speech was found in that file.' }
      }
      this.progress({ kind: 'import', meetingId, stage: 'finishing' })
      // Audio part first so playback is ready the moment the meeting opens.
      this.audio.addImportedPart(meetingId, filePath, Math.round(result.audioSeconds * 1000))
      const now = new Date()
      this.meetings.upsert({
        id: meetingId,
        title: basename(filePath, extname(filePath)),
        createdAt: now.toISOString(),
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        rawNotesMarkdown: '',
        segments: kept,
        echoSuppressed: result.segments.length - kept.length
      })
      return { meetingId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.busy = false
    }
  }

  async retranscribe(meetingId: string): Promise<RetranscribeResult> {
    if (this.busy) return { error: 'Another import is still running — one at a time.' }
    if (!this.platformTranscriber && !existsSync(this.enginePath)) {
      return { error: 'The transcription engine is not available on this platform yet.' }
    }
    const record = this.meetings.get(meetingId)
    if (!record) return { error: 'Meeting not found.' }
    const parts = this.audio.listPaths(meetingId)
    if (parts.length === 0) {
      return { error: 'This meeting has no saved recording to re-transcribe.' }
    }

    this.busy = true
    try {
      const all: TranscriptSegment[] = []
      let echoSuppressed = 0
      for (const part of parts) {
        this.progress({ kind: 'retranscribe', meetingId, stage: 'starting' })
        const result = await this.transcribe(
          part.path,
          this.toBatchProgress('retranscribe', meetingId)
        )
        for (const segment of result.segments) {
          if (segment.echo) {
            echoSuppressed += 1
            continue
          }
          all.push({
            ...segment,
            // Anchor to the part's wall-clock start so playback seek and
            // multi-part ordering keep working after the rebuild.
            ...(part.startEpochMs > 0
              ? { absoluteStartMs: part.startEpochMs + segment.startMs }
              : {})
          })
        }
      }
      if (all.length === 0) {
        return { error: 'Re-transcription produced no speech — keeping the current transcript.' }
      }
      all.sort((a, b) => (a.absoluteStartMs ?? a.startMs) - (b.absoluteStartMs ?? b.startMs))
      this.progress({ kind: 'retranscribe', meetingId, stage: 'finishing' })
      this.meetings.upsert({ id: meetingId, segments: all, echoSuppressed })
      return { meetingId, segmentCount: all.length }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.busy = false
    }
  }

  private transcribe(
    filePath: string,
    onProgress: (progress: BatchProgress) => void
  ): Promise<BatchTranscription> {
    return this.platformTranscriber
      ? this.platformTranscriber(filePath, onProgress)
      : transcribeFileToSegments(this.enginePath, filePath, onProgress)
  }
}
