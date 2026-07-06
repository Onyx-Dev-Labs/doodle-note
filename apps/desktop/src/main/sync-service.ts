import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { ipcMain, safeStorage, shell } from 'electron'
import type { MeetingRecord } from '../shared/meetings-api'
import {
  SYNC_CONNECT_CHANNEL,
  SYNC_SHARE_CHANNEL,
  SYNC_DISCONNECT_CHANNEL,
  SYNC_GET_STATUS_CHANNEL,
  SYNC_NOW_CHANNEL,
  SYNC_SET_ENABLED_CHANNEL,
  SYNC_STATUS_EVENT_CHANNEL,
  type ShareResult,
  type SyncStatus
} from '../shared/sync-api'
import type { MeetingsService } from './meetings-service'

/** Cloud base URL; override with DOODLE_SYNC_URL for local web-dev testing. */
const DEFAULT_BASE_URL = 'https://doodle-note.vercel.app'

const LINK_TIMEOUT_MS = 5 * 60_000
const PUSH_DEBOUNCE_MS = 5_000
const PUSH_INTERVAL_MS = 5 * 60_000

interface SyncConfig {
  enabled: boolean
  /** safeStorage-encrypted sync token, base64. */
  tokenEnc?: string
  email?: string
  workspaceName?: string
  lastSyncAt?: string
  /** meetingId → content hash at last successful push. */
  pushed: Record<string, string>
  /** attachment file name → public blob URL (uploaded once, reused). */
  mediaUrls: Record<string, string>
  /** Local meetings deleted/trashed whose cloud copy still needs removing. */
  pendingDeletes: string[]
}

/**
 * One-way desktop → cloud sync. Local storage stays the source of truth;
 * when enabled, every non-trashed meeting whose content hash changed is
 * pushed (meeting row + full segments + notes markdown) to the web app.
 */
export class SyncService {
  private config: SyncConfig
  private readonly configPath: string
  private readonly baseUrl: string
  private syncing = false
  private linking = false
  private lastError: string | undefined
  private debounceTimer: NodeJS.Timeout | null = null
  private linkServer: Server | null = null

  private readonly attachmentsDir: string

  constructor(
    userDataDir: string,
    private readonly meetings: MeetingsService,
    private readonly broadcast: (channel: string, payload: unknown) => void
  ) {
    this.configPath = join(userDataDir, 'sync.json')
    this.attachmentsDir = join(userDataDir, 'attachments')
    this.baseUrl = process.env.DOODLE_SYNC_URL || DEFAULT_BASE_URL
    this.config = this.readConfig()
  }

  registerIpc(): void {
    ipcMain.handle(SYNC_GET_STATUS_CHANNEL, () => this.status())
    ipcMain.handle(SYNC_CONNECT_CHANNEL, () => this.connect())
    ipcMain.handle(SYNC_DISCONNECT_CHANNEL, () => this.disconnect())
    ipcMain.handle(SYNC_SET_ENABLED_CHANNEL, (_e, enabled: unknown) =>
      this.setEnabled(Boolean(enabled))
    )
    ipcMain.handle(SYNC_NOW_CHANNEL, () => this.syncNow())
    ipcMain.handle(SYNC_SHARE_CHANNEL, (_event, meetingId: unknown) =>
      this.share(String(meetingId))
    )

    setInterval(() => {
      if (this.config.enabled && this.token()) void this.pushAll()
    }, PUSH_INTERVAL_MS).unref()
  }

  /** MeetingsService calls this after every write; deletes pass deletedId. */
  onMeetingsChanged(deletedId?: string): void {
    if (deletedId && this.config.pushed[deletedId]) {
      this.config.pendingDeletes = [...new Set([...this.config.pendingDeletes, deletedId])]
      delete this.config.pushed[deletedId]
      this.writeConfig()
    }
    if (!this.config.enabled || !this.token()) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.pushAll()
    }, PUSH_DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }

  /* ---- status ---- */

  status(): SyncStatus {
    return {
      connected: Boolean(this.token()),
      ...(this.config.email ? { email: this.config.email } : {}),
      ...(this.config.workspaceName ? { workspaceName: this.config.workspaceName } : {}),
      enabled: this.config.enabled,
      syncing: this.syncing,
      ...(this.config.lastSyncAt ? { lastSyncAt: this.config.lastSyncAt } : {}),
      pendingCount: this.pendingMeetings().length + this.config.pendingDeletes.length,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      linking: this.linking,
      baseUrl: this.baseUrl
    }
  }

  private emitStatus(): void {
    this.broadcast(SYNC_STATUS_EVENT_CHANNEL, this.status())
  }

  /* ---- linking ---- */

  /**
   * Device-link flow: serve a one-shot loopback callback, open the browser at
   * the web app's /link-device page, and wait for it to deliver a sync token.
   */
  async connect(): Promise<SyncStatus> {
    if (this.linking) return this.status()
    this.linking = true
    this.lastError = undefined
    this.emitStatus()

    try {
      const token = await new Promise<{ token: string; email: string; workspace: string }>(
        (resolve, reject) => {
          const server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1')
            if (url.pathname !== '/callback') {
              res.writeHead(404).end()
              return
            }
            const token = url.searchParams.get('token') ?? ''
            const email = url.searchParams.get('email') ?? ''
            const workspace = url.searchParams.get('workspace') ?? ''
            if (token.startsWith('dnsy_')) {
              // Land the user in their web meetings library — they're already
              // signed in there from the approval page.
              res.writeHead(302, { Location: `${this.baseUrl}/app` })
              res.end()
              resolve({ token, email, workspace })
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(
                '<html><body style="font-family:-apple-system,sans-serif;background:#f7f5ee;color:#26281f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connection failed</h2><p>Return to DoodleNote and try connecting again.</p></div></body></html>'
              )
              reject(new Error('The browser did not return a valid token'))
            }
          })
          this.linkServer = server
          const timeout = setTimeout(() => {
            reject(new Error('Sign-in timed out — try again'))
          }, LINK_TIMEOUT_MS)
          timeout.unref()
          server.on('error', reject)
          server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0
            const query = new URLSearchParams({
              port: String(port),
              name: hostname().replace(/\.local$/, '') || 'Mac'
            })
            void shell.openExternal(`${this.baseUrl}/link-device?${query}`)
          })
        }
      )

      this.config.tokenEnc = safeStorage.encryptString(token.token).toString('base64')
      this.config.email = token.email
      this.config.workspaceName = token.workspace
      this.config.enabled = true
      this.writeConfig()
      // First backfill right away — the whole point of connecting.
      void this.pushAll()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Could not connect'
    } finally {
      this.linkServer?.close()
      this.linkServer = null
      this.linking = false
      this.emitStatus()
    }
    return this.status()
  }

  disconnect(): SyncStatus {
    this.linkServer?.close()
    this.linkServer = null
    this.linking = false
    this.config = {
      enabled: false,
      pushed: {},
      mediaUrls: {},
      pendingDeletes: []
    }
    this.writeConfig()
    this.lastError = undefined
    this.emitStatus()
    return this.status()
  }

  setEnabled(enabled: boolean): SyncStatus {
    this.config.enabled = enabled && Boolean(this.token())
    this.writeConfig()
    if (this.config.enabled) void this.pushAll()
    this.emitStatus()
    return this.status()
  }

  /**
   * Push the meeting fresh (the shared page must show current content),
   * then mint or fetch its public share link.
   */
  async share(meetingId: string): Promise<ShareResult> {
    const token = this.token()
    if (!token) return { error: 'Connect cloud sync in Settings first' }
    const record = this.meetings
      .readAll()
      .find((r) => r.id === meetingId && !r.trashedAt)
    if (!record) return { error: 'Meeting not found' }

    try {
      await this.uploadReferencedMedia(record, token)
      const pushResponse = await fetch(`${this.baseUrl}/api/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetings: [toPushMeeting(record, this.config.mediaUrls)] })
      })
      if (!pushResponse.ok) {
        return { error: `Could not sync the meeting (HTTP ${pushResponse.status})` }
      }
      this.config.pushed[record.id] = contentHash(record, this.config.mediaUrls)
      this.writeConfig()

      const shareResponse = await fetch(`${this.baseUrl}/api/sync/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, enable: true })
      })
      const body = (await shareResponse.json().catch(() => ({}))) as {
        url?: string
        error?: string
      }
      if (!shareResponse.ok || typeof body.url !== 'string') {
        return { error: body.error ?? `Share failed (HTTP ${shareResponse.status})` }
      }
      return { url: body.url }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Share failed' }
    }
  }

  async syncNow(): Promise<SyncStatus> {
    await this.pushAll()
    return this.status()
  }

  /* ---- pushing ---- */

  private pendingMeetings(): MeetingRecord[] {
    return this.meetings
      .readAll()
      .filter((record) => !record.trashedAt)
      .filter(
        (record) => this.config.pushed[record.id] !== contentHash(record, this.config.mediaUrls)
      )
  }

  private async pushAll(): Promise<void> {
    if (this.syncing || !this.config.enabled) return
    const token = this.token()
    if (!token) return
    this.syncing = true
    this.emitStatus()

    try {
      // Deletions first so restores (delete then re-create) settle correctly.
      if (this.config.pendingDeletes.length > 0) {
        const response = await fetch(`${this.baseUrl}/api/sync/push`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ids: this.config.pendingDeletes })
        })
        if (response.ok) {
          this.config.pendingDeletes = []
          this.writeConfig()
        }
      }

      for (const record of this.pendingMeetings()) {
        await this.uploadReferencedMedia(record, token)
        const response = await fetch(`${this.baseUrl}/api/sync/push`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ meetings: [toPushMeeting(record, this.config.mediaUrls)] })
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Sync failed (HTTP ${response.status})`)
        }
        const body = (await response.json()) as {
          results?: Array<{ id: string; ok: boolean; error?: string }>
        }
        const result = body.results?.[0]
        if (!result?.ok) {
          // Per-meeting rejection (bad id etc.) — record and move on.
          console.error('[sync] meeting rejected:', record.id, result?.error)
          continue
        }
        this.config.pushed[record.id] = contentHash(record, this.config.mediaUrls)
        this.writeConfig()
      }

      this.config.lastSyncAt = new Date().toISOString()
      this.writeConfig()
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Sync failed'
      console.error('[sync] push failed:', this.lastError)
    } finally {
      this.syncing = false
      this.emitStatus()
    }
  }

  /**
   * Upload attachments referenced by this meeting's markdown that haven't
   * been uploaded yet (name → URL cached in config). Images over the API's
   * 3MB cap (or with missing files) stay local — their refs are left as-is.
   */
  private async uploadReferencedMedia(record: MeetingRecord, token: string): Promise<void> {
    for (const name of mediaRefs(record)) {
      if (this.config.mediaUrls[name]) continue
      let bytes: Buffer
      try {
        bytes = readFileSync(join(this.attachmentsDir, name))
      } catch {
        continue // file gone — nothing to upload
      }
      if (bytes.byteLength > 3 * 1024 * 1024) continue
      try {
        const response = await fetch(`${this.baseUrl}/api/sync/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data: bytes.toString('base64') })
        })
        if (!response.ok) continue
        const body = (await response.json()) as { url?: string }
        if (typeof body.url === 'string' && body.url.startsWith('https://')) {
          this.config.mediaUrls[name] = body.url
          this.writeConfig()
        }
      } catch {
        // Network hiccup — the ref stays local; a later push retries.
      }
    }
  }

  /* ---- config ---- */

  private token(): string | null {
    if (!this.config.tokenEnc) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.config.tokenEnc, 'base64'))
    } catch {
      // Keychain entry invalidated (e.g. unsigned-build re-sign) — force relink.
      return null
    }
  }

  private readConfig(): SyncConfig {
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<SyncConfig>
      return {
        enabled: raw.enabled === true,
        ...(typeof raw.tokenEnc === 'string' ? { tokenEnc: raw.tokenEnc } : {}),
        ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
        ...(typeof raw.workspaceName === 'string' ? { workspaceName: raw.workspaceName } : {}),
        ...(typeof raw.lastSyncAt === 'string' ? { lastSyncAt: raw.lastSyncAt } : {}),
        pushed: raw.pushed && typeof raw.pushed === 'object' ? (raw.pushed as Record<string, string>) : {},
        mediaUrls:
          raw.mediaUrls && typeof raw.mediaUrls === 'object'
            ? (raw.mediaUrls as Record<string, string>)
            : {},
        pendingDeletes: Array.isArray(raw.pendingDeletes) ? raw.pendingDeletes.map(String) : []
      }
    } catch {
      return { enabled: false, pushed: {}, mediaUrls: {}, pendingDeletes: [] }
    }
  }

  private writeConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('[sync] could not persist config:', error)
    }
  }
}

const MEDIA_REF = /doodle-media:\/\/([a-z0-9.-]+)/g

/** Attachment names referenced in the meeting's markdown. */
function mediaRefs(record: MeetingRecord): string[] {
  const text = `${record.rawNotesMarkdown}\n${record.enhancedMarkdown ?? ''}`
  return [...new Set([...text.matchAll(MEDIA_REF)].map((m) => m[1]!))]
}

/** Local doodle-media:// refs → public blob URLs (only those uploaded). */
function rewriteMedia(markdown: string, mediaUrls: Record<string, string>): string {
  return markdown.replace(MEDIA_REF, (whole, name: string) => mediaUrls[name] ?? whole)
}

/** Stable hash of everything the push carries — change detection. Includes
 *  the media rewrite so a late-arriving upload URL triggers a re-push. */
function contentHash(record: MeetingRecord, mediaUrls: Record<string, string>): string {
  const projection = {
    title: record.title,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    endedAt: record.endedAt ?? null,
    calendarEventId: record.calendarEventId ?? null,
    rawNotesMarkdown: rewriteMedia(record.rawNotesMarkdown, mediaUrls),
    enhancedMarkdown: record.enhancedMarkdown
      ? rewriteMedia(record.enhancedMarkdown, mediaUrls)
      : null,
    segments: record.segments.map((s) => [s.channel, s.speaker, s.text, s.startMs, s.endMs])
  }
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}

function toPushMeeting(record: MeetingRecord, mediaUrls: Record<string, string>): object {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    ...(record.calendarEventId ? { calendarEventId: record.calendarEventId } : {}),
    ...(record.rawNotesMarkdown
      ? { rawNotesMarkdown: rewriteMedia(record.rawNotesMarkdown, mediaUrls) }
      : {}),
    ...(record.enhancedMarkdown
      ? { enhancedMarkdown: rewriteMedia(record.enhancedMarkdown, mediaUrls) }
      : {}),
    // Echo-flagged segments are far-side bleed the UI hides — don't sync them.
    segments: record.segments
      .filter((s) => !s.echo)
      .map((s) => ({
        channel: s.channel,
        speaker: s.speaker,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
        confidence: s.confidence
      }))
  }
}
