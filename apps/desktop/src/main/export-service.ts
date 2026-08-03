import { writeFileSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { MeetingFileStore } from '@repo/meetings-store'
import {
  EXPORT_MEETING_CHANNEL,
  type ExportFormat,
  type ExportResult
} from '../shared/export-api'
import { buildExportHtml, buildExportMarkdown } from './export-logic'

/**
 * Meeting export. Markdown is the portable source of truth (notes +
 * timestamped transcript in one file); PDF renders the same content with
 * brand styling through a hidden window's printToPDF — no native deps.
 */
export class ExportService {
  constructor(private readonly meetings: MeetingFileStore) {}

  registerIpc(): void {
    ipcMain.handle(EXPORT_MEETING_CHANNEL, (_event, meetingId: unknown, format: unknown) =>
      this.exportMeeting(
        String(meetingId ?? ''),
        format === 'pdf' ? 'pdf' : 'md'
      )
    )
  }

  async exportMeeting(
    meetingId: string,
    format: ExportFormat,
    /** Test hook: bypasses the save dialog. */
    targetPath?: string
  ): Promise<ExportResult> {
    const record = this.meetings.get(meetingId)
    if (!record) return { error: 'Meeting not found.' }

    let path = targetPath
    if (!path) {
      const safeTitle = (record.title.trim() || 'meeting')
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 80)
      const picked = await dialog.showSaveDialog(BrowserWindow.getAllWindows()[0]!, {
        title: format === 'pdf' ? 'Export PDF' : 'Export Markdown',
        defaultPath: `${app.getPath('documents')}/${safeTitle}.${format}`,
        filters:
          format === 'pdf'
            ? [{ name: 'PDF', extensions: ['pdf'] }]
            : [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (picked.canceled || !picked.filePath) return { canceled: true }
      path = picked.filePath
    }

    try {
      const markdown = buildExportMarkdown(record)
      if (format === 'md') {
        writeFileSync(path, markdown)
      } else {
        writeFileSync(path, await renderPdf(buildExportHtml(record, markdown)))
      }
      return { path }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** Render HTML to PDF bytes via a hidden window. */
async function renderPdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false }
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true
    })
  } finally {
    window.destroy()
  }
}
