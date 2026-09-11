import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CALENDAR_PREFS,
  type CalendarEvent,
  type CalendarInfo
} from '../shared/calendar-api'
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
loader._load = (id, ...args) => (id === 'electron' ? {} : originalLoad(id, ...args))
const { CalendarService } = require('./calendar-service') as typeof import('./calendar-service')
loader._load = originalLoad
const oldSync = '2026-01-01T00:00:00.000Z'
const calendar = (id: string): CalendarInfo => ({
  id,
  name: 'Fixture',
  colorHex: '#123456',
  isDefault: true,
  canEdit: false
})
const event = (id: string, calendarId: string): CalendarEvent => ({
  id,
  calendarId,
  subject: 'Fixture',
  startIso: '2099-01-01T00:00:00.000Z',
  endIso: '2099-01-01T01:00:00.000Z',
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: true
})
interface RefreshFixture {
  prefs: { visibleCalendarIds: string[] | null }
  account: unknown
  rawEvents: CalendarEvent[]
  calendars: CalendarInfo[]
  googleCalendars: CalendarInfo[]
  lastSyncIso: string
  lastError?: string
  eventCachePath: string
  google: {
    signedIn: boolean
    fetchCalendars(): Promise<CalendarInfo[]>
    fetchEvents(c: CalendarInfo): Promise<CalendarEvent[]>
  }
  fetchCalendars(): Promise<CalendarInfo[]>
  fetchCalendarView(token: string, c: CalendarInfo): Promise<CalendarEvent[]>
  refreshEvents(): Promise<void>
  loadEventCache(): { googleCalendars?: CalendarInfo[] }
}
function fixture(microsoft = false): RefreshFixture {
  return Object.assign(Object.create(CalendarService.prototype), {
    refreshBusy: false,
    account: microsoft ? {} : null,
    rawEvents: [event('old-google', 'g:primary'), ...(microsoft ? [event('old-ms', 'ms')] : [])],
    calendars: microsoft ? [calendar('ms')] : [],
    googleCalendars: [calendar('g:primary')],
    prefs: { ...DEFAULT_CALENDAR_PREFS },
    lastSyncIso: oldSync,
    google: {
      signedIn: true,
      fetchCalendars: async () => [calendar('g:primary')],
      fetchEvents: async () => [event('new-google', 'g:primary')]
    },
    getAccessToken: async () => 'fixture-token',
    fetchCalendars: async () => [calendar('ms')],
    fetchCalendarView: async () => [event('new-ms', 'ms')],
    saveEventCache: () => {},
    checkMeetingStarts: () => {},
    broadcastState: () => {}
  }) as RefreshFixture
}

test('Google list failure keeps cached data and timestamp; healthy Microsoft still refreshes', async () => {
  const s = fixture(true)
  s.google.fetchCalendars = async () => {
    throw new Error('Google Calendar is not configured correctly. Update DoodleNote.')
  }
  await s.refreshEvents()
  assert.deepEqual(s.rawEvents.map((e) => e.id).sort(), ['new-ms', 'old-google'])
  assert.equal(s.lastSyncIso, oldSync)
  assert.match(s.lastError!, /^Google Calendar/)
  s.google.fetchCalendars = async () => [calendar('g:primary')]
  await s.refreshEvents()
  assert.equal(s.lastError, undefined)
  assert.notEqual(s.lastSyncIso, oldSync)
  assert.deepEqual(s.rawEvents.map((e) => e.id).sort(), ['new-google', 'new-ms'])
})

test('Google-only event failure is not successful empty sync and cached calendars reload', async (t) => {
  const s = fixture()
  s.google.fetchEvents = async () => {
    throw new Error('Google Calendar could not be reached. Check your connection and try again.')
  }
  await s.refreshEvents()
  assert.equal(s.lastSyncIso, oldSync)
  assert.equal(s.rawEvents[0]?.id, 'old-google')
  assert.match(s.lastError!, /^Google Calendar/)
  assert.doesNotMatch(s.lastError!, /Microsoft/)
  const dir = mkdtempSync(join(tmpdir(), 'calendar-refresh-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  s.eventCachePath = join(dir, 'calendar-cache.json')
  writeFileSync(
    s.eventCachePath,
    JSON.stringify({ events: s.rawEvents, googleCalendars: s.googleCalendars })
  )
  assert.deepEqual(s.loadEventCache().googleCalendars, s.googleCalendars)
})

test('Microsoft failure does not prevent Google refresh or erase Microsoft cache', async () => {
  const s = fixture(true)
  s.fetchCalendars = async () => {
    throw new Error('Microsoft calendar unavailable')
  }
  await s.refreshEvents()
  assert.deepEqual(s.rawEvents.map((e) => e.id).sort(), ['new-google', 'old-ms'])
  assert.equal(s.lastSyncIso, oldSync)
  assert.match(s.lastError!, /Microsoft/)
})

test('partial calendar failure preserves failed events while successful empty calendar clears old events', async () => {
  const s = fixture()
  s.rawEvents.push(event('old-other', 'g:other'))
  s.google.fetchCalendars = async () => [calendar('g:primary'), calendar('g:other')]
  s.google.fetchEvents = async (c) => {
    if (c.id === 'g:primary') throw new Error('Google Calendar temporary failure')
    return []
  }
  await s.refreshEvents()
  assert.deepEqual(
    s.rawEvents.map((e) => e.id),
    ['old-google']
  )
  assert.equal(s.lastSyncIso, oldSync)
})

test('an explicitly selected Google calendar does not fetch hidden Microsoft events', async () => {
  const s = fixture(true)
  s.prefs.visibleCalendarIds = ['g:primary']
  s.fetchCalendarView = async () => {
    assert.fail('hidden Microsoft calendar must not be fetched')
  }
  await s.refreshEvents()
  assert.equal(s.lastError, undefined)
  assert.notEqual(s.lastSyncIso, oldSync)
  assert.deepEqual(
    s.rawEvents.map((e) => e.id),
    ['new-google']
  )
})
