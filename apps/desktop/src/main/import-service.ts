import { libraryIpc } from './library-ipc'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { MeetingFileStore } from '@repo/meetings-store'
import type { TranscriptSegment } from '../shared/engine-events'
import {
  IMPORT_AUDIO_CHANNEL,
  IMPORT_STATUS_CHANNEL,
  IMPORT_CANCEL_CHANNEL,
  IMPORT_RETRY_CHANNEL,
  IMPORT_PROGRESS_CHANNEL,
  IMPORT_RETRANSCRIBE_CHANNEL,
  type ImportResult,
  type RetranscribeResult
} from '../shared/import-api'
import { AudioService } from './audio-service'
import { IMPORTABLE_EXTENSIONS } from './import-media'
import {
  transcribeFileToSegments,
  type BatchOptions,
  type BatchProgress,
  type BatchTranscription
} from './import-logic'

import { ImportJobs, checkImportCanceled, type ImportJobContext } from './import-jobs'

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
  private picking = false
  private readonly jobs = new ImportJobs((state) => this.broadcast(IMPORT_PROGRESS_CHANNEL, state))
  private retrySource: { jobId: string; filePath?: string; meetingId?: string } | null = null

  get isBusy(): boolean {
    return this.picking || this.jobs.busy
  }

  constructor(
    private readonly enginePath: string,
    private readonly meetings: MeetingFileStore,
    private readonly audio: AudioService,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly platformTranscriber?: (
      filePath: string,
      onProgress?: (progress: BatchProgress) => void,
      options?: BatchOptions
    ) => Promise<BatchTranscription>
  ) {}

  registerIpc(): void {
    // These two operations cannot wait behind the library barrier: cancel
    // releases the import that a transfer may currently be waiting on.
    ipcMain.handle(IMPORT_STATUS_CHANNEL, () => this.jobs.snapshot())
    ipcMain.handle(IMPORT_CANCEL_CHANNEL, (_event, jobId: unknown) =>
      this.jobs.cancel(String(jobId ?? ''))
    )
    libraryIpc.handle(IMPORT_RETRY_CHANNEL, (_event, jobId: unknown) =>
      this.retry(String(jobId ?? ''))
    )
    libraryIpc.handle(IMPORT_AUDIO_CHANNEL, () => this.importAudio())
    libraryIpc.handle(IMPORT_RETRANSCRIBE_CHANNEL, (_event, meetingId: unknown) =>
      this.retranscribe(String(meetingId ?? ''))
    )
  }

  private toBatchProgress(
    context: ImportJobContext,
    part?: number,
    parts?: number
  ): (p: BatchProgress) => void {
    return (p) => context.progress(p.stage, p.progress, part, parts)
  }

  private async retry(jobId: string): Promise<ImportResult> {
    const source = this.retrySource
    const status = this.jobs.snapshot()
    if (this.isBusy) return { error: 'Another import is still running.' }
    if (
      !source ||
      source.jobId !== jobId ||
      status?.jobId !== jobId ||
      !['failed', 'canceled'].includes(status.stage)
    ) {
      return { error: 'That import is no longer available to retry. Choose the file again.' }
    }
    return source.filePath ? this.importFile(source.filePath) : this.retranscribe(source.meetingId!)
  }

  async importAudio(): Promise<ImportResult> {
    if (this.isBusy) return { error: 'Another import is still running. Please wait or cancel it.' }
    this.picking = true
    try {
      const picked = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0]!, {
        title: 'Import audio',
        filters: [{ name: 'Audio', extensions: [...IMPORTABLE_EXTENSIONS] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
      return await this.importFile(picked.filePaths[0]!)
    } finally {
      this.picking = false
    }
  }

  private async importFile(filePath: string): Promise<ImportResult> {
    if (!this.platformTranscriber && !existsSync(this.enginePath)) {
      return { error: 'The transcription engine is not available on this platform yet.' }
    }
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

    const meetingId = randomUUID()
    let storedAudio = false
    try {
      return await this.jobs.run(
        { kind: 'import', meetingId, label: basename(filePath) },
        async (context) => {
          this.retrySource = { jobId: this.jobs.snapshot()!.jobId, filePath }
          const result = await this.transcribe(filePath, this.toBatchProgress(context), {
            signal: context.signal
          })
          checkImportCanceled(context.signal)
          const kept = result.segments.filter((s) => !s.echo)
          if (kept.length === 0) {
            throw new Error('No speech was found in that file.')
          }
          return context.commit(() => {
            // Audio part first so playback is ready the moment the meeting opens.
            storedAudio = this.audio.addImportedPart(
              meetingId,
              filePath,
              Math.round(result.audioSeconds * 1000)
            )
            if (!storedAudio) throw new Error('Could not save that recording for local playback.')
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
          })
        }
      )
    } catch (err) {
      if (storedAudio) this.audio.deleteFor(meetingId)
      return err instanceof Error && err.name === 'AbortError'
        ? { canceled: true }
        : { error: err instanceof Error ? err.message : String(err) }
    }
  }

  async retranscribe(meetingId: string): Promise<RetranscribeResult> {
    if (this.isBusy) return { error: 'Another import is still running. Please wait or cancel it.' }
    if (!this.platformTranscriber && !existsSync(this.enginePath)) {
      return { error: 'The transcription engine is not available on this platform yet.' }
    }
    const record = this.meetings.get(meetingId)
    if (!record) return { error: 'Meeting not found.' }
    const parts = this.audio.listPaths(meetingId)
    if (parts.length === 0) {
      return { error: 'This meeting has no saved recording to re-transcribe.' }
    }

    try {
      return await this.jobs.run(
        { kind: 'retranscribe', meetingId, label: record.title || 'Recording' },
        async (context) => {
          this.retrySource = { jobId: this.jobs.snapshot()!.jobId, meetingId }
          const all: TranscriptSegment[] = []
          let echoSuppressed = 0
          for (const [index, part] of parts.entries()) {
            checkImportCanceled(context.signal)
            context.progress('starting', undefined, index + 1, parts.length)
            let result: BatchTranscription
            try {
              result = await this.transcribe(
                part.path,
                this.toBatchProgress(context, index + 1, parts.length),
                { signal: context.signal }
              )
            } catch (error) {
              checkImportCanceled(context.signal)
              throw new Error(
                `Could not transcribe part ${index + 1} of ${parts.length}. Your current transcript is unchanged. ${error instanceof Error ? error.message : String(error)}`
              )
            }
            checkImportCanceled(context.signal)
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
            throw new Error(
              'Re-transcription produced no speech. Your current transcript is unchanged.'
            )
          }
          all.sort((a, b) => (a.absoluteStartMs ?? a.startMs) - (b.absoluteStartMs ?? b.startMs))
          return context.commit(() => {
            this.meetings.upsert({ id: meetingId, segments: all, echoSuppressed })
            return { meetingId, segmentCount: all.length }
          })
        }
      )
    } catch (err) {
      return err instanceof Error && err.name === 'AbortError'
        ? { canceled: true }
        : { error: err instanceof Error ? err.message : String(err) }
    }
  }

  private transcribe(
    filePath: string,
    onProgress: (progress: BatchProgress) => void,
    options: BatchOptions
  ): Promise<BatchTranscription> {
    return this.platformTranscriber
      ? this.platformTranscriber(filePath, onProgress, options)
      : transcribeFileToSegments(this.enginePath, filePath, onProgress, options)
  }
}
