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
export const CALENDAR_SET_PREFS_CHANNEL = 'calendar:set-prefs'
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
  /** Graph id of the calendar this event came from ('' for legacy cache entries). */
  calendarId: string
  /** Accent color inherited from the owning calendar (resolved hex). */
  colorHex?: string
  /** True when the event has invitees or a video link (attendees or isOnlineMeeting). */
  hasParticipants: boolean
  /** Teams/other join link when isOnlineMeeting. */
  joinUrl?: string
  location?: string
  /** Organizer display name (or address). */
  organizer?: string
}

/** One calendar from GET /me/calendars, normalized. */
export interface CalendarInfo {
  id: string
  name: string
  /** Resolved accent hex (Graph hexColor, or a mapped named color, or the sage fallback). */
  colorHex: string
  /** Graph isDefaultCalendar — the user's primary calendar. */
  isDefault: boolean
  canEdit: boolean
}

/** User-tweakable calendar display preferences (calendar-settings.json). */
export interface CalendarPrefs {
  /** Show the next meeting in the macOS menu bar (default true). */
  showMenuBar: boolean
  /** Include events without participants or a video link in "Coming up" (default true). */
  showNoParticipants: boolean
  /** Calendars shown in "Coming up"; null = the default calendar only. */
  visibleCalendarIds: string[] | null
}

/** Partial prefs update sent over CALENDAR_SET_PREFS_CHANNEL. */
export type CalendarPrefsUpdate = Partial<CalendarPrefs>

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = {
  showMenuBar: true,
  showNoParticipants: true,
  visibleCalendarIds: null
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
  /**
   * Next 14 days across the visible calendars, soonest first, already
   * filtered by the no-participants pref. Empty when signed out.
   */
  events: CalendarEvent[]
  /** The account's calendars (GET /me/calendars). Empty when signed out. */
  calendars: CalendarInfo[]
  /** Display preferences; always present (defaults when never saved). */
  prefs: CalendarPrefs
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
  /** Partial display-prefs update; persists and rebroadcasts. */
  setPrefs(update: CalendarPrefsUpdate): Promise<CalendarState>
  /** Runs the interactive Microsoft 365 sign-in (system browser). */
  connect(): Promise<CalendarState>
  /** Signs out and clears cached tokens + events. */
  disconnect(): Promise<CalendarState>
  /** Manual "Sync now". */
  refresh(): Promise<CalendarState>
  onEvents(cb: (state: CalendarState) => void): () => void
  onStartMeeting(cb: (ev: CalendarStartMeetingEvent) => void): () => void
}
