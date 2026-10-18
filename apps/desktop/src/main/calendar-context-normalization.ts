import type { CalendarInvitee, CalendarInvitees, CalendarProvider } from '../shared/calendar-api'

const MAX_ENTRIES = 256
const MAX_BYTES = 64 * 1024
const controls = /[\u0000-\u001f\u007f-\u009f]/u
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const unknownRoster = (): CalendarInvitees => ({
  version: 1,
  roster: { state: 'unknown', omittedCount: null },
  entries: []
})

/** Only already authenticated ownership evidence may be supplied here. Calendar self is not it. */
export interface CalendarSelfEvidence {
  authenticatedAddresses: readonly string[]
}

/** Provider data is display/provenance only. Names never produce identity keys. */
export function normalizeCalendarInvitees(
  provider: CalendarProvider,
  input: unknown,
  evidence?: CalendarSelfEvidence
): CalendarInvitees {
  const raw = object(input)
  let partial = false
  const display = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const chars = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim())
    if (chars.length > 256) partial = true
    return chars.slice(0, 256).join('') || null
  }
  const identifier = (value: unknown): string | null => {
    if (value === undefined || value === null) return null
    if (
      typeof value !== 'string' ||
      controls.test(value) ||
      Array.from(value.trim()).length > 512
    ) {
      partial = true
      return null
    }
    return value.trim() || null
  }
  const entry = (value: unknown, organizer: boolean, position: number): CalendarInvitee => {
    const row = object(value)
    const addressObject = provider === 'microsoft' ? object(row.emailAddress) : row
    const address = identifier(provider === 'google' ? row.email : addressObject.address)
    const person = provider === 'google' ? identifier(row.id) : null
    const resource = provider === 'google' ? row.resource === true : row.type === 'resource'
    const roles: CalendarInvitee['roles'] = organizer ? ['organizer'] : ['attendee']
    if (!organizer && row.organizer === true && provider === 'google') roles.push('organizer')
    if (resource) roles.push('resource')
    const knownAddresses =
      evidence?.authenticatedAddresses.filter((a) => !!a && !controls.test(a)) ?? []
    const self =
      address && knownAddresses.length
        ? knownAddresses.includes(address)
          ? 'confirmed-self'
          : 'other'
        : 'unknown'
    return {
      id: `${organizer ? 'organizer' : 'invitee'}:${position}`,
      identifierKey: resource
        ? null
        : person
          ? JSON.stringify([provider, 'person', person])
          : address
            ? JSON.stringify([provider, 'address', address])
            : null,
      displayName: display(provider === 'google' ? row.displayName : addressObject.name),
      address,
      providerPersonId: person,
      roles,
      self,
      selfEvidence: self === 'unknown' ? 'unknown' : 'authenticated-address'
    }
  }
  const attendees = Array.isArray(raw.attendees) ? raw.attendees : []
  if (raw.attendees !== undefined && !Array.isArray(raw.attendees)) partial = true
  // Inspect identifiers throughout the admitted roster; overflow never becomes an absent attendee.
  let entries = attendees.slice(0, MAX_ENTRIES).map((a, i) => entry(a, false, i))
  let omitted = Math.max(0, attendees.length - entries.length)
  const counts = new Map<string, number>()
  for (const row of entries) {
    for (const key of [
      row.address && `address:${row.address}`,
      row.providerPersonId && `person:${row.providerPersonId}`
    ]) {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  for (const row of entries) {
    if (
      (row.address && counts.get(`address:${row.address}`)! > 1) ||
      (row.providerPersonId && counts.get(`person:${row.providerPersonId}`)! > 1)
    )
      row.identifierKey = null
  }
  if (raw.organizer !== undefined && raw.organizer !== null) {
    const organizer = entry(raw.organizer, true, 0)
    const match =
      organizer.identifierKey &&
      entries.find((row) => row.identifierKey === organizer.identifierKey)
    if (match) {
      match.roles = [...new Set([...match.roles, ...organizer.roles])]
    } else {
      const conflicts = entries.filter(
        (row) =>
          (row.address && row.address === organizer.address) ||
          (row.providerPersonId && row.providerPersonId === organizer.providerPersonId)
      )
      if (conflicts.length) {
        organizer.identifierKey = null
        for (const row of conflicts) row.identifierKey = null
      }
      entries.push(organizer)
    }
  }
  if (entries.length > MAX_ENTRIES) {
    omitted += entries.length - MAX_ENTRIES
    entries = entries.slice(0, MAX_ENTRIES)
  }
  if (attendees.length > MAX_ENTRIES) for (const row of entries) row.identifierKey = null
  const providerOmitted = provider === 'google' && raw.attendeesOmitted === true
  const result: CalendarInvitees = {
    version: 1,
    roster: {
      state:
        providerOmitted || omitted || partial
          ? 'partial'
          : Array.isArray(raw.attendees)
            ? 'complete'
            : 'unknown',
      omittedCount: providerOmitted || !Array.isArray(raw.attendees) ? null : omitted
    },
    entries
  }
  // Bound in linear time; repeated stringify of the shrinking roster blocks capture.
  let bytes = Buffer.byteLength(JSON.stringify(result))
  while (bytes > MAX_BYTES - 32 && result.entries.length) {
    const removed = result.entries.pop()!
    bytes -= Buffer.byteLength(JSON.stringify(removed)) + 1
    result.roster.state = 'partial'
    if (result.roster.omittedCount !== null) result.roster.omittedCount++
  }
  return result
}

/** Validate known fields at the cache boundary; never repair or overwrite the cached value. */
export function isCalendarInvitees(value: unknown): value is CalendarInvitees {
  const raw = object(value)
  const roster = object(raw.roster)
  const nullable = (v: unknown, limit: number): boolean =>
    v === null || (typeof v === 'string' && Array.from(v).length <= limit && !controls.test(v))
  if (
    raw.version !== 1 ||
    !['complete', 'partial', 'unknown'].includes(String(roster.state)) ||
    !(
      roster.omittedCount === null ||
      (Number.isSafeInteger(roster.omittedCount) && Number(roster.omittedCount) >= 0)
    ) ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > MAX_ENTRIES
  )
    return false
  const ids = new Set<string>()
  for (const value of raw.entries) {
    const row = object(value)
    if (
      typeof row.id !== 'string' ||
      !/^(invitee|organizer):\d{1,3}$/.test(row.id) ||
      ids.has(row.id) ||
      !nullable(row.displayName, 256) ||
      !nullable(row.address, 512) ||
      !nullable(row.providerPersonId, 512) ||
      !nullable(row.identifierKey, 1100) ||
      !Array.isArray(row.roles) ||
      !row.roles.length ||
      row.roles.length > 3 ||
      new Set(row.roles).size !== row.roles.length ||
      row.roles.some((role) => !['attendee', 'organizer', 'resource'].includes(role)) ||
      !['confirmed-self', 'other', 'unknown'].includes(String(row.self)) ||
      !['authenticated-address', 'owned-calendar-marker', 'unknown'].includes(
        String(row.selfEvidence)
      ) ||
      (row.self === 'unknown') !== (row.selfEvidence === 'unknown') ||
      (row.roles.includes('resource') && row.identifierKey !== null)
    )
      return false
    if (row.identifierKey !== null) {
      try {
        const key = JSON.parse(row.identifierKey as string)
        if (
          !Array.isArray(key) ||
          key.length !== 3 ||
          !['google', 'microsoft'].includes(key[0]) ||
          !['person', 'address'].includes(key[1]) ||
          !key[2] ||
          key[2] !== (key[1] === 'person' ? row.providerPersonId : row.address) ||
          JSON.stringify(key) !== row.identifierKey
        )
          return false
      } catch {
        return false
      }
    }
    ids.add(row.id)
  }
  return Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES
}

export function readCalendarInvitees(value: unknown): CalendarInvitees {
  return isCalendarInvitees(value) ? structuredClone(value) : unknownRoster()
}
