/**
 * Audio import & re-transcription: renderer-facing API surface.
 *
 * Import: pick an audio file → batch transcription (own engine process, the
 * live session is never disturbed) → a regular meeting with transcript and
 * playback. Re-transcribe: re-run a meeting's saved recordings through the
 * current model, rebuilding the transcript in place (notes are kept).
 */

/** renderer → main (invoke): pick a file and import it. */
export const IMPORT_AUDIO_CHANNEL = 'import:audio'
/** renderer → main (invoke): rebuild a meeting's transcript from saved audio. */
export const IMPORT_RETRANSCRIBE_CHANNEL = 'import:retranscribe'
/** main → renderer: progress while an import/re-transcription runs. */
export const IMPORT_PROGRESS_CHANNEL = 'import:progress'
export const IMPORT_STATUS_CHANNEL = 'import:status'
export const IMPORT_CANCEL_CHANNEL = 'import:cancel'
export const IMPORT_RETRY_CHANNEL = 'import:retry'

export interface ImportResult {
  meetingId?: string
  /** User dismissed the file picker. */
  canceled?: boolean
  error?: string
}

export interface RetranscribeResult {
  meetingId?: string
  segmentCount?: number
  canceled?: boolean
  error?: string
}

export interface ImportProgress {
  jobId: string
  revision: number
  label: string
  error?: string
  part?: number
  parts?: number
  kind: 'import' | 'retranscribe'
  meetingId: string
  /** downloading_model carries progress 0..1; the rest are indeterminate. */
  stage:
    | 'starting'
    | 'downloading_model'
    | 'transcribing'
    | 'finishing'
    | 'canceling'
    | 'completed'
    | 'failed'
    | 'canceled'
  progress?: number
}

/** API surface exposed on `window.importer` by the preload script. */
export interface ImporterApi {
  getStatus(): Promise<ImportProgress | null>
  cancel(jobId: string): Promise<ImportProgress | null>
  retry(jobId: string): Promise<ImportResult>
  importAudio(): Promise<ImportResult>
  retranscribe(meetingId: string): Promise<RetranscribeResult>
  onProgress(cb: (progress: ImportProgress) => void): () => void
}
