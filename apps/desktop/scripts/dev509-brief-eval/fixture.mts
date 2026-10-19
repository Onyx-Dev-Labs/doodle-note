import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import {
  localSourceScope,
  projectSources,
  SOURCE_IDENTITY_FILE
} from '@repo/meetings-store/sources'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import type { CalendarEvent } from '../../src/shared/calendar-api'
import { scopeCalendar, scopeEvent } from '../../src/main/calendar-identity'
import {
  normalizeCalendarInvitees,
  readCalendarInvitees
} from '../../src/main/calendar-context-normalization'
import { observationDigest, validateContextFile } from '../../src/main/calendar-context-validation'
import type {
  ContextFileV1,
  ContextEdit,
  EventSnapshotV1
} from '../../src/main/calendar-context-types'
import { CalendarContextStore, CONTEXT_FILE } from '../../src/main/calendar-context-store'
import { BriefOriginals } from '../../src/main/brief-originals'
import { LibraryActivity } from '../../src/main/library-activity'
import { sha256, type Corpus, type Scenario, type Original } from './corpus.mjs'

export const uuid = (seed: string): string => {
  const h = sha256(seed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
export function fixtureEvent(corpus: Corpus, item: Scenario, foreign = false): CalendarEvent {
  const identity = { provider: item.provider, subject: corpus.accountSubjects[foreign ? 1 : 0]! }
  const calendar = scopeCalendar(identity, {
    id: 'same-raw-calendar',
    name: 'Synthetic',
    colorHex: '#000',
    isDefault: true,
    canEdit: false
  })
  const unknown = !foreign && item.identityMode === 'unknown-roster'
  const resource = !foreign && item.identityMode === 'resource'
  const invitees = normalizeCalendarInvitees(
    item.provider,
    unknown
      ? {}
      : item.provider === 'google'
        ? {
            attendees: [
              {
                email: corpus.personAddress,
                displayName: corpus.personName,
                ...(resource ? { resource: true } : {})
              }
            ]
          }
        : {
            attendees: [
              {
                type: resource ? 'resource' : 'required',
                emailAddress: { address: corpus.personAddress, name: corpus.personName }
              }
            ]
          }
  )
  return scopeEvent(identity, calendar, {
    id: `event-${item.id}`,
    subject: item.eventSubject,
    startIso: corpus.eventStart,
    endIso: corpus.eventEnd,
    isAllDay: false,
    isOnlineMeeting: false,
    hasParticipants: true,
    calendarId: calendar.id,
    sourceLabel: foreign ? 'Synthetic foreign account' : 'Synthetic primary account',
    invitees
  })
}
function snapshot(
  corpus: Corpus,
  item: Scenario,
  event: CalendarEvent,
  foreign: boolean
): EventSnapshotV1 {
  const roster = readCalendarInvitees(event.invitees)
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
  return {
    id: uuid(`${item.id}:snapshot:${foreign}`),
    ...fields,
    eventDigest: observationDigest(fields),
    observedAt: corpus.fixtureEpoch,
    calendarLastSyncIso: corpus.fixtureEpoch,
    calendarWasStale: false
  }
}
/** Deterministic synthetic seed only; production store still performs full admission/byte fences. */
export function fixtureContext(corpus: Corpus, item: Scenario, scope: SourceScope): ContextFileV1 {
  const data: ContextFileV1 = {
    version: 1,
    scope,
    revision: 0,
    snapshots: {},
    people: {},
    companies: {},
    changes: []
  }
  const append = (payload: ContextEdit): void => {
    data.revision++
    data.changes.push({
      id: uuid(`${item.id}:change:${data.revision}`),
      revision: data.revision,
      at: corpus.fixtureEpoch,
      provenance: 'user',
      supersedes: null,
      payload
    })
  }
  for (const foreign of [false, true]) {
    const event = fixtureEvent(corpus, item, foreign)
    const observed = snapshot(corpus, item, event, foreign)
    data.snapshots[observed.id] = observed
    const personId = uuid(`${item.id}:person:${foreign}`)
    data.people[personId] = {
      id: personId,
      accountId: event.accountId!,
      displayName: corpus.personName,
      createdAt: corpus.fixtureEpoch
    }
    if (foreign || item.identityMode === 'person' || item.identityMode === 'self') {
      const invitee = observed.invitees[0]!
      append({ op: 'bind-invitee', snapshotId: observed.id, inviteeId: invitee.id, personId })
      if (!foreign && item.identityMode === 'self')
        append({ op: 'set-self', snapshotId: observed.id, inviteeId: invitee.id, isSelf: true })
    }
    for (const original of foreign ? item.foreignOriginals : item.originals) {
      if (!foreign && ['unassigned', 'resource', 'unknown-roster'].includes(item.identityMode))
        continue
      const projected = projectSources(original, scope)
      assert(projected)
      append({
        op: 'link-meeting',
        meetingId: original.id,
        target: { kind: 'person', personId },
        snapshotId: null,
        sourceRevisionAtLink: projected.revisionId,
        originalHashAtLink: sha256(JSON.stringify(original)),
        companyIdAtLink: null
      })
    }
  }
  validateContextFile(data, scope)
  return data
}
export async function createFixture(corpus: Corpus, item: Scenario) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-eval-')))
  const meetingsDir = join(root, 'meetings')
  mkdirSync(meetingsDir)
  // Fixture marker seeding is confined to a newly created directory. All reads use the canonical API.
  writeFileSync(
    join(meetingsDir, SOURCE_IDENTITY_FILE),
    JSON.stringify({ version: 1, libraryId: uuid(`${item.id}:library`) }),
    { flag: 'wx', mode: 0o600 }
  )
  const scope = localSourceScope(meetingsDir, false)
  const originals: Original[] = [...item.originals, ...item.foreignOriginals]
  for (let i = 0; i < item.unlinkedFillerCount; i++)
    originals.push({
      id: `unlinked-${i}`,
      title: `Recent synthetic filler ${i}`,
      createdAt: '2026-10-17T10:00:00.000Z',
      rawNotesMarkdown: 'Routine synthetic agenda with no recorded decision.',
      enhancedMarkdown: '',
      syntheticExtension: { preserve: true }
    })
  const originalBytes = Object.fromEntries(originals.map((o) => [o.id, JSON.stringify(o)]))
  for (const [id, bytes] of Object.entries(originalBytes))
    writeFileSync(join(meetingsDir, id + '.json'), bytes, { flag: 'wx', mode: 0o600 })
  const context = fixtureContext(corpus, item, scope)
  const contextBytes = JSON.stringify(context)
  writeFileSync(join(root, CONTEXT_FILE), contextBytes, { flag: 'wx', mode: 0o600 })
  const require = createRequire(import.meta.url)
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve('tsx/cjs'))});require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});`,
    { eval: true, workerData: { meetingsDir, cacheDir: join(root, 'cache') } }
  )
  let live = true
  const assertCurrent = (): void => {
    if (!live) throw new Error('Synthetic fixture lifetime ended')
  }
  const sources = new SourceIndexClient(worker, () => ({ meetingsDir, scope, authorized: live }))
  const activity = new LibraryActivity()
  const store = new CalendarContextStore(() => root, assertCurrent, activity)
  const metadata = new BriefOriginals(store, sources, activity)
  const event = fixtureEvent(corpus, item)
  return {
    root,
    sources,
    activity,
    store,
    metadata,
    scope,
    event,
    assertCurrent,
    originalBytes,
    contextBytes,
    checkBytes: () => ({
      originalsUnchanged: Object.entries(originalBytes).every(
        ([id, bytes]) => readFileSync(join(meetingsDir, id + '.json'), 'utf8') === bytes
      ),
      contextUnchanged: readFileSync(join(root, CONTEXT_FILE), 'utf8') === contextBytes
    }),
    calendar: {
      resolveBrief: (id: string) =>
        id === event.id && live ? { event, lastSyncIso: corpus.fixtureEpoch, assertCurrent } : null,
      subscribeBrief: (_listener: () => void) => () => {}
    },
    async dispose() {
      await metadata.dispose()
      await store.dispose()
      live = false
      await sources.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
