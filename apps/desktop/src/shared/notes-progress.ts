import type { EnhanceProgressEvent } from './notes-api'

export function notesProgressLabel(
  progress: Pick<EnhanceProgressEvent, 'phase' | 'current' | 'total'>
): string {
  switch (progress.phase) {
    case 'reading':
      return progress.total
        ? `Reading transcript · part ${progress.current} of ${progress.total}`
        : 'Reading transcript'
    case 'writing':
      return 'Writing notes'
    case 'condensing':
      return `Condensing part ${progress.current} of ${progress.total}`
    case 'canceling':
      return 'Stopping model'
    default:
      return 'Preparing model'
  }
}
