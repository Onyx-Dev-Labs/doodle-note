import type { SourceScope } from '@repo/meetings-store/source-contract'
import type { CalendarInvitee, CalendarInvitees, CalendarProvider } from '../shared/calendar-api'

export interface EventSnapshotV1 {
  id: string
  eventId: string
  accountId: string
  calendarId: string
  provider: CalendarProvider
  providerEventId: string
  occurrenceId: string
  observedAt: string
  eventDigest: string
  subject: string
  startIso: string
  endIso: string
  calendarLastSyncIso: string | null
  calendarWasStale: boolean
  roster: CalendarInvitees['roster']
  invitees: CalendarInvitee[]
}
export interface ContextEntityV1 {
  id: string
  accountId: string
  displayName: string
  createdAt: string
}
export type ContextTarget =
  | { kind: 'event'; accountId: string; eventId: string }
  | { kind: 'person'; personId: string }
  | { kind: 'company'; companyId: string }
export type ContextEdit =
  | { op: 'bind-invitee'; snapshotId: string; inviteeId: string; personId: string | null }
  | { op: 'exclude-person'; eventId: string; identifierKey: string; personId: string }
  | { op: 'set-rule'; accountId: string; identifierKey: string; personId: string | null }
  | { op: 'set-company'; personId: string; companyId: string | null }
  | {
      op: 'link-meeting'
      meetingId: string
      target: ContextTarget
      snapshotId: string | null
      sourceRevisionAtLink: string
      originalHashAtLink: string
      companyIdAtLink: string | null
    }
  | { op: 'unlink-meeting'; linkChangeId: string }
  | { op: 'set-self'; snapshotId: string; inviteeId: string; isSelf: boolean }
  | { op: 'rename'; entity: 'person' | 'company'; id: string; displayName: string }
export interface ContextChangeV1 {
  id: string
  revision: number
  at: string
  supersedes: string | null
  provenance: 'user' | 'accepted-start' | 'confirmed-rule'
  payload: ContextEdit
}
export interface ContextFileV1 {
  version: 1
  scope: SourceScope
  revision: number
  snapshots: Record<string, EventSnapshotV1>
  people: Record<string, ContextEntityV1>
  companies: Record<string, ContextEntityV1>
  changes: ContextChangeV1[]
}
export interface ContextView {
  bindings: Record<string, Record<string, { personId: string | null; changeId: string }>>
  self: Record<string, Record<string, boolean>>
  companies: Record<string, string | null>
  names: Record<string, string>
  links: Array<ContextChangeV1 & { payload: Extract<ContextEdit, { op: 'link-meeting' }> }>
}
