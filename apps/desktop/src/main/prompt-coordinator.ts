import type { CalendarEvent, CalendarStartMeetingEvent } from '../shared/calendar-api'

/** A mic-detected call this close to a calendar event is the same meeting. */
export const MIC_CALENDAR_MATCH_LOOKAHEAD_MS = 5 * 60_000
/** Calendar ids remain unique enough to suppress repeats for a full day. */
const CALENDAR_PROMPT_RETENTION_MS = 24 * 60 * 60_000
/** Ad-hoc prompts retain the existing five-minute quiet period. */
const AD_HOC_PROMPT_RETENTION_MS = 5 * 60_000

export interface PromptCoordinatorState {
  recording: boolean
  deliveredAt: Readonly<Record<string, number>>
}

export interface PromptDecision {
  state: PromptCoordinatorState
  prompt: CalendarStartMeetingEvent | null
  /** Present when an ad-hoc mic signal was correlated to a calendar event. */
  matchedCalendarEventId?: string
}

export type ExternalPromptSurface = 'panel' | 'notification'

export interface PromptDeliveryPlan {
  /** Keep the action available inside DoodleNote whenever a renderer exists. */
  banner: boolean
  /** Use one OS-level attention surface for this already-deduplicated event. */
  external: ExternalPromptSurface | null
}

export function initialPromptCoordinatorState(
  deliveredAt: Readonly<Record<string, number>> = {}
): PromptCoordinatorState {
  return { recording: false, deliveredAt: { ...deliveredAt } }
}

export function setPromptRecording(
  state: PromptCoordinatorState,
  recording: boolean
): PromptCoordinatorState {
  return { ...state, recording }
}

/**
 * Keep the in-app action banner as persistent state, then choose one external
 * attention surface. Native notifications are preferred; the floating panel
 * remains a fallback for platforms/builds where they are unavailable.
 */
export function planPromptDelivery(
  hasWindow: boolean,
  windowFocusedAndVisible: boolean,
  notificationSupported: boolean,
  hasPanel: boolean
): PromptDeliveryPlan {
  return {
    banner: hasWindow,
    external: notificationSupported
      ? 'notification'
      : !windowFocusedAndVisible && hasPanel
        ? 'panel'
        : null
  }
}

/**
 * Coordinate calendar and microphone detections before anything user-visible
 * happens. Mic detection is a fallback: when a timed calendar event is active
 * or starts in the next five minutes, it adopts that event's stable identity.
 */
export function coordinatePrompt(
  state: PromptCoordinatorState,
  requested: CalendarStartMeetingEvent,
  calendarEvents: readonly CalendarEvent[],
  nowMs: number
): PromptDecision {
  const deliveredAt = pruneDelivered(state.deliveredAt, nowMs)
  const nextState = { ...state, deliveredAt }
  if (state.recording) return { state: nextState, prompt: null }

  let prompt = requested
  let matchedCalendarEventId: string | undefined
  if (requested.adHoc) {
    const match = matchingCalendarEvent(calendarEvents, nowMs)
    if (match) {
      prompt = {
        action: 'prompt',
        eventId: match.id,
        subject: match.subject.trim() || 'Untitled meeting',
        startIso: match.startIso
      }
      matchedCalendarEventId = match.id
    }
  }

  const key = promptKey(prompt)
  const retentionMs = prompt.eventId ? CALENDAR_PROMPT_RETENTION_MS : AD_HOC_PROMPT_RETENTION_MS
  const previous = deliveredAt[key]
  if (previous !== undefined && nowMs - previous < retentionMs) {
    return {
      state: nextState,
      prompt: null,
      ...(matchedCalendarEventId ? { matchedCalendarEventId } : {})
    }
  }

  return {
    state: {
      ...nextState,
      deliveredAt: { ...deliveredAt, [key]: nowMs }
    },
    prompt,
    ...(matchedCalendarEventId ? { matchedCalendarEventId } : {})
  }
}

function matchingCalendarEvent(
  events: readonly CalendarEvent[],
  nowMs: number
): CalendarEvent | null {
  const candidates = events
    .filter((event) => {
      if (event.isAllDay || event.id.length === 0) return false
      const startMs = Date.parse(event.startIso)
      const endMs = Date.parse(event.endIso)
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false
      return endMs >= nowMs && startMs <= nowMs + MIC_CALENDAR_MATCH_LOOKAHEAD_MS
    })
    .sort((a, b) => {
      const aDistance = Math.abs(Date.parse(a.startIso) - nowMs)
      const bDistance = Math.abs(Date.parse(b.startIso) - nowMs)
      return aDistance - bDistance
    })
  return candidates[0] ?? null
}

function promptKey(prompt: CalendarStartMeetingEvent): string {
  if (prompt.eventId) return `calendar:${prompt.eventId}`
  return `adhoc:${prompt.subject.trim().toLowerCase() || 'meeting'}`
}

function pruneDelivered(
  deliveredAt: Readonly<Record<string, number>>,
  nowMs: number
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, at] of Object.entries(deliveredAt)) {
    const retentionMs = key.startsWith('calendar:')
      ? CALENDAR_PROMPT_RETENTION_MS
      : AD_HOC_PROMPT_RETENTION_MS
    if (Number.isFinite(at) && nowMs - at < retentionMs) out[key] = at
  }
  return out
}
