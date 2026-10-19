import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setImmediate as yieldMain } from 'node:timers/promises'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import { sameScope } from '@repo/meetings-store/sources'
import { isCalendarInvitees } from './calendar-context-normalization'
import type {
  ContextChangeV1,
  ContextEntityV1,
  ContextEdit,
  ContextFileV1,
  ContextTarget,
  ContextView,
  EventSnapshotV1
} from './calendar-context-types'

export const contextObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
export const contextUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
export const contextText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && Array.from(v).length <= max && !/\p{Cc}/u.test(v)
const key = (v: unknown, kind: string): v is string =>
  typeof v === 'string' && new RegExp(`^cal2:${kind}:[a-f0-9]{64}$`).test(v)
export const contextDate = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const identifier = (v: unknown): v is string => {
  if (!contextText(v, 1100)) return false
  try {
    const a = JSON.parse(v)
    return (
      Array.isArray(a) &&
      a.length === 3 &&
      ['google', 'microsoft'].includes(a[0]) &&
      ['person', 'address'].includes(a[1]) &&
      contextText(a[2], 512) &&
      !!a[2] &&
      JSON.stringify(a) === v
    )
  } catch {
    return false
  }
}
const fail = (message: string): never => {
  throw new Error(`Calendar context ${message}. Existing data was preserved.`)
}
function required<T>(value: T | undefined, kind: string): T {
  if (!value) fail(`${kind} reference is invalid`)
  return value!
}
function reference<T>(map: Record<string, T>, id: string, kind: string): T {
  return required(Object.hasOwn(map, id) ? map[id] : undefined, kind)
}
function sameAccount(a: string, b: string): void {
  if (a !== b) fail('account reference is invalid')
}
type ReferenceIndex = {
  events: Set<string>
  identifiers: Set<string>
  eventIdentifiers: Set<string>
}
const referenceKey = (...parts: string[]): string => JSON.stringify(parts)
const emptyIndex = (): ReferenceIndex => ({
  events: new Set(),
  identifiers: new Set(),
  eventIdentifiers: new Set()
})
function indexSnapshot(index: ReferenceIndex, snapshot: EventSnapshotV1): void {
  index.events.add(referenceKey(snapshot.accountId, snapshot.eventId))
  for (const invitee of snapshot.invitees)
    if (invitee.identifierKey) {
      index.identifiers.add(referenceKey(snapshot.accountId, invitee.identifierKey))
      index.eventIdentifiers.add(
        referenceKey(snapshot.accountId, snapshot.eventId, invitee.identifierKey)
      )
    }
}
function referenceIndex(data: ContextFileV1): ReferenceIndex {
  const index = emptyIndex()
  for (const snapshot of Object.values(data.snapshots)) indexSnapshot(index, snapshot)
  return index
}
export function targetAccount(
  data: ContextFileV1,
  target: ContextTarget,
  index?: ReferenceIndex
): string {
  if (!contextObject(target)) return fail('target reference is invalid')
  if (target.kind === 'person') return reference(data.people, target.personId, 'person').accountId
  if (target.kind === 'company')
    return reference(data.companies, target.companyId, 'company').accountId
  if (
    target.kind !== 'event' ||
    !key(target.accountId, 'account') ||
    !key(target.eventId, 'event') ||
    !(index ?? referenceIndex(data)).events.has(referenceKey(target.accountId, target.eventId))
  )
    return fail('event reference is invalid')
  return target.accountId
}

/** Hash only v1 observation fields; portable extensions never change the known observation. */
export function observationDigest(
  s: Omit<
    EventSnapshotV1,
    'id' | 'eventDigest' | 'observedAt' | 'calendarLastSyncIso' | 'calendarWasStale'
  >
): string {
  const known = {
    eventId: s.eventId,
    accountId: s.accountId,
    calendarId: s.calendarId,
    provider: s.provider,
    providerEventId: s.providerEventId,
    occurrenceId: s.occurrenceId,
    subject: s.subject,
    startIso: s.startIso,
    endIso: s.endIso,
    roster: { state: s.roster.state, omittedCount: s.roster.omittedCount },
    invitees: s.invitees.map((i) => ({
      id: i.id,
      identifierKey: i.identifierKey,
      displayName: i.displayName,
      address: i.address,
      providerPersonId: i.providerPersonId,
      roles: i.roles,
      self: i.self,
      selfEvidence: i.selfEvidence
    }))
  }
  return createHash('sha256').update(JSON.stringify(known)).digest('hex')
}

/** All known fields and references are validated; unknown JSON is retained by the store. */
export function validateContextEdit(
  data: ContextFileV1,
  edit: ContextEdit,
  previous = new Map(data.changes.map((c) => [c.id, c])),
  index = referenceIndex(data)
): void {
  if (!contextObject(edit)) fail('change is invalid')
  const person = (id: string): ContextEntityV1 => reference(data.people, id, 'person')
  const company = (id: string): ContextEntityV1 => reference(data.companies, id, 'company')
  switch (edit.op) {
    case 'bind-invitee':
    case 'set-self': {
      const snapshot = reference(data.snapshots, edit.snapshotId, 'snapshot')
      const invitee = required(
        snapshot.invitees.find((i) => i.id === edit.inviteeId),
        'invitee'
      )
      if (edit.op === 'set-self') {
        if (typeof edit.isSelf !== 'boolean') fail('self correction is invalid')
      } else if (edit.personId !== null) {
        if (invitee.roles.includes('resource')) fail('resource cannot be a person')
        sameAccount(person(edit.personId).accountId, snapshot.accountId)
      }
      break
    }
    case 'exclude-person': {
      if (!key(edit.eventId, 'event') || !identifier(edit.identifierKey))
        fail('exclusion is invalid')
      const account = person(edit.personId).accountId
      if (!index.eventIdentifiers.has(referenceKey(account, edit.eventId, edit.identifierKey)))
        fail('event reference is invalid')
      break
    }
    case 'set-rule':
      if (!key(edit.accountId, 'account') || !identifier(edit.identifierKey))
        fail('rule is invalid')
      if (!index.identifiers.has(referenceKey(edit.accountId, edit.identifierKey)))
        fail('rule observation reference is invalid')
      if (edit.personId !== null) sameAccount(person(edit.personId).accountId, edit.accountId)
      break
    case 'set-company':
      if (edit.companyId !== null)
        sameAccount(person(edit.personId).accountId, company(edit.companyId).accountId)
      else person(edit.personId)
      break
    case 'link-meeting': {
      if (
        typeof edit.meetingId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(edit.meetingId) ||
        !hash(edit.sourceRevisionAtLink) ||
        !hash(edit.originalHashAtLink)
      )
        fail('meeting reference is invalid')
      const account = targetAccount(data, edit.target, index)
      if (edit.snapshotId !== null) {
        const snapshot = reference(data.snapshots, edit.snapshotId, 'snapshot')
        sameAccount(account, snapshot.accountId)
        if (edit.target.kind === 'event' && edit.target.eventId !== snapshot.eventId)
          fail('event snapshot reference is invalid')
      }
      if (edit.companyIdAtLink !== null)
        sameAccount(account, company(edit.companyIdAtLink).accountId)
      break
    }
    case 'unlink-meeting':
      if (previous.get(edit.linkChangeId)?.payload.op !== 'link-meeting')
        fail('link reference is invalid')
      break
    case 'rename':
      if (
        !['person', 'company'].includes(edit.entity) ||
        !contextText(edit.displayName, 256) ||
        !edit.displayName.trim()
      )
        fail('name is invalid')
      if (edit.entity === 'person') person(edit.id)
      else company(edit.id)
      break
    default:
      fail('operation is unsupported')
  }
}

function* validationSteps(value: unknown, scope: SourceScope): Generator<void> {
  if (!contextObject(value) || value.version !== 1) fail('version or document is unsupported')
  const data = value as unknown as ContextFileV1
  if (
    !contextObject(data.scope) ||
    !sameScope(data.scope, scope) ||
    scope.accountId !== null ||
    scope.workspaceId !== null
  )
    fail('scope is invalid')
  if (
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !contextObject(data.snapshots) ||
    !contextObject(data.people) ||
    !contextObject(data.companies) ||
    !Array.isArray(data.changes)
  )
    fail('schema is invalid')
  const index = emptyIndex()
  for (const [id, s] of Object.entries(data.snapshots)) {
    if (
      !contextObject(s) ||
      !contextUuid(id) ||
      s.id !== id ||
      !key(s.accountId, 'account') ||
      !key(s.eventId, 'event') ||
      !key(s.calendarId, 'calendar') ||
      !['google', 'microsoft'].includes(s.provider) ||
      !contextText(s.providerEventId, 512) ||
      !s.providerEventId ||
      !contextText(s.occurrenceId, 512) ||
      !s.occurrenceId ||
      !contextText(s.subject, 256) ||
      !contextDate(s.startIso) ||
      !contextDate(s.endIso) ||
      !contextDate(s.observedAt) ||
      !hash(s.eventDigest) ||
      !(s.calendarLastSyncIso === null || contextDate(s.calendarLastSyncIso)) ||
      typeof s.calendarWasStale !== 'boolean' ||
      !isCalendarInvitees({ version: 1, roster: s.roster, entries: s.invitees })
    )
      fail('snapshot schema is invalid')
    if (s.eventDigest !== observationDigest(s)) fail('snapshot digest is invalid')
    if (s.invitees.some((i) => i.identifierKey && JSON.parse(i.identifierKey)[0] !== s.provider))
      fail('snapshot provider is invalid')
    indexSnapshot(index, s)
    yield
  }
  for (const entities of [data.people, data.companies])
    for (const [id, e] of Object.entries(entities)) {
      if (
        !contextObject(e) ||
        !contextUuid(id) ||
        e.id !== id ||
        !key(e.accountId, 'account') ||
        !contextText(e.displayName, 256) ||
        !e.displayName.trim() ||
        !contextDate(e.createdAt)
      )
        fail('entity schema is invalid')
      yield
    }
  const seen = new Set<string>()
  const previous = new Map<string, ContextChangeV1>()
  let revision = 0
  for (const c of data.changes) {
    if (
      !contextObject(c) ||
      !contextUuid(c.id) ||
      seen.has(c.id) ||
      !Number.isSafeInteger(c.revision) ||
      c.revision < 1 ||
      c.revision < revision ||
      c.revision > data.revision ||
      !contextDate(c.at) ||
      !['user', 'accepted-start', 'confirmed-rule'].includes(c.provenance) ||
      !(c.supersedes === null || seen.has(c.supersedes))
    )
      fail('change history is invalid')
    validateContextEdit(data, c.payload, previous, index)
    seen.add(c.id)
    previous.set(c.id, c)
    revision = c.revision
    yield
  }
}

/** Synchronous pure validator retained for small direct callers; same checks as the store path. */
export function validateContextFile(
  value: unknown,
  scope: SourceScope
): asserts value is ContextFileV1 {
  const steps = validationSteps(value, scope)
  while (!steps.next().done) {
    /* complete all checks */
  }
}
/** Bounded main work between yields; cancellation/root fences are rechecked after every suspension. */
export async function validateContextFileAsync(
  value: unknown,
  scope: SourceScope,
  assertCurrent: () => void
): Promise<ContextFileV1> {
  assertCurrent()
  let deadline = performance.now() + 3
  const steps = validationSteps(value, scope)
  while (!steps.next().done) {
    if (performance.now() >= deadline) {
      await yieldMain()
      assertCurrent()
      deadline = performance.now() + 3
    }
  }
  assertCurrent()
  return value as ContextFileV1
}

export function contextAccountResolver(data: ContextFileV1): (target: ContextTarget) => string {
  const index = referenceIndex(data)
  return (target) => targetAccount(data, target, index)
}
export function foldContext(data: ContextFileV1): ContextView {
  const result: ContextView = { bindings: {}, self: {}, companies: {}, names: {}, links: [] }
  const removed = new Set<string>()
  for (const c of data.changes) {
    const p = c.payload
    if (p.op === 'bind-invitee')
      (result.bindings[p.snapshotId] ??= {})[p.inviteeId] = { personId: p.personId, changeId: c.id }
    else if (p.op === 'set-self') (result.self[p.snapshotId] ??= {})[p.inviteeId] = p.isSelf
    else if (p.op === 'set-company') result.companies[p.personId] = p.companyId
    else if (p.op === 'rename') result.names[p.id] = p.displayName
    else if (p.op === 'link-meeting') result.links.push({ ...c, payload: p })
    else if (p.op === 'unlink-meeting') removed.add(p.linkChangeId)
  }
  const byEvent = new Map<string, EventSnapshotV1[]>()
  if (data.changes.some((c) => c.payload.op === 'exclude-person'))
    for (const snapshot of Object.values(data.snapshots)) {
      const rows = byEvent.get(snapshot.eventId) ?? []
      rows.push(snapshot)
      byEvent.set(snapshot.eventId, rows)
    }
  for (const c of data.changes) {
    const p = c.payload
    if (p.op !== 'exclude-person') continue
    for (const snapshot of byEvent.get(p.eventId) ?? []) {
      for (const invitee of snapshot.invitees) {
        const binding = result.bindings[snapshot.id]?.[invitee.id]
        if (invitee.identifierKey === p.identifierKey && binding?.personId === p.personId)
          binding.personId = null
      }
    }
  }
  result.links = result.links.filter((link) => !removed.has(link.id))
  return result
}
