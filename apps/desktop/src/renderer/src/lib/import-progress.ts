import type { ImportProgress } from '../../../shared/import-api'

export function isImportActive(job: ImportProgress): boolean {
  return !['completed', 'failed', 'canceled'].includes(job.stage)
}

/** A slow initial IPC snapshot must not replace a newer event. */
export function newerImportState(
  current: ImportProgress | null,
  next: ImportProgress | null
): ImportProgress | null {
  if (!next) return current
  return !current || next.revision > current.revision ? next : current
}

export function importProgressText(job: ImportProgress): string {
  switch (job.stage) {
    case 'starting':
      return 'Preparing transcription…'
    case 'downloading_model':
      return typeof job.progress === 'number'
        ? `Downloading speech model: ${Math.round(job.progress * 100)}%`
        : 'Downloading speech model…'
    case 'transcribing':
      return 'Transcribing recording…'
    case 'finishing':
      return 'Saving transcript…'
    case 'canceling':
      return 'Canceling import…'
    case 'completed':
      return 'Transcript ready'
    case 'failed':
      return 'Import needs attention'
    case 'canceled':
      return 'Import canceled'
  }
}
