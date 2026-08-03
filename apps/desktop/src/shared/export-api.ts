/**
 * Meeting export: Markdown (notes + transcript, one portable file) or a
 * print-styled PDF of the same content. Meetily paywalls these; we don't.
 */

/** renderer → main (invoke): export a meeting via a save dialog. */
export const EXPORT_MEETING_CHANNEL = 'export:meeting'

export type ExportFormat = 'md' | 'pdf'

export interface ExportResult {
  /** Where the file landed. */
  path?: string
  /** User dismissed the save dialog. */
  canceled?: boolean
  error?: string
}

/** API surface exposed on `window.exporter` by the preload script. */
export interface ExporterApi {
  exportMeeting(meetingId: string, format: ExportFormat): Promise<ExportResult>
}
