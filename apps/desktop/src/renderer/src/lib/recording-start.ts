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
    const records = event.eventId ? (await meetings.list()).filter((m) => !m.trashedAt) : []
    const legacy = event.legacyEventId
      ? records.filter((m) => m.calendarEventId === event.legacyEventId)
      : []
    const existing =
      records.find((m) => m.calendarEventId === event.eventId) ??
      (legacy.length === 1 ? legacy[0] : undefined)
    const meetingId = existing?.id ?? id()
    if (!(await recording.attach(request.id, meetingId))) return null
    if (existing && existing.calendarEventId !== event.eventId) {
      await meetings.upsert({ ...existing, calendarEventId: event.eventId })
    }
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
