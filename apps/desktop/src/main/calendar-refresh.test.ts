import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CALENDAR_PREFS,
  type CalendarEvent,
  type CalendarInfo,
  type CalendarProvider
} from '../shared/calendar-api'
import { CalendarAccountStore } from './calendar-account-store'
import { scopeCalendar, scopeEvent } from './calendar-identity'
import { CalendarRequestError } from './calendar-http'
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
loader._load = (id, ...args) => (id === 'electron' ? {} : originalLoad(id, ...args))
const { CalendarService } = require('./calendar-service') as typeof import('./calendar-service')
loader._load = originalLoad
const oldSync = '2026-01-01T00:00:00.000Z'
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
}
const rawCalendar = {
  id: 'primary',
  name: 'Calendar',
  colorHex: '#123456',
  isDefault: true,
  canEdit: false
}
const rawEvent = {
  id: 'same-event',
  calendarId: 'primary',
  subject: 'Fixture',
  startIso: '2099-01-01T00:00:00Z',
  endIso: '2099-01-01T01:00:00Z',
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: true
}
interface Source {
  id: string
  provider: CalendarProvider
  calendars(signal: AbortSignal): Promise<CalendarInfo[]>
  events(calendar: CalendarInfo, signal: AbortSignal): Promise<CalendarEvent[]>
}
interface Fixture {
  accounts: CalendarAccountStore
  sources: Map<string, Source>
  syncState: Map<string, { error?: string; syncing: boolean; lastSyncIso?: string }>
  rawEvents: CalendarEvent[]
  lastError?: string
  lastSyncIso?: string
  refreshEvents(): Promise<void>
  restoreSnapshots(): void
}
function fixture(t: TestContext, providers: CalendarProvider[] = ['google', 'microsoft']): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-refresh-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const accounts = new CalendarAccountStore(dir, codec)
  const sources = new Map<string, Source>()
  const syncState = new Map()
  providers.forEach((provider, i) => {
    const identity = { provider, subject: `fixture-${i}` }
    const id = accounts.put(identity, { email: `${i}@example.test` }, 'fixture', true)
    const calendar = scopeCalendar(identity, rawCalendar)
    const event = scopeEvent(identity, calendar, rawEvent)
    accounts.update(id, accounts.epoch(id), (entry) => {
      entry.calendars = [calendar]
      entry.events = [event]
      entry.lastSyncIso = oldSync
    })
    sources.set(id, {
      id,
      provider,
      calendars: async () => [calendar],
      events: async () => [{ ...event, subject: 'Updated' }]
    })
    syncState.set(id, { syncing: false, lastSyncIso: oldSync })
  })
  const s = Object.assign(Object.create(CalendarService.prototype), {
    accounts,
    sources,
    syncState,
    inflight: new Map(),
    refreshQueue: new Set(),
    selectionGeneration: 0,
    rawEvents: [],
    calendars: [],
    googleCalendars: [],
    prefs: { ...DEFAULT_CALENDAR_PREFS },
    restoreErrors: {},
    checkMeetingStarts: () => {},
    broadcastState: () => {}
  }) as Fixture
  s.restoreSnapshots()
  return s
}

test('one failed account retains its snapshot and timestamp while another provider refreshes', async (t) => {
  const s = fixture(t)
  const [google, microsoft] = [...s.sources.values()]
  google!.calendars = async () => {
    throw new Error('Google Calendar temporary failure')
  }
  await s.refreshEvents()
  assert.equal(s.rawEvents.find((e) => e.accountId === google!.id)?.subject, 'Fixture')
  assert.equal(s.rawEvents.find((e) => e.accountId === microsoft!.id)?.subject, 'Updated')
  assert.equal(s.lastSyncIso, oldSync)
  assert.match(s.lastError!, /Google Calendar/)
  google!.calendars = async () => s.accounts.get(google!.id)!.calendars
  await s.refreshEvents()
  assert.equal(s.lastError, undefined)
  assert.notEqual(s.lastSyncIso, oldSync)
})

test('Google-only event failure remains stale and does not report Microsoft errors', async (t) => {
  const s = fixture(t, ['google'])
  const source = [...s.sources.values()][0]!
  source.events = async () => {
    throw new Error('Google Calendar offline')
  }
  await s.refreshEvents()
  assert.equal(s.rawEvents[0]?.subject, 'Fixture')
  assert.equal(s.lastSyncIso, oldSync)
  assert.match(s.lastError!, /^Google Calendar/)
  assert.doesNotMatch(s.lastError!, /Microsoft/)
})

test('two accounts of each provider retain colliding event IDs; failure is isolated within provider', async (t) => {
  const s = fixture(t, ['microsoft', 'microsoft', 'google', 'google'])
  const sources = [...s.sources.values()]
  sources[0]!.calendars = async () => {
    throw new Error('Microsoft unavailable')
  }
  await s.refreshEvents()
  assert.equal(s.rawEvents.length, 4)
  assert.equal(new Set(s.rawEvents.map((e) => e.id)).size, 4)
  assert.equal(s.rawEvents.filter((e) => e.subject === 'Updated').length, 3)
  assert.equal(s.syncState.get(sources[0]!.id)?.lastSyncIso, oldSync)
  for (const source of sources.slice(1))
    assert.notEqual(s.syncState.get(source.id)?.lastSyncIso, oldSync)
})

test('partial calendar failure preserves failed events; successful empty calendar removes deleted events', async (t) => {
  const s = fixture(t, ['google'])
  const source = [...s.sources.values()][0]!
  const entry = s.accounts.get(source.id)!
  const other = scopeCalendar(entry.identity, { ...rawCalendar, id: 'other' })
  const old = scopeEvent(entry.identity, other, rawEvent)
  s.accounts.update(source.id, s.accounts.epoch(source.id), (e) => {
    e.calendars.push(other)
    e.events.push(old)
  })
  source.calendars = async () => s.accounts.get(source.id)!.calendars
  source.events = async (c) => {
    if (c.id === entry.calendars[0]!.id) throw new Error('Calendar offline')
    return []
  }
  await s.refreshEvents()
  assert.deepEqual(
    s.rawEvents.map((e) => e.id),
    entry.events.map((e) => e.id)
  )
  assert.equal(s.lastSyncIso, oldSync)
})

test('hiding every calendar on one account does not enable it again; missing selection stays missing', async (t) => {
  const s = fixture(t)
  const [google, microsoft] = [...s.sources.values()]
  s.accounts.update(microsoft!.id, s.accounts.epoch(microsoft!.id), (e) => {
    e.visibleCalendarIds = []
  })
  microsoft!.events = async () => {
    assert.fail('hidden account fetched events')
  }
  await s.refreshEvents()
  assert.ok(s.rawEvents.every((e) => e.accountId === google!.id))
  s.accounts.update(google!.id, s.accounts.epoch(google!.id), (e) => {
    e.visibleCalendarIds = ['temporarily-missing']
  })
  google!.events = async () => {
    assert.fail('unrelated calendar enabled')
  }
  await s.refreshEvents()
  assert.equal(s.rawEvents.length, 0)
  assert.deepEqual(s.accounts.get(google!.id)?.visibleCalendarIds, ['temporarily-missing'])
})

test('provider Retry-After suppresses subsequent refresh attempts without blocking healthy accounts', async (t) => {
  const s = fixture(t)
  const [limited, healthy] = [...s.sources.values()]
  let calls = 0
  limited!.calendars = async () => {
    calls++
    throw new CalendarRequestError('Rate limited', Date.now() + 60_000)
  }
  await s.refreshEvents()
  await s.refreshEvents()
  assert.equal(calls, 1)
  assert.equal(s.rawEvents.find((e) => e.accountId === healthy!.id)?.subject, 'Updated')
})
