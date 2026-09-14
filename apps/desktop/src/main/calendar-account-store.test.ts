import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CalendarAccountStore, type CalendarEncryption } from './calendar-account-store'
import { accountKey, microsoftIdentity, scopeCalendar, scopeEvent } from './calendar-identity'
import type { AccountInfo } from '@azure/msal-node'
import type { CalendarEvent, CalendarInfo } from '../shared/calendar-api'

// Synthetic reversible test codec. Production injects Electron safeStorage only.
const encryption: CalendarEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`fixture:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(8), 'base64').toString()
}
const calendar: CalendarInfo = {
  id: 'same-calendar',
  name: 'Calendar',
  colorHex: '#123456',
  isDefault: true,
  canEdit: false
}
const event: CalendarEvent = {
  id: 'same-event',
  calendarId: calendar.id,
  subject: 'Fixture',
  startIso: '2099-01-01T10:00:00Z',
  endIso: '2099-01-01T11:00:00Z',
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: true
}
const identities = [
  ...['tenant-a', 'tenant-b'].map((tenantId) =>
    microsoftIdentity(
      {
        homeAccountId: 'home',
        localAccountId: 'object',
        environment: 'login.microsoftonline.com',
        tenantId
      } as AccountInfo,
      'fixture-client'
    )
  ),
  { provider: 'google' as const, subject: 'subject-a' },
  { provider: 'google' as const, subject: 'subject-b' }
]

test('four account identities isolate matching raw IDs and survive display-name changes', () => {
  assert.equal(new Set(identities.map(accountKey)).size, 4)
  const events = identities.map((identity) =>
    scopeEvent(identity, scopeCalendar(identity, calendar), event)
  )
  assert.equal(new Set(events.map((e) => e.id)).size, 4)
  assert.ok(events.every((e) => e.id.length < 512))
  const identity = identities[0]!
  const scoped = scopeCalendar(identity, calendar)
  const renamed = scopeEvent(identity, scoped, {
    ...event,
    subject: 'Different name',
    startIso: '2099-02-03T11:00:00Z'
  })
  assert.equal(renamed.id, events[0]!.id)
  assert.notEqual(scopeEvent(identity, scoped, { ...event, id: 'next-occurrence' }).id, renamed.id)
  assert.notEqual(
    scopeEvent(identity, scopeCalendar(identity, { ...calendar, id: 'other-calendar' }), event).id,
    renamed.id
  )
  assert.throws(() => scopeEvent(identities[1]!, scoped, event), /does not belong/)
})

test('encrypted migration, selections, prompt history and notes aliases survive restart without changing originals', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'account-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const legacy = join(dir, 'calendar-token-cache')
  writeFileSync(legacy, 'synthetic-legacy-encrypted-source')
  const store = new CalendarAccountStore(dir, encryption)
  const id = store.put(identities[0]!, { email: 'same@example.test' }, 'synthetic-secret')
  store.migrateSnapshot(id, [calendar], [event], [calendar.id], {
    [event.id]: '2099-01-01T10:00:00Z'
  })
  const scoped = store.get(id)!
  assert.equal(scoped.visibleCalendarIds?.[0], scoped.calendars[0]!.id)
  assert.equal(scoped.notified[scoped.events[0]!.id], '2099-01-01T10:00:00Z')
  assert.equal(store.legacyAlias(scoped.events[0]!.id), event.id)
  assert.equal(readFileSync(legacy, 'utf8'), 'synthetic-legacy-encrypted-source')
  assert.doesNotMatch(readFileSync(store.path, 'utf8'), /synthetic-secret|same@example/)
  assert.doesNotMatch(JSON.stringify(store.views()), /synthetic-secret|subject|credential/)
  const restored = new CalendarAccountStore(dir, encryption)
  assert.deepEqual(restored.get(id), scoped)
  restored.migrateSnapshot(id, [], [], null, {})
  assert.deepEqual(restored.get(id), scoped)
  restored.put(identities[0]!, { email: 'renamed@example.test' }, 'new-secret')
  assert.equal(restored.entries().length, 1)
  assert.deepEqual(restored.get(id)?.events, scoped.events)
  // A crash before rename may leave an encrypted temporary file; it is never adopted.
  writeFileSync(`${store.path}.interrupted.tmp`, encryption.encryptString('{"version":99}'))
  assert.deepEqual(new CalendarAccountStore(dir, encryption).get(id), restored.get(id))
})

test('legacy raw-ID collisions and unknown calendars never produce a note alias', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'account-alias-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new CalendarAccountStore(dir, encryption)
  const id = store.put(identities[0]!, { email: 'fixture@example.test' }, 'fixture')
  const other = { ...calendar, id: 'other-calendar' }
  store.migrateSnapshot(
    id,
    [calendar, other],
    [event, { ...event, calendarId: other.id }, { ...event, id: 'unknown', calendarId: '' }],
    null,
    {}
  )
  assert.equal(store.get(id)!.events.length, 2)
  for (const e of store.get(id)!.events) assert.equal(store.legacyAlias(e.id), undefined)
})

test('removal and reauthentication invalidate old writers without affecting other accounts', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'account-race-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new CalendarAccountStore(dir, encryption)
  const ids = identities.map((i) =>
    store.put(i, { email: 'same@example.test' }, `credential-${i.subject}`)
  )
  const before = store.get(ids[1]!)
  const oldEpoch = store.epoch(ids[0]!)
  store.remove(ids[0]!)
  assert.equal(
    store.update(ids[0]!, oldEpoch, (e) => {
      e.credential = 'late'
    }),
    false
  )
  store.put(identities[0]!, { email: 'renamed@example.test' }, 'replacement')
  assert.equal(
    store.update(ids[0]!, oldEpoch, (e) => {
      e.credential = 'late'
    }),
    false
  )
  assert.deepEqual(store.get(ids[1]!), before)
  assert.equal(new CalendarAccountStore(dir, encryption).entries().length, 4)
})

test('encryption/write verification failures keep the last committed state and legacy files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'account-storage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let available = true
  let fail = false
  const codec = {
    ...encryption,
    isEncryptionAvailable: () => available,
    decryptString: (b: Buffer) => {
      if (fail) throw new Error('synthetic-secret')
      return encryption.decryptString(b)
    }
  }
  const store = new CalendarAccountStore(dir, codec)
  const id = store.put(identities[0]!, { email: 'fixture@example.test' }, 'original')
  const before = readFileSync(store.path)
  available = false
  assert.throws(() => store.remove(id), /Calendar storage/)
  available = true
  fail = true
  assert.throws(
    () => store.put(identities[1]!, { email: 'other@example.test' }, 'replacement'),
    (e) => {
      assert.doesNotMatch(String(e), /synthetic-secret/)
      return true
    }
  )
  assert.deepEqual(readFileSync(store.path), before)
  assert.equal(store.entries().length, 1)
  assert.deepEqual(readdirSync(dir), ['calendar-accounts-v2'])
  fail = false
  assert.equal(new CalendarAccountStore(dir, codec).entries().length, 1)
  writeFileSync(store.path, encryption.encryptString('{"version":99}'))
  const unknownVersion = new CalendarAccountStore(dir, codec)
  assert.match(unknownVersion.error!, /storage/)
  assert.throws(
    () => unknownVersion.put(identities[0]!, { email: 'fixture@example.test' }, 'overwrite'),
    /storage/
  )
})
