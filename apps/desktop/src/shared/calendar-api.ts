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
export const CALENDAR_CONNECT_GOOGLE_CHANNEL = 'calendar:connect-google'
export const CALENDAR_DISCONNECT_GOOGLE_CHANNEL = 'calendar:disconnect-google'
export const CALENDAR_DISMISS_PROMPT_CHANNEL = 'calendar:dismiss-prompt'
export const CALENDAR_REFRESH_CHANNEL = 'calendar:refresh'
export const CALENDAR_ACCOUNT_CONNECT_CHANNEL = 'calendar:account-connect'
export const CALENDAR_ACCOUNT_REMOVE_CHANNEL = 'calendar:account-remove'
export const CALENDAR_AUTH_CANCEL_CHANNEL = 'calendar:auth-cancel'
/** main → renderer: full CalendarState after every refresh / auth change. */
export const CALENDAR_EVENTS_CHANNEL = 'calendar:events'
/** main → renderer: a meeting is starting (banner prompt or notification click). */
export const CALENDAR_START_MEETING_CHANNEL = 'calendar:start-meeting'

/** One upcoming event, normalized from a connected calendar provider. */
export interface CalendarEvent {
  sourceLabel?: string
  stale?: boolean
  /** Explicit source ownership; absent only in pre-account cache fixtures. */
  accountId?: string
  provider?: CalendarProvider
  providerEventId?: string
  /** Original occurrence identity, independent of its current scheduled time. */
  occurrenceId?: string
  /** Proven legacy note reference, supplied only for an unambiguous migration. */
  legacyEventId?: string
  /** Opaque canonical event key; raw only in legacy input. */
  id: string
  subject: string
  /** Absolute instants (UTC ISO); render in local time. */
  startIso: string
  endIso: string
  isAllDay: boolean
  isOnlineMeeting: boolean
  /** Canonical source calendar key ('' in some legacy cache entries). */
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
  accountId?: string
  provider?: CalendarProvider
  providerCalendarId?: string
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
  /** Full Island shows today’s next meeting beside the dog; false = Compact. */
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

export type CalendarProvider = 'microsoft' | 'google'

/** No credentials or provider token claims cross IPC. */
export interface CalendarConnection extends CalendarAccount {
  id: string
  provider: CalendarProvider
  syncing?: boolean
  error?: string
  lastSyncIso?: string
  stale?: boolean
}

/** The one snapshot the renderer works from. */
export interface CalendarState {
  connections?: CalendarConnection[]
  connecting?: { provider: CalendarProvider; accountId?: string }
  googleAvailable?: boolean
  /** A registration is available (built-in, or saved Client/Tenant IDs). */
  configured: boolean
  /** True when the app ships with a built-in registration — Settings shows one-click sign-in. */
  builtIn?: boolean
  /** Saved app-registration ids (not secrets), echoed so Settings can prefill. */
  clientId?: string
  tenantId?: string
  /** Any provider connected (gates events/calendars/prefs display). */
  signedIn: boolean
  /** Microsoft 365 specifically. */
  msSignedIn: boolean
  /** Google Calendar specifically. */
  googleSignedIn: boolean
  account?: CalendarAccount
  googleAccount?: CalendarAccount
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
  /** Main-owned normalized link used to label the pre-meeting action. */
  joinUrl?: string
  /** Explicit pre-meeting activation; Home Take notes leaves this false. */
  joinRequested?: boolean
  sourceLabel?: string
  legacyEventId?: string
  /**
   * 'prompt' — show the in-app banner (watcher fired; the user hasn't acted).
   * 'start'   — create the meeting and start recording now (the user clicked
   *             the OS notification).
   * 'dismiss' — clear any visible prompt because recording started elsewhere.
   */
  action: 'prompt' | 'start' | 'dismiss'
  /** Empty for ad-hoc (mic-detected) meetings — no calendar event to link. */
  eventId: string
  subject: string
  startIso: string
  /** True when detected from mic activity rather than the calendar. */
  adHoc?: boolean
  /** Local identity of a distinct microphone-detected call, when available. */
  detectionId?: string
}

/** API surface exposed on `window.calendar` by the preload script. */
export interface CalendarApi {
  connectAccount(provider: CalendarProvider, accountId?: string): Promise<CalendarState>
  removeAccount(accountId: string): Promise<CalendarState>
  cancelAuth(): Promise<CalendarState>
  getState(): Promise<CalendarState>
  setConfig(config: CalendarConfigUpdate): Promise<CalendarState>
  /** Partial display-prefs update; persists and rebroadcasts. */
  setPrefs(update: CalendarPrefsUpdate): Promise<CalendarState>
  /** Runs the interactive Microsoft 365 sign-in (system browser). */
  connect(): Promise<CalendarState>
  /** Signs out and clears cached tokens + events. */
  disconnect(): Promise<CalendarState>
  /** Interactive Google sign-in (system browser, loopback + PKCE). */
  connectGoogle(): Promise<CalendarState>
  /** Disconnects Google Calendar only; Microsoft (if any) stays. */
  disconnectGoogle(): Promise<CalendarState>
  /** Manual "Sync now". */
  refresh(): Promise<CalendarState>
  dismissPrompt(): Promise<void>
  onEvents(cb: (state: CalendarState) => void): () => void
  onStartMeeting(cb: (ev: CalendarStartMeetingEvent) => void): () => void
}

/** Calendar metadata may contain arbitrary text; only ordinary HTTPS meeting links are actionable. */
export function calendarJoinUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
