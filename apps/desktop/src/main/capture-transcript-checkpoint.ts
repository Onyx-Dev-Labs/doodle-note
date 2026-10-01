import type { MeetingFileStore, MeetingRecord } from '@repo/meetings-store'
import type { TranscriptSegment } from '../shared/engine-events'

/** Late engine finalization must never undo an explicit discard or Trash action. */
export function persistCaptureTranscript(
  meetings: Pick<MeetingFileStore, 'get' | 'upsert'>,
  meetingId: string,
  base: MeetingRecord['segments'],
  baseEcho: number,
  segments: TranscriptSegment[],
  ended: boolean
): void {
  const current = meetings.get(meetingId)
  if (!current || current.trashedAt) return
  meetings.upsert({
    id: meetingId,
    segments: [...base, ...segments.filter((segment) => !segment.echo)],
    echoSuppressed: baseEcho + segments.filter((segment) => segment.echo).length,
    ...(ended ? { endedAt: new Date().toISOString() } : {})
  })
}
