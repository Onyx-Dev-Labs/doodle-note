/**
 * Shared Microsoft 365 calendar IPC contract, used by main + preload + renderer.
 *
 * The main process owns the whole integration — MSAL auth (tokens encrypted
 * via safeStorage, never plaintext on disk), Microsoft Graph polling and the
 * meeting-start watcher. The renderer only ever sees CalendarState snapshots
 * and the two push channels below. Errors travel as strings inside
 * CalendarState; IPC calls never reject.
 */

export const CALENDAR_GET_STATE_CHANNEL = 'calendar:get-state'
export const CALENDAR_SET_CONFIG_CHANNEL = 'calendar:set-config'
export const CALENDAR_CONNECT_CHANNEL = 'calendar:connect'
export const CALENDAR_DISCONNECT_CHANNEL = 'calendar:disconnect'
export const CALENDAR_REFRESH_CHANNEL = 'calendar:refresh'
/** main → renderer: full CalendarState after every refresh / auth change. */
export const CALENDAR_EVENTS_CHANNEL = 'calendar:events'
/** main → renderer: a meeting is starting (banner prompt or notification click). */
export const CALENDAR_START_MEETING_CHANNEL = 'calendar:start-meeting'

/** One upcoming event, normalized from Microsoft Graph. */
export interface CalendarEvent {
  /** Graph event id (opaque, can be long). */
  id: string
  subject: string
  /** Absolute instants (UTC ISO); render in local time. */
  startIso: string
  endIso: string
  isAllDay: boolean
  isOnlineMeeting: boolean
  /** Teams/other join link when isOnlineMeeting. */
  joinUrl?: string
  location?: string
  /** Organizer display name (or address). */
  organizer?: string
}

export interface CalendarAccount {
  /** Email shown as "Connected as <email>" (from Graph /me). */
  email: string
  name?: string
}

/** The one snapshot the renderer works from. */
export interface CalendarState {
  /** A registration is available (built-in, or saved Client/Tenant IDs). */
  configured: boolean
  /** True when the app ships with a built-in registration — Settings shows one-click sign-in. */
  builtIn?: boolean
  /** Saved app-registration ids (not secrets), echoed so Settings can prefill. */
  clientId?: string
  tenantId?: string
  signedIn: boolean
  account?: CalendarAccount
  /** Next 7 days, soonest first. Empty when signed out. */
  events: CalendarEvent[]
  lastSyncIso?: string
  /** Human-readable auth/sync problem, surfaced inline in Settings. */
  error?: string
}

export interface CalendarConfigUpdate {
  clientId: string
  tenantId: string
}

/** Payload of CALENDAR_START_MEETING_CHANNEL. */
export interface CalendarStartMeetingEvent {
  /**
   * 'prompt' — show the in-app banner (watcher fired; the user hasn't acted).
   * 'start'  — create the meeting and start recording now (the user clicked
   *            the OS notification).
   */
  action: 'prompt' | 'start'
  eventId: string
  subject: string
  startIso: string
}

/** API surface exposed on `window.calendar` by the preload script. */
export interface CalendarApi {
  getState(): Promise<CalendarState>
  setConfig(config: CalendarConfigUpdate): Promise<CalendarState>
  /** Runs the interactive Microsoft 365 sign-in (system browser). */
  connect(): Promise<CalendarState>
  /** Signs out and clears cached tokens + events. */
  disconnect(): Promise<CalendarState>
  /** Manual "Sync now". */
  refresh(): Promise<CalendarState>
  onEvents(cb: (state: CalendarState) => void): () => void
  onStartMeeting(cb: (ev: CalendarStartMeetingEvent) => void): () => void
}
