import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { safeStorage, shell } from 'electron'
import { BUILT_IN_GOOGLE_CLIENT_ID } from '../shared/google-app'
import { googleClientSecret, googleConfigurationError, googleTokenError } from './google-oauth'
import type { CalendarAccount, CalendarEvent, CalendarInfo } from '../shared/calendar-api'
import { CalendarAccountStore } from './calendar-account-store'
import { scopeCalendar, scopeEvent, type CalendarIdentity } from './calendar-identity'

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly'
const AUTH_TIMEOUT_MS = 5 * 60_000
const LOOKAHEAD_DAYS = 14

interface StoredTokens {
  refreshToken: string
  email: string
  subject?: string
}

interface AccessToken {
  token: string
  expiresAtMs: number
}

/**
 * Google-side calendar integration: OAuth (loopback + PKCE, tokens
 * safeStorage-encrypted in the shared account vault) and read-only
 * Calendar API fetches, normalized to the same CalendarInfo/CalendarEvent
 * shapes the Microsoft path produces. Account, calendar and occurrence
 * identities are scoped before crossing into the renderer.
 */
export class GoogleCalendarClient {
  private readonly cachePath: string
  private tokens: StoredTokens | null = null
  private access: AccessToken | null = null
  private generation = 0
  private cancelAuth?: () => void
  private connectionId?: string
  private connectionEpoch = 0
  private restoreError?: string
  private readonly accounts: CalendarAccountStore

  constructor(
    userDataDir: string,
    private readonly clientSecret = googleClientSecret(),
    accounts?: CalendarAccountStore
  ) {
    this.accounts = accounts ?? new CalendarAccountStore(userDataDir, safeStorage)
    this.cachePath = join(userDataDir, 'google-token-cache')
    const existing = this.accounts.entries('google')[0]
    if (existing) {
      this.connectionId = existing.view.id
      this.connectionEpoch = this.accounts.epoch(existing.view.id)
      try {
        const tokens = JSON.parse(existing.credential) as StoredTokens
        if (
          tokens.subject !== existing.identity.subject ||
          typeof tokens.email !== 'string' ||
          !tokens.refreshToken
        )
          throw new Error()
        this.tokens = tokens
      } catch {
        this.restoreError =
          'Google account credentials could not be restored. Reconnect Google Calendar.'
      }
    } else if (!this.accounts.migrated('google')) this.tokens = this.readCache()
  }

  get identity(): CalendarIdentity | undefined {
    return this.tokens?.subject ? { provider: 'google', subject: this.tokens.subject } : undefined
  }
  get accountId(): string | undefined {
    return this.connectionId
  }

  /** Old refresh tokens lack a subject. Resolve it directly with Google before assigning data. */
  async initialize(): Promise<void> {
    if (this.accounts.error || this.restoreError)
      throw new Error(this.accounts.error ?? this.restoreError)
    if (!this.tokens || this.identity) return
    const generation = this.generation
    const token = await this.getAccessToken()
    const identity = await this.fetchIdentity(token)
    if (generation !== this.generation || !this.tokens) return
    const tokens = { ...this.tokens, email: identity.email, subject: identity.subject }
    this.connectionId = this.accounts.put(
      { provider: 'google', subject: identity.subject },
      { email: identity.email },
      JSON.stringify(tokens)
    )
    this.tokens = tokens
    this.connectionEpoch = this.accounts.epoch(this.connectionId)
  }

  get signedIn(): boolean {
    return this.tokens !== null
  }

  get account(): CalendarAccount | null {
    return this.tokens ? { email: this.tokens.email } : null
  }

  /** Browser OAuth: resolves once Google redirects back to the loopback. */
  async connect(): Promise<CalendarAccount> {
    this.accounts.assertWritable()
    if (!this.clientSecret) throw googleConfigurationError()
    this.cancelAuth?.()
    const generation = ++this.generation
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(16).toString('hex')

    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<html><body style="font-family:-apple-system,sans-serif;background:#f7f5ee;color:#26281f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Return to DoodleNote</h2><p>You can close this tab and return to DoodleNote.</p></div></body></html>'
        )
        clearTimeout(timeout)
        server.close()
        const returnedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        if (returnedState !== state) {
          reject(new Error('OAuth state mismatch — try connecting again'))
        } else if (!code) {
          reject(new Error(url.searchParams.get('error') ?? 'Google returned no code'))
        } else {
          resolve(code)
        }
      })
      const timeout = setTimeout(() => {
        server.close()
        this.generation++
        reject(new Error('Google sign-in timed out — try again'))
      }, AUTH_TIMEOUT_MS)
      timeout.unref()
      this.cancelAuth = () => {
        clearTimeout(timeout)
        server.close()
        reject(new Error('Google sign-in was cancelled.'))
      }
      server.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const params = new URLSearchParams({
          client_id: BUILT_IN_GOOGLE_CLIENT_ID,
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          prompt: 'consent', // guarantees a refresh_token on every connect
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state
        })
        void shell
          .openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
          .catch(() => {
            clearTimeout(timeout)
            server.close()
            reject(new Error('Google Calendar could not open your browser. Try connecting again.'))
          })
        // Rebuild the redirect_uri for the token exchange below.
        this.pendingRedirect = `http://127.0.0.1:${port}/callback`
      })
    })

    const body = await tokenRequest(this.clientSecret, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.pendingRedirect
    })
    if (!body.refresh_token) {
      throw new Error('Google did not return a refresh token — try connecting again')
    }
    const identity = await this.fetchIdentity(body.access_token)
    if (generation !== this.generation) throw new Error('Google sign-in was cancelled.')
    const previous = this.connectionId
      ? this.accounts.get(this.connectionId)?.identity
      : this.identity
    if (previous && previous.subject !== identity.subject) {
      throw new Error('Choose the connected Google account to reconnect it.')
    }
    const email = identity.email
    const tokens = { refreshToken: body.refresh_token, email, subject: identity.subject }
    this.connectionId = this.accounts.put(
      { provider: 'google', subject: identity.subject },
      { email },
      JSON.stringify(tokens),
      true
    )
    this.tokens = tokens
    this.connectionEpoch = this.accounts.epoch(this.connectionId)
    this.restoreError = undefined
    this.access = { token: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
    this.cancelAuth = undefined
    return { email }
  }

  private pendingRedirect = ''

  cancelPending(): void {
    this.generation++
    this.cancelAuth?.()
    this.cancelAuth = undefined
  }

  disconnect(): void {
    this.cancelPending()
    if (this.connectionId) this.accounts.remove(this.connectionId)
    else this.accounts.finishLegacy('google')
    this.tokens = null
    this.access = null
    this.connectionId = undefined
    this.restoreError = undefined
    try {
      rmSync(this.cachePath, { force: true })
    } catch {
      /* The committed migration tombstone prevents legacy resurrection. */
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error('Google Calendar is not connected')
    const id = this.connectionId
    const epoch = this.connectionEpoch
    if (id && !this.accounts.current(id, epoch)) throw new Error('Google account was removed.')
    if (this.access && Date.now() < this.access.expiresAtMs - 60_000) {
      return this.access.token
    }
    const generation = this.generation
    const body = await tokenRequest(this.clientSecret, {
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken
    })
    if (generation !== this.generation || (id && !this.accounts.current(id, epoch)))
      throw new Error('Google account changed. Retry calendar sync.')
    if (body.refresh_token && this.connectionId) {
      const tokens = { ...this.tokens, refreshToken: body.refresh_token }
      if (
        !this.accounts.update(this.connectionId, epoch, (e) => {
          e.credential = JSON.stringify(tokens)
        })
      )
        throw new Error('Google account was removed.')
      this.tokens = tokens
    }
    this.access = { token: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
    return this.access.token
  }

  /** The account's calendars with canonical account-scoped IDs. */
  async fetchCalendars(): Promise<CalendarInfo[]> {
    await this.initialize()
    const token = await this.getAccessToken()
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
      { headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {
      throw new Error('Google Calendar could not be reached. Check your connection and try again.')
    })
    if (!res.ok) throw new Error(await googleErrorMessage(res))
    const body = (await res.json()) as { items?: unknown[] }
    const calendars: CalendarInfo[] = []
    for (const raw of body.items ?? []) {
      const item = raw as {
        id?: string
        summary?: string
        backgroundColor?: string
        primary?: boolean
      }
      if (typeof item.id !== 'string' || item.id.length === 0) continue
      const calendar: CalendarInfo = {
        id: `g:${item.id}`,
        name: item.summary ?? item.id,
        colorHex: typeof item.backgroundColor === 'string' ? item.backgroundColor : '#7c9769',
        isDefault: item.primary === true,
        canEdit: false
      }
      calendars.push(this.identity ? scopeCalendar(this.identity, calendar) : calendar)
    }
    return calendars
  }

  /** Events for one calendar over the next LOOKAHEAD_DAYS. */
  async fetchEvents(calendar: CalendarInfo): Promise<CalendarEvent[]> {
    await this.initialize()
    if (calendar.accountId && calendar.accountId !== this.connectionId)
      throw new Error('Google calendar belongs to another account.')
    const token = await this.getAccessToken()
    const rawId = calendar.providerCalendarId ?? calendar.id.replace(/^g:/, '')
    const now = new Date()
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50'
    })
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(rawId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {
      throw new Error('Google Calendar could not be reached. Check your connection and try again.')
    })
    if (!res.ok) throw new Error(await googleErrorMessage(res))
    const body = (await res.json()) as { items?: unknown[] }
    const events: CalendarEvent[] = []
    for (const raw of body.items ?? []) {
      const event = normalizeGoogleEvent(raw, calendar)
      if (event)
        events.push(
          this.identity
            ? scopeEvent(
                this.identity,
                calendar.accountId ? calendar : scopeCalendar(this.identity, calendar),
                event
              )
            : event
        )
    }
    return events
  }

  /* ---- token cache (safeStorage-encrypted JSON) ---- */

  private readCache(): StoredTokens | null {
    try {
      const encrypted = readFileSync(this.cachePath)
      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<StoredTokens>
      if (typeof parsed.refreshToken === 'string' && typeof parsed.email === 'string') {
        return { refreshToken: parsed.refreshToken, email: parsed.email }
      }
      return null
    } catch {
      return null // no cache, or Keychain invalidated — user reconnects
    }
  }

  private async fetchIdentity(token: string): Promise<{ subject: string; email: string }> {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error'
    })
    if (!response.ok)
      throw new Error('Google account identity could not be verified. Reconnect Google Calendar.')
    const info = (await response.json()) as { sub?: unknown; email?: unknown }
    if (
      typeof info.sub !== 'string' ||
      !info.sub ||
      typeof info.email !== 'string' ||
      !info.email
    ) {
      throw new Error('Google account identity could not be verified. Reconnect Google Calendar.')
    }
    return { subject: info.sub, email: info.email }
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  id_token?: string
}

async function tokenRequest(
  clientSecret: string,
  params: Record<string, string>
): Promise<TokenResponse> {
  if (!clientSecret) throw googleConfigurationError()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: BUILT_IN_GOOGLE_CLIENT_ID,
      client_secret: clientSecret
    })
  }).catch(() => {
    throw new Error('Google Calendar could not be reached. Check your connection and try again.')
  })
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    error_description?: string
    error?: string
  }
  if (
    !res.ok ||
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    typeof body.expires_in !== 'number' ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0
  ) {
    throw googleTokenError(body.error, body.error_description, res.status)
  }
  return body
}

function normalizeGoogleEvent(raw: unknown, calendar: CalendarInfo): CalendarEvent | null {
  const item = raw as {
    id?: string
    summary?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    attendees?: unknown[]
    hangoutLink?: string
    location?: string
    organizer?: { displayName?: string; email?: string }
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
    status?: string
  }
  if (typeof item.id !== 'string' || item.status === 'cancelled') return null
  const isAllDay = typeof item.start?.date === 'string'
  const startIso = item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00` : null)
  const endIso = item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T00:00:00` : null)
  if (!startIso || !endIso) return null

  const joinUrl =
    item.hangoutLink ??
    item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
  const hasAttendees = Array.isArray(item.attendees) && item.attendees.length > 1

  return {
    id: `g:${item.id}`,
    subject: item.summary ?? '(no title)',
    startIso: new Date(startIso).toISOString(),
    endIso: new Date(endIso).toISOString(),
    isAllDay,
    isOnlineMeeting: typeof joinUrl === 'string',
    calendarId: calendar.id,
    colorHex: calendar.colorHex,
    hasParticipants: hasAttendees || typeof joinUrl === 'string',
    ...(joinUrl ? { joinUrl } : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(item.organizer?.displayName || item.organizer?.email
      ? { organizer: item.organizer.displayName ?? item.organizer.email }
      : {})
  }
}

async function googleErrorMessage(res: Response): Promise<string> {
  try {
    await res.json()
    if (res.status === 401)
      return 'Google Calendar authorization expired. Open Settings > Calendar and reconnect Google.'
    if (res.status === 403)
      return 'Google Calendar access was denied. Check your Google account permissions and reconnect.'
    if (res.status === 429) return 'Google Calendar is rate-limiting requests. Try again shortly.'
    return `Google Calendar request failed (HTTP ${res.status}). Try again.`
  } catch {
    return `Google Calendar error ${res.status}`
  }
}
