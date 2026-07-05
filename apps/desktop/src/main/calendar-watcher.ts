/**
 * Pure "should we prompt for this meeting now?" logic, kept free of Electron
 * imports so it can be unit-tested with node:test (see calendar-watcher.test.ts).
 * CalendarService runs these on a 30s interval.
 */

/** Prompt for events that started up to this long ago… */
export const PROMPT_LOOKBACK_MS = 60_000
/** …or start within this long from now. */
export const PROMPT_LOOKAHEAD_MS = 120_000
/** Notified-id entries older than this are pruned from disk. */
export const NOTIFIED_RETENTION_MS = 24 * 60 * 60_000

/** The slice of a calendar event the prompt decision needs. */
export interface WatchableEvent {
  id: string
  startIso: string
  isAllDay: boolean
}

/**
 * True when `event` should trigger the "meeting is starting" prompt at
 * `nowMs`: not all-day, not already notified, and its start lies inside
 * [now - PROMPT_LOOKBACK_MS, now + PROMPT_LOOKAHEAD_MS].
 */
export function shouldPromptNow(
  event: WatchableEvent,
  nowMs: number,
  notifiedIds: ReadonlySet<string>
): boolean {
  if (event.isAllDay) return false
  if (event.id.length === 0 || notifiedIds.has(event.id)) return false
  const startMs = Date.parse(event.startIso)
  if (!Number.isFinite(startMs)) return false
  return startMs >= nowMs - PROMPT_LOOKBACK_MS && startMs <= nowMs + PROMPT_LOOKAHEAD_MS
}

/**
 * The events to prompt for in one watcher tick, in start order. Callers mark
 * each returned event as notified before firing anything user-visible.
 */
export function eventsToPromptNow(
  events: readonly WatchableEvent[],
  nowMs: number,
  notifiedIds: ReadonlySet<string>
): WatchableEvent[] {
  return events
    .filter((event) => shouldPromptNow(event, nowMs, notifiedIds))
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
}

/**
 * Drop notified-id entries whose timestamp is older than
 * NOTIFIED_RETENTION_MS (or unparseable), so calendar-notified.json never
 * grows without bound. Returns a new map; input is untouched.
 */
export function pruneNotified(
  notified: Readonly<Record<string, string>>,
  nowMs: number
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, iso] of Object.entries(notified)) {
    const at = Date.parse(iso)
    if (Number.isFinite(at) && nowMs - at <= NOTIFIED_RETENTION_MS) {
      out[id] = iso
    }
  }
  return out
}
