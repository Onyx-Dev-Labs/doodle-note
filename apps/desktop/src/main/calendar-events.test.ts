import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CalendarEvent, CalendarInfo } from '../shared/calendar-api'
import {
  FALLBACK_CALENDAR_HEX,
  filterByParticipants,
  graphColorToHex,
  mergeCalendarEvents,
  nextTrayEvent,
  resolveVisibleCalendars,
  trayTitle,
  upcomingTrayEvents
} from './calendar-events'

const NOW = Date.parse('2026-07-06T10:00:00.000Z')

function eventAt(offsetMs: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `ev-${offsetMs}`,
    subject: 'Team Meeting',
    startIso: new Date(NOW + offsetMs).toISOString(),
    endIso: new Date(NOW + offsetMs + 30 * 60_000).toISOString(),
    isAllDay: false,
    isOnlineMeeting: false,
    calendarId: 'cal-1',
    hasParticipants: true,
    ...overrides
  }
}

function calendarOf(id: string, overrides: Partial<CalendarInfo> = {}): CalendarInfo {
  return { id, name: id, colorHex: '#e8804f', isDefault: false, canEdit: true, ...overrides }
}

/* ---- mergeCalendarEvents ---- */

test('merge interleaves per-calendar lists sorted by start', () => {
  const workLater = eventAt(3 * 3_600_000, { id: 'work-later', calendarId: 'work' })
  const workSoon = eventAt(600_000, { id: 'work-soon', calendarId: 'work' })
  const sharedMid = eventAt(3_600_000, { id: 'shared-mid', calendarId: 'shared' })
  const merged = mergeCalendarEvents([[workSoon, workLater], [sharedMid]])
  assert.deepEqual(
    merged.map((e) => e.id),
    ['work-soon', 'shared-mid', 'work-later']
  )
})

test('merge drops duplicate event ids and sinks unparseable starts to the end', () => {
  const dupA = eventAt(0, { id: 'dup' })
  const dupB = eventAt(600_000, { id: 'dup', calendarId: 'other' })
  const broken = eventAt(0, { id: 'broken', startIso: 'not-a-date' })
  const fine = eventAt(1_200_000, { id: 'fine' })
  const merged = mergeCalendarEvents([[broken, dupA], [dupB], [fine]])
  assert.deepEqual(
    merged.map((e) => e.id),
    ['dup', 'fine', 'broken']
  )
  // First occurrence wins for duplicates.
  assert.equal(merged[0]?.calendarId, 'cal-1')
})

/* ---- filterByParticipants ---- */

test('filter keeps everything when showNoParticipants is true', () => {
  const solo = eventAt(0, { id: 'solo', hasParticipants: false })
  const meeting = eventAt(600_000, { id: 'meeting', hasParticipants: true })
  assert.deepEqual(
    filterByParticipants([solo, meeting], true).map((e) => e.id),
    ['solo', 'meeting']
  )
})

test('filter drops participant-less events when showNoParticipants is false', () => {
  const solo = eventAt(0, { id: 'solo', hasParticipants: false })
  const meeting = eventAt(600_000, { id: 'meeting', hasParticipants: true })
  const call = eventAt(1_200_000, { id: 'call', hasParticipants: true, isOnlineMeeting: true })
  assert.deepEqual(
    filterByParticipants([solo, meeting, call], false).map((e) => e.id),
    ['meeting', 'call']
  )
})

/* ---- graphColorToHex ---- */

test('color mapping: explicit hexColor wins over the named color', () => {
  assert.equal(graphColorToHex('lightBlue', '#AABBCC'), '#aabbcc')
})

test('color mapping: named enum maps when hexColor is absent or auto-ish', () => {
  assert.equal(graphColorToHex('lightOrange', undefined), '#e8804f')
  assert.equal(graphColorToHex('lightBlue', ''), '#5b9bd5')
  assert.equal(graphColorToHex('LIGHTTEAL', 'auto'), '#4fb3a4')
})

test('color mapping: auto, maxColor, unknown and garbage fall back to the sage hex', () => {
  assert.equal(graphColorToHex('auto', undefined), FALLBACK_CALENDAR_HEX)
  assert.equal(graphColorToHex('maxColor', undefined), FALLBACK_CALENDAR_HEX)
  assert.equal(graphColorToHex('hotMagenta', '#12345'), FALLBACK_CALENDAR_HEX)
  assert.equal(graphColorToHex(undefined, 42), FALLBACK_CALENDAR_HEX)
})

/* ---- resolveVisibleCalendars ---- */

test('null pref resolves to the default calendar only', () => {
  const cals = [calendarOf('birthdays'), calendarOf('primary', { isDefault: true })]
  assert.deepEqual(
    resolveVisibleCalendars(cals, null).map((c) => c.id),
    ['primary']
  )
  // No default flagged → first calendar stands in.
  assert.deepEqual(
    resolveVisibleCalendars([calendarOf('a'), calendarOf('b')], null).map((c) => c.id),
    ['a']
  )
})

test('explicit ids select matching calendars; stale ids fall back to the default', () => {
  const cals = [calendarOf('primary', { isDefault: true }), calendarOf('shared')]
  assert.deepEqual(
    resolveVisibleCalendars(cals, ['shared']).map((c) => c.id),
    ['shared']
  )
  assert.deepEqual(
    resolveVisibleCalendars(cals, ['deleted-cal']).map((c) => c.id),
    ['primary']
  )
  assert.deepEqual(resolveVisibleCalendars([], ['anything']), [])
})

/* ---- tray title ---- */

test('nextTrayEvent skips all-day and ended events, keeps in-progress ones', () => {
  const allDay = eventAt(0, { id: 'all-day', isAllDay: true })
  const ended = eventAt(-7_200_000, { id: 'ended' })
  const running = eventAt(-600_000, { id: 'running' })
  const later = eventAt(3_600_000, { id: 'later' })
  assert.equal(nextTrayEvent([ended, allDay, running, later], NOW)?.id, 'running')
  assert.equal(nextTrayEvent([ended, allDay], NOW), null)
  assert.equal(nextTrayEvent([], NOW), null)
})

test('trayTitle formats minutes, hours, days, "now" and truncates ~28 chars', () => {
  assert.equal(trayTitle(eventAt(12 * 60_000), NOW), '◷ Team Meeting in 12m')
  assert.equal(trayTitle(eventAt(-60_000), NOW), '◷ Team Meeting now')
  assert.equal(trayTitle(eventAt(3 * 3_600_000), NOW), '◷ Team Meeting in 3h')
  assert.equal(trayTitle(eventAt(2 * 86_400_000), NOW), '◷ Team Meeting in 2d')
  assert.equal(trayTitle(eventAt(60_000, { subject: '  ' }), NOW), '◷ Untitled meeting in 1m')
  const long = eventAt(60_000, { subject: 'Quarterly Business Review With Leadership' })
  assert.equal(trayTitle(long, NOW), '◷ Quarterly Business Review W… in 1m')
})

test('upcomingTrayEvents returns at most N timed events in start order', () => {
  const events = [
    eventAt(-600_000, { id: 'running' }),
    eventAt(0, { id: 'all-day', isAllDay: true }),
    eventAt(600_000, { id: 'soon' }),
    eventAt(3_600_000, { id: 'later' }),
    eventAt(7_200_000, { id: 'much-later' })
  ]
  assert.deepEqual(
    upcomingTrayEvents(events, NOW, 3).map((e) => e.id),
    ['running', 'soon', 'later']
  )
})
