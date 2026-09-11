import type { RecordingStartRequest, RecordingApi } from '../../../shared/recording-api'
import type { MeetingsApi } from '../../../shared/meetings-api'

/** Keep document preparation testable; capture itself remains in MeetingView. */
export async function prepareRecordingMeeting(
  request: RecordingStartRequest,
  meetings: Pick<MeetingsApi, 'list' | 'upsert'>,
  recording: Pick<RecordingApi, 'attach' | 'cancel'>,
  id: () => string
): Promise<string | null> {
  try {
    const event = request.event
    const existing = event.eventId
      ? (await meetings.list()).find((m) => m.calendarEventId === event.eventId && !m.trashedAt)
      : undefined
    const meetingId = existing?.id ?? id()
    if (!(await recording.attach(request.id, meetingId))) return null
    if (!existing) {
      await meetings.upsert({
        id: meetingId,
        title: event.subject.trim(),
        createdAt: new Date().toISOString(),
        rawNotesMarkdown: '',
        segments: [],
        echoSuppressed: 0,
        ...(event.eventId ? { calendarEventId: event.eventId } : {})
      })
    }
    return meetingId
  } catch (error) {
    await recording.cancel(request.id)
    throw error
  }
}
