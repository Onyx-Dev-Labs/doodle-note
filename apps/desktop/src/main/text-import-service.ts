import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { MeetingFileStore } from '@repo/meetings-store'
import { libraryIpc } from './library-ipc'
import {
  TEXT_IMPORT_CANCEL,
  TEXT_IMPORT_COMMIT,
  TEXT_IMPORT_PREVIEW,
  type TextImportPreview
} from '../shared/text-import-api'
import { MAX_TEXT_IMPORT_BYTES, parseTextTranscript } from './text-import-logic'

/** Preview snapshots live only in main memory. The renderer never supplies a path or transcript to commit. */
export class TextImportService {
  private pending: { owner: number; preview: TextImportPreview } | null = null
  private picking = false
  constructor(private readonly meetings: MeetingFileStore) {}

  registerIpc(): void {
    libraryIpc.handle(TEXT_IMPORT_PREVIEW, (event) => this.preview(event.sender.id))
    libraryIpc.handle(TEXT_IMPORT_COMMIT, (event, token: unknown) =>
      this.commit(event.sender.id, token)
    )
    libraryIpc.handle(TEXT_IMPORT_CANCEL, (event, token: unknown) => {
      if (this.pending?.owner === event.sender.id && this.pending.preview.token === token)
        this.pending = null
    })
  }

  async preview(
    owner: number
  ): Promise<{ preview?: TextImportPreview; canceled?: boolean; error?: string }> {
    if (this.picking) return { error: 'A transcript picker is already open.' }
    this.picking = true
    this.pending = null
    try {
      const result = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0]!, {
        title: 'Import transcript',
        filters: [{ name: 'Plain text transcript', extensions: ['txt'] }],
        properties: ['openFile']
      })
      const path = result.filePaths[0]
      if (result.canceled || !path) return { canceled: true }
      if (extname(path).toLowerCase() !== '.txt')
        return { error: 'Choose a plain-text transcript (.txt).' }
      const file = await open(path, 'r')
      let bytes: Buffer
      try {
        const stat = await file.stat()
        if (!stat.isFile()) return { error: 'Choose a regular .txt file.' }
        if (stat.size > MAX_TEXT_IMPORT_BYTES)
          return { error: 'That transcript is too large (2 MB max).' }
        // Bound the read even when an external process grows the file after stat.
        const buffer = Buffer.alloc(MAX_TEXT_IMPORT_BYTES + 1)
        let count = 0
        while (count < buffer.length) {
          const read = await file.read(buffer, count, buffer.length - count, count)
          if (read.bytesRead === 0) break
          count += read.bytesRead
        }
        bytes = buffer.subarray(0, count)
      } finally {
        await file.close()
      }
      const preview = {
        token: randomUUID(),
        title: basename(path, extname(path)),
        fileName: basename(path),
        segments: parseTextTranscript(bytes)
      }
      this.pending = { owner, preview }
      return { preview }
    } catch (error) {
      return {
        error:
          error instanceof Error && !('code' in error)
            ? error.message
            : 'Could not read that transcript. Check file access and try again.'
      }
    } finally {
      this.picking = false
    }
  }

  commit(owner: number, token: unknown): { meetingId?: string; error?: string } {
    const pending = this.pending
    if (
      !pending ||
      pending.owner !== owner ||
      typeof token !== 'string' ||
      pending.preview.token !== token
    ) {
      return { error: 'This preview has expired. Choose the transcript again.' }
    }
    try {
      const meetingId = randomUUID()
      this.meetings.upsert({
        id: meetingId,
        title: pending.preview.title,
        createdAt: new Date().toISOString(),
        rawNotesMarkdown: '',
        segments: pending.preview.segments,
        echoSuppressed: 0
      })
      this.pending = null
      return { meetingId }
    } catch {
      return { error: 'Could not save that transcript. Check the library folder and try again.' }
    }
  }
}
