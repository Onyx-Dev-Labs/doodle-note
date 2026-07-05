/**
 * Pure multi-calendar event logic — merging, visibility, the no-participants
 * filter, Graph color mapping and the menu-bar (Tray) title — kept free of
 * Electron imports so it can be unit-tested with node:test
 * (see calendar-events.test.ts). CalendarService is the only other consumer.
 */

import type { CalendarEvent, CalendarInfo } from '../shared/calendar-api'

/** Accent used when a calendar has no usable color ('auto' with no hexColor). */
export const FALLBACK_CALENDAR_HEX = '#7c9769'

/**
 * Reasonable hexes for Graph's named calendarColor enum — Graph only sends
 * hexColor for some account types, so the names need a client-side palette.
 */
const GRAPH_COLOR_HEX: Readonly<Record<string, string>> = {
  lightblue: '#5b9bd5',
  lightgreen: '#68af5d',
  lightorange: '#e8804f',
  lightgray: '#9ba1a6',
  lightyellow: '#d8b64a',
  lightteal: '#4fb3a4',
  lightpink: '#e277a8',
  lightbrown: '#a47b58',
  lightred: '#d96c6c'
}

/**
 * Resolve a calendar's accent color: an explicit `hexColor` wins; otherwise
 * the named `color` enum maps through GRAPH_COLOR_HEX; 'auto', 'maxColor',
 * unknown names and absent values all fall back to FALLBACK_CALENDAR_HEX.
 */
export function graphColorToHex(color: unknown, hexColor: unknown): string {
  if (typeof hexColor === 'string' && /^#[0-9a-f]{6}$/i.test(hexColor.trim())) {
    return hexColor.trim().toLowerCase()
  }
  if (typeof color === 'string') {
    const mapped = GRAPH_COLOR_HEX[color.trim().toLowerCase()]
    if (mapped !== undefined) return mapped
  }
  return FALLBACK_CALENDAR_HEX
}

/**
 * Merge per-calendar fetch results into one list: duplicates (same event id)
 * collapse to their first occurrence, and the result is sorted by start
 * (unparseable starts sink to the end).
 */
export function mergeCalendarEvents(lists: readonly (readonly CalendarEvent[])[]): CalendarEvent[] {
  const seen = new Set<string>()
  const merged: CalendarEvent[] = []
  for (const list of lists) {
    for (const event of list) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      merged.push(event)
    }
  }
  merged.sort((a, b) => startMs(a) - startMs(b))
  return merged
}

function startMs(event: CalendarEvent): number {
  const ms = Date.parse(event.startIso)
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

/**
 * The canonical "what the app shows" filter: with showNoParticipants off,
 * only events with participants (invitees or a video link) survive.
 */
export function filterByParticipants(
  events: readonly CalendarEvent[],
  showNoParticipants: boolean
): CalendarEvent[] {
  if (showNoParticipants) return [...events]
  return events.filter((event) => event.hasParticipants)
}

/**
 * Which calendars to fetch, given the visibleCalendarIds pref:
 * - null → the default calendar only (first calendar when none is flagged);
 * - a list → the matching calendars, falling back to the default when the
 *   saved ids no longer match anything (a stale pref must not blank the app).
 */
export function resolveVisibleCalendars(
  calendars: readonly CalendarInfo[],
  visibleCalendarIds: readonly string[] | null
): CalendarInfo[] {
  if (calendars.length === 0) return []
  const fallback = calendars.filter((c) => c.isDefault)
  const defaults = fallback.length > 0 ? fallback : [calendars[0] as CalendarInfo]
  if (visibleCalendarIds === null) return defaults
  const wanted = new Set(visibleCalendarIds)
  const visible = calendars.filter((c) => wanted.has(c.id))
  return visible.length > 0 ? visible : defaults
}

/** The event the macOS menu bar shows: the soonest non-all-day event that is
 *  in progress or upcoming, or null when nothing qualifies. Input is the
 *  canonical (already sorted, already filtered) list. */
export function nextTrayEvent(
  events: readonly CalendarEvent[],
  nowMs: number
): CalendarEvent | null {
  for (const event of events) {
    if (event.isAllDay) continue
    const end = Date.parse(event.endIso)
    if (!Number.isFinite(end) || end <= nowMs) continue
    if (!Number.isFinite(Date.parse(event.startIso))) continue
    return event
  }
  return null
}

/** Menu-bar title text: "◷ Team Meeting in 12m" (or "… now" while it runs). */
export function trayTitle(event: CalendarEvent, nowMs: number): string {
  const subject = event.subject.trim() || 'Untitled meeting'
  const truncated = subject.length > 28 ? `${subject.slice(0, 27)}…` : subject
  return `◷ ${truncated} ${trayEta(Date.parse(event.startIso), nowMs)}`
}

/** "now" during the event, else "in 12m" / "in 3h" / "in 2d". */
function trayEta(startMs: number, nowMs: number): string {
  const diff = startMs - nowMs
  if (diff <= 0) return 'now'
  const minutes = Math.max(1, Math.ceil(diff / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.max(1, Math.round(hours / 24))}d`
}

/** The next few non-all-day events (in progress or upcoming) for the Tray
 *  click menu, in start order. */
export function upcomingTrayEvents(
  events: readonly CalendarEvent[],
  nowMs: number,
  count: number
): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const event of events) {
    if (out.length >= count) break
    if (event.isAllDay) continue
    const end = Date.parse(event.endIso)
    if (!Number.isFinite(end) || end <= nowMs) continue
    if (!Number.isFinite(Date.parse(event.startIso))) continue
    out.push(event)
  }
  return out
}
