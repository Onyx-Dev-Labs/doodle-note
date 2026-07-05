import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type ICachePlugin
} from '@azure/msal-node'
import {
  CALENDAR_CONNECT_CHANNEL,
  CALENDAR_DISCONNECT_CHANNEL,
  CALENDAR_EVENTS_CHANNEL,
  CALENDAR_GET_STATE_CHANNEL,
  CALENDAR_REFRESH_CHANNEL,
  CALENDAR_SET_CONFIG_CHANNEL,
  CALENDAR_START_MEETING_CHANNEL,
  type CalendarAccount,
  type CalendarConfigUpdate,
  type CalendarEvent,
  type CalendarStartMeetingEvent,
  type CalendarState
} from '../shared/calendar-api'
import { BUILT_IN_MS_CLIENT_ID, BUILT_IN_MS_TENANT } from '../shared/ms-app'
import { eventsToPromptNow, pruneNotified } from './calendar-watcher'

/** Delegated Graph permissions; offline_access keeps the refresh token. */
const SCOPES = ['User.Read', 'Calendars.Read', 'offline_access']
/** Poll Graph for the upcoming week this often while signed in. */
const POLL_INTERVAL_MS = 5 * 60_000
/** Meeting-start watcher cadence. */
const WATCH_INTERVAL_MS = 30_000
/** Window-focus refreshes are skipped when the last sync is this fresh. */
const FOCUS_REFRESH_MIN_GAP_MS = 60_000
/** Give up waiting for the browser sign-in after this long. */
const CONNECT_TIMEOUT_MS = 5 * 60_000
/** How far ahead the "Coming up" card looks. */
const LOOKAHEAD_DAYS = 7

/**
 * Branded landing pages served by the local OAuth redirect during sign-in.
 * Full documents with an explicit UTF-8 charset — without it, browsers guess
 * the encoding and the emoji renders as mojibake.
 */
function landingPage(title: string, message: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DoodleNote</title></head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;' +
    'background:#f7f5ee;color:#26281f;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;margin:0">' +
    '<div style="text-align:center;max-width:440px;padding:0 24px">' +
    '<div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;margin-bottom:26px">' +
    '<span style="color:#26281f">Doodle</span><span style="color:#7c9769">Note</span></div>' +
    '<h2 style="margin:0 0 10px;font-family:ui-serif,Georgia,serif;font-size:26px">' + title + '</h2>' +
    '<p style="color:#8a8d7f;line-height:1.55;margin:0">' + message + '</p>' +
    '<div style="margin-top:30px;font-size:12px;color:#b4b6a8">Local &amp; private &middot; ' +
    'your calendar stays on your Mac</div>' +
    '</div></body></html>'
  )
}

const SUCCESS_TEMPLATE = landingPage(
  'You&rsquo;re connected &#127881;',
  'DoodleNote is linked to your Microsoft&nbsp;365 calendar. You can close this tab and head back to the app.'
)

const ERROR_TEMPLATE = landingPage(
  'Sign-in didn&rsquo;t finish',
  'Something interrupted the Microsoft sign-in. Head back to DoodleNote and try again from Settings &rarr; Calendar.'
)

interface StoredCalendarConfig {
  clientId: string
  tenantId: string
}

/** What lands in userData/calendar-cache.json (no secrets, ever). */
interface StoredCalendarCache {
  events: CalendarEvent[]
  lastSyncIso?: string
  account?: CalendarAccount
}

export type CalendarBroadcast = (channel: string, payload: unknown) => void

/**
 * Owns the Microsoft 365 calendar integration in the main process:
 *
 * - MSAL public-client auth (auth-code + PKCE against a loopback redirect via
 *   acquireTokenInteractive; the system browser is opened with
 *   shell.openExternal). The MSAL token cache persists to
 *   userData/calendar-token-cache, encrypted with safeStorage — plaintext
 *   tokens never touch disk. Refresh is silent; interactive only on Connect.
 * - Graph /me/calendarview polling (next 7 days) every 5 minutes while signed
 *   in, plus on connect and window focus; results are cached in memory and in
 *   userData/calendar-cache.json so the Home card fills instantly on boot.
 * - A 30s meeting-start watcher (pure decision logic in calendar-watcher.ts)
 *   that fires an OS notification + a renderer broadcast; notified event ids
 *   persist in userData/calendar-notified.json.
 *
 * Every IPC entry point resolves to a CalendarState — errors are strings on
 * that state, never rejected promises.
 */
export class CalendarService {
  private readonly settingsPath: string
  private readonly tokenCachePath: string
  private readonly eventCachePath: string
  private readonly notifiedPath: string

  private config: StoredCalendarConfig | null
  private pca: PublicClientApplication | null = null
  private account: AccountInfo | null = null
  private accountView: CalendarAccount | null = null
  private events: CalendarEvent[] = []
  private lastSyncIso: string | undefined
  private lastError: string | undefined
  private notified: Record<string, string>

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private connectBusy = false
  private refreshBusy = false
  private disposed = false

  /** Boot-time account restore; IPC handlers await this before answering. */
  private readonly ready: Promise<void>

  constructor(
    userDataDir: string,
    private readonly broadcast: CalendarBroadcast,
    /** Bring the app forward (or recreate the window) on notification click. */
    private readonly focusWindow: () => void
  ) {
    this.settingsPath = join(userDataDir, 'calendar-settings.json')
    this.tokenCachePath = join(userDataDir, 'calendar-token-cache')
    this.eventCachePath = join(userDataDir, 'calendar-cache.json')
    this.notifiedPath = join(userDataDir, 'calendar-notified.json')
    this.config = this.loadConfig()
    this.notified = this.loadNotified()
    const cache = this.loadEventCache()
    this.events = cache.events
    this.lastSyncIso = cache.lastSyncIso
    this.accountView = cache.account ?? null
    this.ready = this.bootstrap()
  }

  registerIpc(): void {
    ipcMain.handle(CALENDAR_GET_STATE_CHANNEL, async () => {
      await this.ready
      return this.state()
    })
    ipcMain.handle(CALENDAR_SET_CONFIG_CHANNEL, async (_event, update: unknown) => {
      await this.ready
      return this.setConfig((update ?? {}) as Partial<CalendarConfigUpdate>)
    })
    ipcMain.handle(CALENDAR_CONNECT_CHANNEL, async () => {
      await this.ready
      return this.connect()
    })
    ipcMain.handle(CALENDAR_DISCONNECT_CHANNEL, async () => {
      await this.ready
      return this.disconnect()
    })
    ipcMain.handle(CALENDAR_REFRESH_CHANNEL, async () => {
      await this.ready
      await this.refreshEvents()
      return this.state()
    })
  }

  /** App-level focus hook: refresh, but never hammer Graph on tab-outs. */
  onWindowFocus(): void {
    void this.ready.then(() => {
      if (!this.account) return
      const last = this.lastSyncIso ? Date.parse(this.lastSyncIso) : 0
      if (Date.now() - last < FOCUS_REFRESH_MIN_GAP_MS) return
      void this.refreshEvents()
    })
  }

  dispose(): void {
    this.disposed = true
    this.stopTimers()
  }

  /* ---- state ---- */

  private state(): CalendarState {
    const signedIn = this.account !== null
    return {
      configured: this.effectiveConfig() !== null,
      builtIn: BUILT_IN_MS_CLIENT_ID.length > 0,
      ...(this.config ? { clientId: this.config.clientId, tenantId: this.config.tenantId } : {}),
      signedIn,
      ...(signedIn && this.accountView ? { account: this.accountView } : {}),
      events: signedIn ? this.events : [],
      ...(this.lastSyncIso ? { lastSyncIso: this.lastSyncIso } : {}),
      ...(this.lastError ? { error: this.lastError } : {})
    }
  }

  private broadcastState(): void {
    this.broadcast(CALENDAR_EVENTS_CHANNEL, this.state())
  }

  /**
   * The registration to authenticate against: a user-saved custom config
   * wins; otherwise the built-in DoodleNote registration (when compiled in).
   */
  private effectiveConfig(): StoredCalendarConfig | null {
    if (this.config) return this.config
    if (BUILT_IN_MS_CLIENT_ID.length > 0) {
      return { clientId: BUILT_IN_MS_CLIENT_ID, tenantId: BUILT_IN_MS_TENANT }
    }
    return null
  }

  /* ---- boot ---- */

  /** Rebuild the MSAL client and adopt a cached account, if any. */
  private async bootstrap(): Promise<void> {
    const config = this.effectiveConfig()
    if (!config) return
    try {
      this.pca = this.buildClient(config)
      const accounts = await this.pca.getTokenCache().getAllAccounts()
      this.account = accounts[0] ?? null
      if (this.account) {
        if (!this.accountView) {
          this.accountView = { email: this.account.username }
        }
        this.startTimers()
        // Cached events already serve the UI; fetch fresh ones in the
        // background without holding up the first getState().
        void this.refreshEvents()
      }
    } catch (err) {
      this.pca = null
      this.account = null
      this.lastError = friendlyError(err)
    }
  }

  private buildClient(config: StoredCalendarConfig): PublicClientApplication {
    return new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`
      },
      cache: { cachePlugin: this.cachePlugin() }
    })
  }

  /* ---- config ---- */

  private setConfig(update: Partial<CalendarConfigUpdate>): CalendarState {
    const clientId = typeof update.clientId === 'string' ? update.clientId.trim() : ''
    const tenantId = typeof update.tenantId === 'string' ? update.tenantId.trim() : ''
    if (!/^[A-Za-z0-9.-]{1,120}$/.test(clientId)) {
      this.lastError = 'That Client ID doesn’t look right — paste the Application (client) ID.'
      return this.state()
    }
    if (!/^[A-Za-z0-9.-]{1,120}$/.test(tenantId)) {
      this.lastError = 'That Tenant ID doesn’t look right — paste the Directory (tenant) ID.'
      return this.state()
    }

    // A valid save is a fresh start — stale validation/auth errors clear.
    this.lastError = undefined
    const changed = this.config?.clientId !== clientId || this.config?.tenantId !== tenantId
    if (changed) {
      // Tokens are minted per app registration — a new one starts signed out.
      this.forgetSession()
      this.config = { clientId, tenantId }
      this.saveConfig()
      try {
        this.pca = this.buildClient(this.config)
      } catch (err) {
        this.pca = null
        this.lastError = friendlyError(err)
      }
    }
    this.broadcastState()
    return this.state()
  }

  /* ---- auth ---- */

  private async connect(): Promise<CalendarState> {
    const config = this.effectiveConfig()
    if (!config) {
      this.lastError = 'Add your Client ID and Tenant ID first, then hit Save.'
      return this.state()
    }
    if (!this.pca) {
      this.pca = this.buildClient(config)
    }
    if (this.connectBusy) {
      this.lastError = 'A sign-in is already in progress — finish it in your browser.'
      return this.state()
    }
    this.connectBusy = true
    this.lastError = undefined
    try {
      // MSAL's interactive helper does the whole dance: PKCE (S256), a
      // loopback http server on 127.0.0.1:<random port> (redirect URI
      // http://localhost:<port> — Entra treats loopback ports as equivalent),
      // then the code exchange. We only supply the browser opener.
      const flow = this.pca.acquireTokenInteractive({
        scopes: SCOPES,
        openBrowser: async (url) => {
          await shell.openExternal(url)
        },
        successTemplate: SUCCESS_TEMPLATE,
        errorTemplate: ERROR_TEMPLATE
      })
      const result = await withTimeout(flow, CONNECT_TIMEOUT_MS)
      if (result === 'timeout') {
        // The loopback server lingers until the flow completes or the app
        // quits; if the user finishes late, adopt the session then.
        void flow.then((late) => this.adoptSession(late)).catch(() => {})
        this.lastError = 'Sign-in timed out — hit Connect to try again.'
        return this.state()
      }
      await this.adoptSession(result)
      return this.state()
    } catch (err) {
      this.lastError = friendlyError(err)
      return this.state()
    } finally {
      this.connectBusy = false
    }
  }

  /** Land a completed interactive sign-in: account, /me identity, first sync. */
  private async adoptSession(result: AuthenticationResult): Promise<void> {
    if (this.disposed) return
    this.account = result.account ?? (await this.allAccounts())[0] ?? null
    if (!this.account) {
      this.lastError = 'Signed in, but Microsoft returned no account — try Connect again.'
      return
    }
    this.lastError = undefined
    this.accountView = { email: this.account.username }
    await this.fetchIdentity(result.accessToken)
    this.startTimers()
    await this.refreshEvents()
  }

  private async allAccounts(): Promise<AccountInfo[]> {
    try {
      return this.pca ? await this.pca.getTokenCache().getAllAccounts() : []
    } catch {
      return []
    }
  }

  private async disconnect(): Promise<CalendarState> {
    this.stopTimers()
    try {
      if (this.pca && this.account) {
        await this.pca.signOut({ account: this.account })
      }
    } catch {
      // Cache cleanup below still runs.
    }
    this.forgetSession()
    this.broadcastState()
    return this.state()
  }

  /** Drop every trace of the signed-in session (tokens, events, identity). */
  private forgetSession(): void {
    this.account = null
    this.accountView = null
    this.events = []
    this.lastSyncIso = undefined
    this.lastError = undefined
    this.stopTimers()
    for (const path of [this.tokenCachePath, this.eventCachePath]) {
      try {
        rmSync(path, { force: true })
      } catch {
        // Best effort — a stale cache file is harmless next to a cleared account.
      }
    }
  }

  /** Silent token first; a null return means the user must reconnect. */
  private async getAccessToken(): Promise<string | null> {
    if (!this.pca || !this.account) return null
    try {
      const result = await this.pca.acquireTokenSilent({ account: this.account, scopes: SCOPES })
      return result.accessToken
    } catch {
      this.lastError =
        'Your Microsoft 365 session expired — open Settings and hit Connect to sign in again.'
      return null
    }
  }

  /** "Connected as <email>" comes from Graph /me, not the token claims. */
  private async fetchIdentity(accessToken: string): Promise<void> {
    try {
      const res = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) return
      const me = (await res.json()) as {
        displayName?: unknown
        mail?: unknown
        userPrincipalName?: unknown
      }
      const email =
        typeof me.mail === 'string' && me.mail
          ? me.mail
          : typeof me.userPrincipalName === 'string'
            ? me.userPrincipalName
            : ''
      if (email) {
        this.accountView = {
          email,
          ...(typeof me.displayName === 'string' && me.displayName ? { name: me.displayName } : {})
        }
      }
    } catch {
      // Keep the token-claim username; /me is a nicety.
    }
  }

  /* ---- token cache (safeStorage-encrypted, like notes-service API keys) ---- */

  private cachePlugin(): ICachePlugin {
    return {
      beforeCacheAccess: async (context) => {
        const data = this.readTokenCache()
        if (data !== null) context.tokenCache.deserialize(data)
      },
      afterCacheAccess: async (context) => {
        if (context.cacheHasChanged) this.writeTokenCache(context.tokenCache.serialize())
      }
    }
  }

  private readTokenCache(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(readFileSync(this.tokenCachePath))
    } catch {
      return null // no cache yet, or the keychain changed — signed out
    }
  }

  private writeTokenCache(serialized: string): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        // Never fall back to plaintext tokens on disk.
        console.error('[calendar] safeStorage unavailable — token cache not persisted')
        return
      }
      mkdirSync(dirname(this.tokenCachePath), { recursive: true })
      writeFileSync(this.tokenCachePath, safeStorage.encryptString(serialized))
    } catch (err) {
      console.error('[calendar] failed to persist token cache:', err)
    }
  }

  /* ---- Graph polling ---- */

  private async refreshEvents(): Promise<void> {
    if (this.refreshBusy || !this.account) return
    this.refreshBusy = true
    try {
      const token = await this.getAccessToken()
      if (token === null) return // lastError already explains
      const events = await this.fetchCalendarView(token)
      this.events = events
      this.lastSyncIso = new Date().toISOString()
      this.lastError = undefined
      this.saveEventCache()
      // Catch an already-imminent meeting without waiting for the next tick.
      this.checkMeetingStarts()
    } catch (err) {
      this.lastError = friendlyError(err)
    } finally {
      this.refreshBusy = false
      this.broadcastState()
    }
  }

  private async fetchCalendarView(accessToken: string): Promise<CalendarEvent[]> {
    const now = new Date()
    const end = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000)
    const timeZone = systemTimeZone()
    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
      $select: 'subject,start,end,isAllDay,isOnlineMeeting,onlineMeeting,location,organizer',
      $orderby: 'start/dateTime',
      $top: '50'
    })
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarview?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: `outlook.timezone="${timeZone}"`
      }
    })
    if (!res.ok) {
      throw new Error(await graphErrorMessage(res))
    }
    const body = (await res.json()) as { value?: unknown }
    const items = Array.isArray(body.value) ? body.value : []
    const events: CalendarEvent[] = []
    for (const item of items) {
      const event = normalizeGraphEvent(item)
      if (event) events.push(event)
    }
    events.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
    return events
  }

  /* ---- meeting-start watcher ---- */

  private checkMeetingStarts(): void {
    const nowMs = Date.now()
    const beforePrune = Object.keys(this.notified).length
    this.notified = pruneNotified(this.notified, nowMs)
    const due = eventsToPromptNow(this.events, nowMs, new Set(Object.keys(this.notified)))
    if (due.length === 0) {
      // Persist only when the prune actually dropped something — this runs
      // every 30s and must not grind the disk.
      if (Object.keys(this.notified).length !== beforePrune) this.saveNotified()
      return
    }
    for (const watchable of due) {
      this.notified[watchable.id] = new Date(nowMs).toISOString()
      const event = this.events.find((e) => e.id === watchable.id)
      const payload: CalendarStartMeetingEvent = {
        action: 'prompt',
        eventId: watchable.id,
        subject: (event?.subject ?? '').trim() || 'Untitled meeting',
        startIso: watchable.startIso
      }
      // The banner broadcast is the guaranteed path; the OS notification and
      // dock bounce are best-effort attention-getters on top.
      this.broadcast(CALENDAR_START_MEETING_CHANNEL, payload)
      this.showNotification(payload)
      try {
        app.dock?.bounce('informational')
      } catch {
        // Not on macOS, or no dock — the banner already covers it.
      }
    }
    this.saveNotified()
  }

  private showNotification(prompt: CalendarStartMeetingEvent): void {
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title: `${prompt.subject} is starting`,
        body: 'Click to start taking notes'
      })
      notification.on('click', () => {
        const payload = { ...prompt, action: 'start' as const }
        const hadWindow = BrowserWindow.getAllWindows().length > 0
        this.focusWindow()
        if (hadWindow) {
          // One click = meeting created + recording, handled by the renderer.
          this.broadcast(CALENDAR_START_MEETING_CHANNEL, payload)
        } else {
          // focusWindow just created the window — wait for the renderer to
          // load (plus a beat for React to attach listeners) before sending.
          const window = BrowserWindow.getAllWindows()[0]
          window?.webContents.once('did-finish-load', () => {
            setTimeout(() => this.broadcast(CALENDAR_START_MEETING_CHANNEL, payload), 400)
          })
        }
      })
      notification.show()
    } catch (err) {
      // Notifications can be unreliable (e.g. unsigned dev builds) — the
      // in-app banner is the guaranteed path.
      console.error('[calendar] notification failed:', err)
    }
  }

  /* ---- timers ---- */

  private startTimers(): void {
    if (this.disposed) return
    if (this.pollTimer === null) {
      this.pollTimer = setInterval(() => void this.refreshEvents(), POLL_INTERVAL_MS)
      this.pollTimer.unref?.()
    }
    if (this.watchTimer === null) {
      this.watchTimer = setInterval(() => this.checkMeetingStarts(), WATCH_INTERVAL_MS)
      this.watchTimer.unref?.()
    }
  }

  private stopTimers(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.watchTimer !== null) {
      clearInterval(this.watchTimer)
      this.watchTimer = null
    }
  }

  /* ---- disk (all best-effort; corrupt files read as empty) ---- */

  private loadConfig(): StoredCalendarConfig | null {
    try {
      const raw = JSON.parse(
        readFileSync(this.settingsPath, 'utf8')
      ) as Partial<StoredCalendarConfig>
      if (
        typeof raw.clientId === 'string' &&
        raw.clientId.length > 0 &&
        typeof raw.tenantId === 'string' &&
        raw.tenantId.length > 0
      ) {
        return { clientId: raw.clientId, tenantId: raw.tenantId }
      }
      return null
    } catch {
      return null // not configured yet
    }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.settingsPath, JSON.stringify(this.config, null, 2))
    } catch (err) {
      console.error('[calendar] failed to save settings:', err)
    }
  }

  private loadEventCache(): StoredCalendarCache {
    try {
      const raw = JSON.parse(
        readFileSync(this.eventCachePath, 'utf8')
      ) as Partial<StoredCalendarCache>
      const events = Array.isArray(raw.events)
        ? raw.events.filter(isStoredCalendarEvent).filter((e) => Date.parse(e.endIso) > Date.now())
        : []
      return {
        events,
        ...(typeof raw.lastSyncIso === 'string' ? { lastSyncIso: raw.lastSyncIso } : {}),
        ...(raw.account && typeof raw.account.email === 'string'
          ? {
              account: {
                email: raw.account.email,
                ...(typeof raw.account.name === 'string' ? { name: raw.account.name } : {})
              }
            }
          : {})
      }
    } catch {
      return { events: [] } // no cache yet
    }
  }

  private saveEventCache(): void {
    try {
      const cache: StoredCalendarCache = {
        events: this.events,
        ...(this.lastSyncIso ? { lastSyncIso: this.lastSyncIso } : {}),
        ...(this.accountView ? { account: this.accountView } : {})
      }
      writeFileSync(this.eventCachePath, JSON.stringify(cache, null, 2))
    } catch (err) {
      console.error('[calendar] failed to save event cache:', err)
    }
  }

  private loadNotified(): Record<string, string> {
    try {
      const raw = JSON.parse(readFileSync(this.notifiedPath, 'utf8'))
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
      const out: Record<string, string> = {}
      for (const [id, iso] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof iso === 'string') out[id] = iso
      }
      return pruneNotified(out, Date.now())
    } catch {
      return {} // nothing notified yet
    }
  }

  private saveNotified(): void {
    try {
      writeFileSync(this.notifiedPath, JSON.stringify(this.notified, null, 2))
    } catch (err) {
      console.error('[calendar] failed to save notified ids:', err)
    }
  }
}

/* ---- helpers ---- */

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Graph (with `Prefer: outlook.timezone`) returns wall-clock datetimes with a
 * 7-digit fraction and no offset, e.g. "2026-07-06T09:00:00.0000000". Since
 * we asked for the system timezone, parsing as local time yields the right
 * instant; store it as a UTC ISO string for the renderer.
 */
function graphDateTimeToIso(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const dateTime = (value as { dateTime?: unknown }).dateTime
  if (typeof dateTime !== 'string' || dateTime.length === 0) return null
  const trimmed = dateTime.replace(/(\.\d{3})\d+/, '$1')
  const ms = new Date(trimmed).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function normalizeGraphEvent(item: unknown): CalendarEvent | null {
  if (typeof item !== 'object' || item === null) return null
  const raw = item as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const startIso = graphDateTimeToIso(raw.start)
  const endIso = graphDateTimeToIso(raw.end)
  if (startIso === null || endIso === null) return null

  const online = raw.onlineMeeting as { joinUrl?: unknown } | null | undefined
  const joinUrl =
    online && typeof online.joinUrl === 'string' && /^https:\/\//i.test(online.joinUrl)
      ? online.joinUrl
      : undefined
  const location = raw.location as { displayName?: unknown } | null | undefined
  const organizer = raw.organizer as
    { emailAddress?: { name?: unknown; address?: unknown } } | null | undefined
  const organizerName =
    organizer && organizer.emailAddress
      ? typeof organizer.emailAddress.name === 'string' && organizer.emailAddress.name
        ? organizer.emailAddress.name
        : typeof organizer.emailAddress.address === 'string'
          ? organizer.emailAddress.address
          : undefined
      : undefined

  return {
    id: raw.id,
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    startIso,
    endIso,
    isAllDay: raw.isAllDay === true,
    isOnlineMeeting: raw.isOnlineMeeting === true,
    ...(joinUrl ? { joinUrl } : {}),
    ...(location && typeof location.displayName === 'string' && location.displayName
      ? { location: location.displayName }
      : {}),
    ...(organizerName ? { organizer: organizerName } : {})
  }
}

function isStoredCalendarEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Partial<CalendarEvent>
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.subject === 'string' &&
    typeof e.startIso === 'string' &&
    Number.isFinite(Date.parse(e.startIso)) &&
    typeof e.endIso === 'string' &&
    Number.isFinite(Date.parse(e.endIso)) &&
    typeof e.isAllDay === 'boolean' &&
    typeof e.isOnlineMeeting === 'boolean'
  )
}

async function graphErrorMessage(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.message === 'string') detail = body.error.message
  } catch {
    // Non-JSON error body — the status code is enough.
  }
  if (res.status === 401) {
    return 'Microsoft 365 rejected the session — open Settings and hit Connect to sign in again.'
  }
  if (res.status === 403) {
    return 'Microsoft 365 denied calendar access — your admin may need to grant the Calendars.Read permission.'
  }
  if (res.status === 429) {
    return 'Microsoft is rate-limiting calendar syncs — DoodleNote will retry shortly.'
  }
  return `Calendar sync failed (HTTP ${res.status})${detail ? `: ${clip(detail)}` : ''}`
}

/** Turn auth/network failures into one calm sentence for the Settings card. */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/AADSTS700016|unauthorized_client/i.test(message)) {
    return 'Microsoft didn’t recognize that Client ID — double-check the app registration.'
  }
  if (/AADSTS90002|invalid_tenant|Tenant .* not found/i.test(message)) {
    return 'Microsoft didn’t recognize that Tenant ID — check it in the Entra admin center.'
  }
  if (/AADSTS65001|consent_required/i.test(message)) {
    return 'Your organization requires admin consent for DoodleNote — ask your Entra admin to approve it.'
  }
  if (/access_denied|user_cancelled|cancell?ed/i.test(message)) {
    return 'Sign-in was cancelled before it finished.'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return 'Couldn’t reach Microsoft — check your internet connection and try again.'
  }
  return clip(message.split('\n')[0] ?? 'Something went wrong talking to Microsoft 365.')
}

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 220 ? `${trimmed.slice(0, 219)}…` : trimmed
}
