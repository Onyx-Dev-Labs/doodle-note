import { createHash } from 'node:crypto'
import type { AccountInfo } from '@azure/msal-node'
import type { CalendarEvent, CalendarInfo, CalendarProvider } from '../shared/calendar-api'

export interface CalendarIdentity {
  provider: CalendarProvider
  /** Main-process only. Never use email as an authorization or ownership key. */
  subject: string
}

function key(kind: string, parts: string[]): string {
  return `cal2:${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`
}

export function accountKey(identity: CalendarIdentity): string {
  if (!identity.subject || !['microsoft', 'google'].includes(identity.provider)) {
    throw new Error('Calendar account identity is unavailable. Reconnect the account.')
  }
  return key('account', [identity.provider, identity.subject])
}

export function microsoftIdentity(account: AccountInfo, clientId: string): CalendarIdentity {
  if (
    !account.homeAccountId ||
    !account.tenantId ||
    !account.localAccountId ||
    !account.environment
  ) {
    throw new Error('Microsoft account identity is unavailable. Reconnect the account.')
  }
  return {
    provider: 'microsoft',
    subject: JSON.stringify([
      account.environment.toLowerCase(),
      clientId,
      account.homeAccountId,
      account.tenantId,
      account.localAccountId
    ])
  }
}

export function scopeCalendar(identity: CalendarIdentity, calendar: CalendarInfo): CalendarInfo {
  const accountId = accountKey(identity)
  const raw =
    calendar.providerCalendarId ??
    (identity.provider === 'google' ? calendar.id.replace(/^g:/, '') : calendar.id)
  return {
    ...calendar,
    id: key('calendar', [accountId, raw]),
    accountId,
    provider: identity.provider,
    providerCalendarId: raw
  }
}

export function scopeEvent(
  identity: CalendarIdentity,
  calendar: CalendarInfo,
  event: CalendarEvent
): CalendarEvent {
  const accountId = accountKey(identity)
  if (
    calendar.accountId !== accountId ||
    calendar.provider !== identity.provider ||
    !calendar.providerCalendarId
  ) {
    throw new Error('Calendar source does not belong to this account.')
  }
  const raw =
    event.providerEventId ??
    (identity.provider === 'google' ? event.id.replace(/^g:/, '') : event.id)
  // Providers return occurrence IDs. Never use the mutable displayed start time.
  const occurrence = event.occurrenceId ?? raw
  return {
    ...event,
    id: key('event', [accountId, calendar.providerCalendarId, occurrence]),
    accountId,
    provider: identity.provider,
    providerEventId: raw,
    occurrenceId: occurrence,
    calendarId: calendar.id
  }
}
