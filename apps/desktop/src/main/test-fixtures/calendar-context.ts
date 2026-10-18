import { randomUUID } from 'node:crypto'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import type { ContextFileV1 } from '../calendar-context-types'
import { observationDigest } from '../calendar-context-validation'
import { normalizeCalendarInvitees } from '../calendar-context-normalization'
import { scopeCalendar, scopeEvent } from '../calendar-identity'

/** Dense legitimate known records, including event links; not a padded JSON shortcut. */
export function denseCalendarContext(scope: SourceScope, count: number): ContextFileV1 {
  const identity = { provider: 'google' as const, subject: 'synthetic-dense-account' }
  const calendar = scopeCalendar(identity, {
    id: 'calendar',
    name: 'Synthetic',
    colorHex: '#000',
    isDefault: true,
    canEdit: false
  })
  const data: ContextFileV1 = {
    version: 1,
    scope,
    revision: count * 2,
    snapshots: {},
    people: {},
    companies: {},
    changes: []
  }
  for (let i = 0; i < count; i++) {
    const event = scopeEvent(identity, calendar, {
      id: `occurrence-${i}`,
      subject: `Synthetic ${i}`,
      startIso: '2026-10-18T20:00:00.000Z',
      endIso: '2026-10-18T21:00:00.000Z',
      isAllDay: false,
      isOnlineMeeting: false,
      hasParticipants: true,
      calendarId: calendar.id
    })
    const roster = normalizeCalendarInvitees('google', {
      attendees: [{ email: 'alex@example.test', displayName: 'Alex' }]
    })
    const fields = {
      eventId: event.id,
      accountId: event.accountId!,
      calendarId: event.calendarId,
      provider: event.provider!,
      providerEventId: event.providerEventId!,
      occurrenceId: event.occurrenceId!,
      subject: event.subject,
      startIso: event.startIso,
      endIso: event.endIso,
      roster: roster.roster,
      invitees: roster.entries
    }
    const snapshot = {
      ...fields,
      id: randomUUID(),
      observedAt: '2026-10-18T21:00:00.000Z',
      eventDigest: observationDigest(fields),
      calendarLastSyncIso: null,
      calendarWasStale: false
    }
    data.snapshots[snapshot.id] = snapshot
    data.changes.push({
      id: randomUUID(),
      revision: i * 2 + 2,
      at: '2026-10-18T21:00:00.000Z',
      supersedes: null,
      provenance: 'accepted-start',
      payload: {
        op: 'link-meeting',
        meetingId: `meeting-${i}`,
        target: { kind: 'event', accountId: snapshot.accountId, eventId: snapshot.eventId },
        snapshotId: snapshot.id,
        sourceRevisionAtLink: 'a'.repeat(64),
        originalHashAtLink: 'b'.repeat(64),
        companyIdAtLink: null
      }
    })
  }
  return data
}
