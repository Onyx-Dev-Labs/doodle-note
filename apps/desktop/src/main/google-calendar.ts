import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { safeStorage, shell } from 'electron'
import {
  BUILT_IN_GOOGLE_CLIENT_ID,
  BUILT_IN_GOOGLE_CLIENT_SECRET
} from '../shared/google-app'
import type { CalendarAccount, CalendarEvent, CalendarInfo } from '../shared/calendar-api'

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly'
const AUTH_TIMEOUT_MS = 5 * 60_000
const LOOKAHEAD_DAYS = 14

interface StoredTokens {
  refreshToken: string
  email: string
}

interface AccessToken {
  token: string
  expiresAtMs: number
}

/**
 * Google-side calendar integration: OAuth (loopback + PKCE, tokens
 * safeStorage-encrypted at userData/google-token-cache) and read-only
 * Calendar API fetches, normalized to the same CalendarInfo/CalendarEvent
 * shapes the Microsoft path produces. Calendar and event ids are prefixed
 * "g:" so the two providers can share prefs and dedupe maps.
 */
export class GoogleCalendarClient {
  private readonly cachePath: string
  private tokens: StoredTokens | null = null
  private access: AccessToken | null = null

  constructor(userDataDir: string) {
    this.cachePath = join(userDataDir, 'google-token-cache')
    this.tokens = this.readCache()
  }

  get signedIn(): boolean {
    return this.tokens !== null
  }

  get account(): CalendarAccount | null {
    return this.tokens ? { email: this.tokens.email } : null
  }

  /** Browser OAuth: resolves once Google redirects back to the loopback. */
  async connect(): Promise<CalendarAccount> {
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
          '<html><body style="font-family:-apple-system,sans-serif;background:#f7f5ee;color:#26281f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Google Calendar connected</h2><p>You can close this tab and return to DoodleNote.</p></div></body></html>'
        )
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
        reject(new Error('Google sign-in timed out — try again'))
      }, AUTH_TIMEOUT_MS)
      timeout.unref()
      server.on('error', reject)
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
        void shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
        // Rebuild the redirect_uri for the token exchange below.
        this.pendingRedirect = `http://127.0.0.1:${port}/callback`
      })
    })

    const body = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.pendingRedirect
    })
    if (!body.refresh_token) {
      throw new Error('Google did not return a refresh token — try connecting again')
    }
    const email = decodeEmail(body.id_token) ?? 'Google account'
    this.tokens = { refreshToken: body.refresh_token, email }
    this.access = { token: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
    this.writeCache()
    return { email }
  }

  private pendingRedirect = ''

  disconnect(): void {
    this.tokens = null
    this.access = null
    rmSync(this.cachePath, { force: true })
  }

  private async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error('Google Calendar is not connected')
    if (this.access && Date.now() < this.access.expiresAtMs - 60_000) {
      return this.access.token
    }
    const body = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken
    })
    this.access = { token: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
    return this.access.token
  }

  /** The account's calendars, ids prefixed g:. */
  async fetchCalendars(): Promise<CalendarInfo[]> {
    const token = await this.getAccessToken()
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
      { headers: { Authorization: `Bearer ${token}` } }
    )
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
      calendars.push({
        id: `g:${item.id}`,
        name: item.summary ?? item.id,
        colorHex: typeof item.backgroundColor === 'string' ? item.backgroundColor : '#7c9769',
        isDefault: item.primary === true,
        canEdit: false
      })
    }
    return calendars
  }

  /** Events for one calendar over the next LOOKAHEAD_DAYS. */
  async fetchEvents(calendar: CalendarInfo): Promise<CalendarEvent[]> {
    const token = await this.getAccessToken()
    const rawId = calendar.id.replace(/^g:/, '')
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
    )
    if (!res.ok) throw new Error(await googleErrorMessage(res))
    const body = (await res.json()) as { items?: unknown[] }
    const events: CalendarEvent[] = []
    for (const raw of body.items ?? []) {
      const event = normalizeGoogleEvent(raw, calendar)
      if (event) events.push(event)
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

  private writeCache(): void {
    try {
      writeFileSync(this.cachePath, safeStorage.encryptString(JSON.stringify(this.tokens)))
    } catch (err) {
      console.error('[google-calendar] token cache write failed:', err)
    }
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  id_token?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: BUILT_IN_GOOGLE_CLIENT_ID,
      client_secret: BUILT_IN_GOOGLE_CLIENT_SECRET,
      ...params
    })
  })
  const body = (await res.json()) as TokenResponse & { error_description?: string; error?: string }
  if (!res.ok || typeof body.access_token !== 'string') {
    throw new Error(body.error_description ?? body.error ?? `Google token error ${res.status}`)
  }
  return body
}

/** Email from the id_token payload (no verification needed — TLS to Google). */
function decodeEmail(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]!
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string }
    return typeof claims.email === 'string' ? claims.email : null
  } catch {
    return null
  }
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
    const body = (await res.json()) as { error?: { message?: string } }
    return body.error?.message ?? `Google Calendar error ${res.status}`
  } catch {
    return `Google Calendar error ${res.status}`
  }
}
