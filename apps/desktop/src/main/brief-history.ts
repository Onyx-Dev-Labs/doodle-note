import type { ContextFileV1, ContextView, EventSnapshotV1 } from './calendar-context-types'
import type { BriefPerson } from '../shared/briefs-api'

/** Concrete confirmed bindings only. Names, addresses and today's roster are never historical proof. */
export function briefPeople(
  data: ContextFileV1,
  view: ContextView,
  snapshot: EventSnapshotV1
): BriefPerson[] {
  return snapshot.invitees.map((invitee) => {
    const binding = view.bindings[snapshot.id]?.[invitee.id]
    const person = binding?.personId ? data.people[binding.personId] : undefined
    const companyId = person ? (view.companies[person.id] ?? null) : null
    const company = companyId ? data.companies[companyId] : undefined
    const change = binding ? data.changes.find((c) => c.id === binding.changeId) : undefined
    return {
      ...invitee,
      personId: person?.id ?? null,
      personName: person ? (view.names[person.id] ?? person.displayName) : null,
      companyId,
      companyName: company ? (view.names[company.id] ?? company.displayName) : null,
      isSelf:
        view.self[snapshot.id]?.[invitee.id] ??
        (invitee.self === 'confirmed-self' ? true : invitee.self === 'other' ? false : null),
      provenance:
        person && change ? (change.provenance === 'user' ? 'user' : 'confirmed-rule') : 'unassigned'
    }
  })
}
export function briefLinks(
  data: ContextFileV1,
  view: ContextView,
  snapshot: EventSnapshotV1,
  includeCompany: boolean
): ContextView['links'] {
  const people = briefPeople(data, view, snapshot).filter(
    (p) => p.personId && p.isSelf !== true && !p.roles.includes('resource')
  )
  const ids = new Set(people.map((p) => p.personId))
  const companies = new Set(people.flatMap((p) => (p.companyId ? [p.companyId] : [])))
  return view.links.filter((change) => {
    const link = change.payload
    const target = link.target
    if (target.kind === 'person') {
      return (
        data.people[target.personId]?.accountId === snapshot.accountId &&
        (ids.has(target.personId) ||
          (includeCompany && link.companyIdAtLink !== null && companies.has(link.companyIdAtLink)))
      )
    }
    if (target.kind === 'company')
      return (
        includeCompany &&
        data.companies[target.companyId]?.accountId === snapshot.accountId &&
        companies.has(target.companyId)
      )
    if (target.accountId !== snapshot.accountId) return false
    if (target.eventId === snapshot.eventId) return true
    // Existing snapshotless notes cannot gain today's roster by calendarEventId alone.
    const old = link.snapshotId ? data.snapshots[link.snapshotId] : undefined
    return (
      !!old &&
      briefPeople(data, view, old).some(
        (p) => ids.has(p.personId) && p.isSelf !== true && !p.roles.includes('resource')
      )
    )
  })
}
