import { libraryActivity } from './library-activity'
import { resolveLibraryPath, type LibraryPath } from './library-path'
import { cloudReaderClient } from './cloud-reader-client'
import { remoteMcpEligibilityClient } from './remote-mcp-eligibility'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, safeStorage, shell } from 'electron'
import type { TranscriptSegment } from '../shared/engine-events'
import { defaultSpeakerId, defaultSpeakerLabel, sanitizeSpeakerName } from '@repo/meetings-store'
import { MEETINGS_CHANGED_EVENT_CHANNEL, type MeetingRecord } from '../shared/meetings-api'
import {
  SYNC_CONNECT_CHANNEL,
  SYNC_CANCEL_CONNECT_CHANNEL,
  SYNC_SHARE_CHANNEL,
  SYNC_SHARE_ADD_RECIPIENTS_CHANNEL,
  SYNC_SHARE_REMOVE_RECIPIENT_CHANNEL,
  SYNC_SHARE_STATE_CHANNEL,
  SYNC_SHARE_UPDATE_CHANNEL,
  SYNC_DISCONNECT_CHANNEL,
  SYNC_GET_STATUS_CHANNEL,
  SYNC_REMOTE_MCP_ELIGIBILITY_CHANNEL,
  SYNC_NOW_CHANNEL,
  SYNC_SET_ENABLED_CHANNEL,
  SYNC_STATUS_EVENT_CHANNEL,
  SHARE_LINK_EXPIRY_DAYS,
  type ShareFailure,
  type ShareLink,
  type ShareRecipient,
  type ShareRecipientsResult,
  type ShareResult,
  type ShareSettingsUpdate,
  type ShareState,
  type ShareStateResult,
  type ShareWorkspace,
  type SyncStatus
} from '../shared/sync-api'
import type { FolderRecord } from '../shared/folders-api'
import type { FoldersService } from './folders-service'
import type { MeetingsService } from './meetings-service'
import {
  contentHash,
  mediaRefs,
  rewriteMedia,
  syncableSegments,
  supportsCloudSync
} from './sync-content-hash'
import { DeviceLinkAttempt } from './device-link-attempt'
import { EMPTY_SYNC_CONFIG, parseSyncConfigFromRaw, type SyncConfig } from './sync-config'
import {
  decideFolderPull,
  decidePullAction,
  shouldRemoveFolderLocally,
  shouldTrashLocally
} from './sync-pull-logic'

/** Cloud base URL; override with DOODLE_SYNC_URL for local web-dev testing. */
const DEFAULT_BASE_URL = 'https://www.doodlenote.ai'

const PUSH_DEBOUNCE_MS = 5_000
const PUSH_INTERVAL_MS = 5 * 60_000
/** Pull pages are capped server-side; this bounds a runaway loop. */
const MAX_PULL_PAGES = 40
const STARTUP_SYNC_DELAY_MS = 5_000

const SUBSCRIPTION_ERROR =
  'Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing'
const LOCAL_ONLY_SHARE_ERROR =
  'Imported text transcripts stay on this computer. Export this note to share it.'
const NETWORK_SHARE_ERROR = 'Could not reach DoodleNote cloud. Check your connection and try again.'
/** Generous bound on the raw address list; the server caps recipients per request. */
const MAX_RECIPIENT_INPUT_CHARS = 10_000

/**
 * Two-way desktop ↔ cloud sync. Local storage stays the source of truth
 * for anything edited here: every non-trashed meeting whose content hash
 * changed is pushed (meeting row + full segments + notes markdown), and a
 * cursor-based pull imports meetings recorded on other devices. Local
 * edits always win until pushed (see sync-pull-logic.ts); cloud deletions
 * soft-trash the local copy, never hard-delete.
 */
export class SyncService {
  private config: SyncConfig
  private readonly configPath: string
  private readonly baseUrl: string
  private syncing = false
  private pulling = false
  private statusRevision = 0
  private connectionRevision = 0
  private lastError: string | undefined
  private debounceTimer: NodeJS.Timeout | null = null
  private linkAttempt: DeviceLinkAttempt | null = null

  private get attachmentsDir(): string {
    return join(resolveLibraryPath(this.libraryRoot), 'attachments')
  }

  constructor(
    userDataDir: string,
    private readonly meetings: MeetingsService,
    private readonly folders: FoldersService,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly libraryRoot: LibraryPath = userDataDir
  ) {
    this.configPath = join(userDataDir, 'sync.json')
    this.baseUrl = process.env.DOODLE_SYNC_URL || DEFAULT_BASE_URL
    this.config = this.readConfig()
  }

  registerIpc(): void {
    const reader = cloudReaderClient(() => ({
      token: this.token(),
      enabled: this.config.enabled,
      baseUrl: this.baseUrl
    }))
    ipcMain.handle('sync:reader', (_event, request: unknown) => reader(request))
    ipcMain.handle(SYNC_GET_STATUS_CHANNEL, () => this.status())
    const remoteMcpEligible = remoteMcpEligibilityClient(() => ({
      token: this.token(),
      baseUrl: this.baseUrl,
      revision: this.connectionRevision
    }))
    ipcMain.handle(SYNC_REMOTE_MCP_ELIGIBILITY_CHANNEL, () => remoteMcpEligible())
    ipcMain.handle(SYNC_CONNECT_CHANNEL, () => this.connect())
    ipcMain.handle(SYNC_CANCEL_CONNECT_CHANNEL, () => this.cancelConnect())
    ipcMain.handle(SYNC_DISCONNECT_CHANNEL, () => this.disconnect())
    ipcMain.handle(SYNC_SET_ENABLED_CHANNEL, (_e, enabled: unknown) =>
      this.setEnabled(Boolean(enabled))
    )
    ipcMain.handle(SYNC_NOW_CHANNEL, () => this.syncNow())
    ipcMain.handle(SYNC_SHARE_CHANNEL, (_event, meetingId: unknown) =>
      libraryActivity.run(() => this.share(String(meetingId)))
    )
    ipcMain.handle(SYNC_SHARE_STATE_CHANNEL, (_event, meetingId: unknown) =>
      libraryActivity.run(() => this.shareState(String(meetingId)))
    )
    ipcMain.handle(
      SYNC_SHARE_ADD_RECIPIENTS_CHANNEL,
      (_event, meetingId: unknown, emails: unknown) =>
        libraryActivity.run(() =>
          this.addShareRecipients(String(meetingId), typeof emails === 'string' ? emails : '')
        )
    )
    ipcMain.handle(
      SYNC_SHARE_REMOVE_RECIPIENT_CHANNEL,
      (_event, meetingId: unknown, recipientId: unknown) =>
        libraryActivity.run(() => this.removeShareRecipient(String(meetingId), String(recipientId)))
    )
    ipcMain.handle(SYNC_SHARE_UPDATE_CHANNEL, (_event, meetingId: unknown, update: unknown) =>
      libraryActivity.run(() =>
        this.updateShareSettings(String(meetingId), sanitizeShareUpdate(update))
      )
    )

    setInterval(() => {
      if (this.config.enabled && this.token()) void this.syncCycle()
    }, PUSH_INTERVAL_MS).unref()

    // Boot sync: pick up meetings recorded on other devices since last run.
    const startup = setTimeout(() => {
      if (this.config.enabled && this.token()) void this.syncCycle()
    }, STARTUP_SYNC_DELAY_MS)
    startup.unref()
  }

  /** Push first (our edits win), then pull what other devices recorded. */
  private async syncCycle(): Promise<void> {
    await libraryActivity.run(async () => {
      await this.pushAll()
      await this.pullAll()
    })
  }

  /** FoldersService calls this after every write; deletes pass deletedId. */
  onFoldersChanged(deletedId?: string): void {
    if (deletedId && this.config.syncedFolders[deletedId]) {
      this.config.pendingFolderDeletes = [
        ...new Set([...this.config.pendingFolderDeletes, deletedId])
      ]
      delete this.config.syncedFolders[deletedId]
      this.writeConfig()
    }
    if (!this.config.enabled || !this.token()) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void libraryActivity.run(() => this.pushAll())
    }, PUSH_DEBOUNCE_MS)
    this.debounceTimer.unref?.()
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
      void libraryActivity.run(() => this.pushAll())
    }, PUSH_DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }

  /* ---- status ---- */

  status(): SyncStatus {
    return {
      statusRevision: this.statusRevision,
      connectionRevision: this.connectionRevision,
      connected: Boolean(this.token()),
      ...(this.config.email ? { email: this.config.email } : {}),
      ...(this.config.workspaceName ? { workspaceName: this.config.workspaceName } : {}),
      enabled: this.config.enabled,
      syncing: this.syncing,
      ...(this.config.lastSyncAt ? { lastSyncAt: this.config.lastSyncAt } : {}),
      pendingCount: this.pendingMeetings().length + this.config.pendingDeletes.length,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      linking: this.linkAttempt !== null,
      baseUrl: this.baseUrl
    }
  }

  private emitStatus(): void {
    this.statusRevision++
    this.broadcast(SYNC_STATUS_EVENT_CHANNEL, this.status())
  }

  /* ---- linking ---- */

  /**
   * Device-link flow: serve a one-shot loopback callback, open the browser at
   * the web app's /link-device page, and wait for it to deliver a sync token.
   */
  async connect(): Promise<SyncStatus> {
    if (this.linkAttempt) return this.status()
    const attempt = new DeviceLinkAttempt(this.baseUrl, (url) => shell.openExternal(url))
    this.linkAttempt = attempt
    this.lastError = undefined
    this.emitStatus()
    attempt.start()

    try {
      const token = await attempt.result
      // Cancellation/disconnect can retire this attempt before its continuation runs.
      if (this.linkAttempt !== attempt) return this.status()
      if (token.kind !== 'linked') {
        if (token.kind === 'error') this.lastError = token.message
      } else {
        this.config.tokenEnc = safeStorage.encryptString(token.token).toString('base64')
        this.connectionRevision++
        this.config.email = token.email
        this.config.workspaceName = token.workspace
        this.config.enabled = true
        this.writeConfig()
        // First sync right away — the whole point of connecting.
        void this.syncCycle()
      }
    } catch {
      if (this.linkAttempt === attempt) this.lastError = 'Could not save the connection — try again'
    } finally {
      if (this.linkAttempt === attempt) {
        this.linkAttempt = null
        this.emitStatus()
      }
    }
    return this.status()
  }

  /** Cancels only the unfinished browser flow, preserving account and local data. */
  cancelConnect(): SyncStatus {
    const attempt = this.linkAttempt
    if (!attempt) return this.status()
    this.linkAttempt = null
    attempt.cancel()
    this.lastError = undefined
    this.emitStatus()
    return this.status()
  }

  disconnect(): SyncStatus {
    this.cancelConnect()
    this.connectionRevision++
    this.config = { ...EMPTY_SYNC_CONFIG }
    this.writeConfig()
    this.lastError = undefined
    this.emitStatus()
    return this.status()
  }

  setEnabled(enabled: boolean): SyncStatus {
    this.config.enabled = enabled && Boolean(this.token())
    this.writeConfig()
    if (this.config.enabled) void libraryActivity.run(() => this.pushAll())
    this.emitStatus()
    return this.status()
  }

  /* ---- sharing ---- */

  /**
   * Local checks shared by every share action. A failure here means no
   * network request at all (not linked, local-only import, missing meeting).
   */
  private shareTarget(meetingId: string): { record: MeetingRecord; token: string } | ShareFailure {
    const record = this.meetings.readAll().find((r) => r.id === meetingId && !r.trashedAt)
    if (!record) return { error: 'Meeting not found', code: 'not_found' }
    if (!supportsCloudSync(record)) return { error: LOCAL_ONLY_SHARE_ERROR, code: 'local_only' }
    const token = this.token()
    if (!token) return { error: 'Connect cloud sync in Settings first', code: 'not_linked' }
    return { record, token }
  }

  /** One bearer request to a share route. Throws only on network failure. */
  private async shareFetch(
    token: string,
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: unknown
  ): Promise<{ ok: boolean; status: number; body: ShareResponseBody }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const parsed = (await response.json().catch(() => ({}))) as unknown
    return {
      ok: response.ok,
      status: response.status,
      body: parsed && typeof parsed === 'object' ? (parsed as ShareResponseBody) : {}
    }
  }

  /**
   * Push the meeting fresh (shared pages must show current content). A
   * rejected push — e.g. the id already lives in another cloud workspace —
   * is an error, so the caller never hands out a link to stale content.
   */
  private async pushForShare(record: MeetingRecord, token: string): Promise<ShareFailure | null> {
    await this.uploadReferencedMedia(record, token)
    const response = await this.shareFetch(token, '/api/sync/push', 'POST', {
      meetings: [toPushMeeting(record, this.config.mediaUrls)]
    })
    if (!response.ok)
      return shareFailure(response.status, response.body, 'Could not sync the meeting')
    const result = Array.isArray(response.body.results) ? response.body.results[0] : undefined
    if (!result || result.ok !== true) {
      return { code: 'push_rejected', error: pushRejectedMessage(result?.error) }
    }
    this.config.pushed[record.id] = contentHash(record, this.config.mediaUrls)
    this.writeConfig()
    return null
  }

  /**
   * Legacy one-shot share (pre-DEV-486 renderer): push, then mint/fetch the
   * public link with the original request shape.
   */
  async share(meetingId: string): Promise<ShareResult> {
    const target = this.shareTarget(meetingId)
    if ('error' in target) return { error: target.error }
    try {
      const pushed = await this.pushForShare(target.record, target.token)
      if (pushed) return { error: pushed.error }
      const response = await this.shareFetch(target.token, '/api/sync/share', 'POST', {
        meetingId: target.record.id,
        enable: true
      })
      if (!response.ok || typeof response.body.url !== 'string') {
        return { error: shareFailure(response.status, response.body, 'Share failed').error }
      }
      return { url: response.body.url }
    } catch {
      return { error: NETWORK_SHARE_ERROR }
    }
  }

  /** The Share dialog state (people, link, transcript, workspace). Reads only; never pushes. */
  async shareState(meetingId: string): Promise<ShareStateResult> {
    const target = this.shareTarget(meetingId)
    if ('error' in target) return target
    try {
      const response = await this.shareFetch(
        target.token,
        `/api/sync/share?meetingId=${encodeURIComponent(target.record.id)}`,
        'GET'
      )
      // The cloud has no copy in this workspace yet, so nothing is shared.
      if (response.status === 404) return NOT_SYNCED_STATE
      if (!response.ok)
        return shareFailure(response.status, response.body, 'Could not load sharing')
      return parseShareState(response.body)
    } catch {
      return { error: NETWORK_SHARE_ERROR, code: 'network' }
    }
  }

  async addShareRecipients(meetingId: string, emails: string): Promise<ShareRecipientsResult> {
    const target = this.shareTarget(meetingId)
    if ('error' in target) return target
    const input = emails.trim()
    if (input.length === 0) return { error: 'Enter at least one email address.', code: 'request' }
    if (input.length > MAX_RECIPIENT_INPUT_CHARS) {
      return { error: 'That list is too long. Share with fewer people at a time.', code: 'request' }
    }
    try {
      const pushed = await this.pushForShare(target.record, target.token)
      if (pushed) return pushed
      const response = await this.shareFetch(
        target.token,
        `/api/sync/share/recipients?meetingId=${encodeURIComponent(target.record.id)}`,
        'POST',
        { emails: input }
      )
      if (!response.ok) return shareFailure(response.status, response.body, 'Could not share')
      return { recipients: parseRecipients(response.body) }
    } catch {
      return { error: NETWORK_SHARE_ERROR, code: 'network' }
    }
  }

  async removeShareRecipient(
    meetingId: string,
    recipientId: string
  ): Promise<ShareRecipientsResult> {
    const target = this.shareTarget(meetingId)
    if ('error' in target) return target
    try {
      const query = `meetingId=${encodeURIComponent(target.record.id)}&recipientId=${encodeURIComponent(recipientId)}`
      const response = await this.shareFetch(
        target.token,
        `/api/sync/share/recipients?${query}`,
        'DELETE'
      )
      if (!response.ok) {
        return shareFailure(response.status, response.body, 'Could not remove access')
      }
      return { recipients: parseRecipients(response.body) }
    } catch {
      return { error: NETWORK_SHARE_ERROR, code: 'network' }
    }
  }

  /**
   * Include transcript, general access and link expiry. Anything that can
   * publish content pushes the meeting first; only turning the link off
   * goes straight to the server.
   */
  async updateShareSettings(
    meetingId: string,
    update: ShareSettingsUpdate
  ): Promise<ShareStateResult> {
    const target = this.shareTarget(meetingId)
    if ('error' in target) return target
    const body = validShareUpdate(update)
    if (!body) return { error: 'Nothing to change.', code: 'request' }
    if ('error' in body) return body
    const revokeOnly =
      body.link === 'off' &&
      body.includeTranscript === undefined &&
      body.expiresInDays === undefined
    try {
      if (!revokeOnly) {
        const pushed = await this.pushForShare(target.record, target.token)
        if (pushed) return pushed
      }
      const response = await this.shareFetch(target.token, '/api/sync/share', 'POST', {
        meetingId: target.record.id,
        ...body
      })
      if (!response.ok) {
        return shareFailure(response.status, response.body, 'Could not save sharing')
      }
      return parseShareState(response.body)
    } catch {
      return { error: NETWORK_SHARE_ERROR, code: 'network' }
    }
  }

  async syncNow(): Promise<SyncStatus> {
    await this.syncCycle()
    return this.status()
  }

  /* ---- pushing ---- */

  private pendingMeetings(): MeetingRecord[] {
    return this.meetings
      .readAll()
      .filter((record) => !record.trashedAt && supportsCloudSync(record))
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
      if (this.config.pendingDeletes.length > 0 || this.config.pendingFolderDeletes.length > 0) {
        const response = await fetch(`${this.baseUrl}/api/sync/push`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ids: this.config.pendingDeletes,
            folderIds: this.config.pendingFolderDeletes
          })
        })
        if (response.ok) {
          this.config.pendingDeletes = []
          this.config.pendingFolderDeletes = []
          this.writeConfig()
        }
      }

      // Folders next — meetings below may reference them server-side.
      const dirtyFolders = this.folders
        .list()
        .filter((f) => this.config.syncedFolders[f.id] !== f.name)
      if (dirtyFolders.length > 0) {
        const response = await fetch(`${this.baseUrl}/api/sync/push`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            folders: dirtyFolders.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt }))
          })
        })
        if (response.ok) {
          for (const f of dirtyFolders) this.config.syncedFolders[f.id] = f.name
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
          const body = (await response.json().catch(() => ({}))) as {
            error?: string
            needsSubscription?: boolean
          }
          if (response.status === 402 && body.needsSubscription) {
            throw new Error(
              body.error ??
                'Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing'
            )
          }
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

  /* ---- pulling ---- */

  /** Create/rename local folders from the cloud list. True when changed. */
  private applyRemoteFolders(
    remote: Array<{ id?: unknown; name?: unknown; createdAt?: unknown }>
  ): boolean {
    let changed = false
    const locals = new Map(this.folders.list().map((f) => [f.id, f]))
    for (const item of remote) {
      const id = String(item.id ?? '')
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) continue
      if (name.length === 0) continue
      const local = locals.get(id)
      const action = decideFolderPull({
        localExists: local !== undefined,
        localName: local?.name ?? null,
        syncedName: this.config.syncedFolders[id] ?? null,
        remoteName: name
      })
      if (action === 'skip') {
        if (local && local.name === name) this.config.syncedFolders[id] = name
        continue
      }
      this.config.syncedFolders[id] = name
      this.writeConfig()
      const record: FolderRecord = {
        id,
        name,
        createdAt:
          local?.createdAt ??
          (typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString())
      }
      this.folders.upsertRemote(record)
      changed = true
    }
    return changed
  }

  /** Remove local folders whose cloud copy vanished (rename-safe). */
  private applyCloudFolderDeletions(remote: Array<{ id?: unknown }>): boolean {
    const cloudIds = new Set(remote.map((f) => String(f.id ?? '')))
    let changed = false
    for (const local of this.folders.list()) {
      const syncedName = this.config.syncedFolders[local.id]
      const remove = shouldRemoveFolderLocally({
        wasSynced: syncedName !== undefined,
        presentInCloud: cloudIds.has(local.id),
        localDirty: syncedName !== undefined && local.name !== syncedName
      })
      if (!remove) continue
      // Drop the bookkeeping first so the delete hook doesn't echo a
      // redundant cloud DELETE for a folder the cloud already removed.
      delete this.config.syncedFolders[local.id]
      this.writeConfig()
      this.folders.delete(local.id) // sweeps member meetings to My notes
      changed = true
    }
    return changed
  }

  /**
   * Cursor-based pull of meetings changed on other devices, applied under
   * the rules in sync-pull-logic.ts. The full cloud id list rides along so
   * remote deletions can soft-trash the local copy (no tombstones needed).
   */
  private async pullAll(): Promise<void> {
    if (this.pulling || !this.config.enabled) return
    const token = this.token()
    if (!token) return
    this.pulling = true
    let storeChanged = false

    try {
      let cursor = this.config.pullCursor ?? ''
      let cloudIds: Set<string> | null = null
      let cloudFolders: Array<{ id?: unknown; name?: unknown }> | null = null
      for (let page = 0; page < MAX_PULL_PAGES; page++) {
        const response = await fetch(
          `${this.baseUrl}/api/sync/pull?since=${encodeURIComponent(cursor)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string
            needsSubscription?: boolean
          }
          if (response.status === 402 && body.needsSubscription) {
            throw new Error(
              body.error ??
                'Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing'
            )
          }
          throw new Error(body.error ?? `Pull failed (HTTP ${response.status})`)
        }
        const body = (await response.json()) as {
          allIds?: unknown
          folders?: Array<{ id?: unknown; name?: unknown; createdAt?: unknown }>
          changed?: RemoteMeeting[]
          hasMore?: boolean
        }
        cloudIds = new Set(Array.isArray(body.allIds) ? body.allIds.map(String) : [])
        // Folders first — meetings in this page may point at them.
        if (Array.isArray(body.folders)) {
          cloudFolders = body.folders
          if (this.applyRemoteFolders(body.folders)) storeChanged = true
        }
        for (const remote of Array.isArray(body.changed) ? body.changed : []) {
          if (this.applyRemote(remote)) storeChanged = true
          if (typeof remote.updatedAt === 'string' && remote.updatedAt > cursor) {
            cursor = remote.updatedAt
          }
        }
        if (body.hasMore !== true) break
      }
      if (cloudIds) {
        if (this.applyCloudDeletions(cloudIds)) storeChanged = true
      }
      if (cloudFolders) {
        if (this.applyCloudFolderDeletions(cloudFolders)) storeChanged = true
      }
      this.config.pullCursor = cursor
      this.config.lastSyncAt = new Date().toISOString()
      this.writeConfig()
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Sync failed'
      console.error('[sync] pull failed:', this.lastError)
    } finally {
      this.pulling = false
      this.emitStatus()
    }

    if (storeChanged) {
      // The Home list refetches on this — imported meetings show up live.
      this.broadcast(MEETINGS_CHANGED_EVENT_CHANNEL, {})
    }
  }

  /** Apply one changed cloud meeting. True when the local store changed. */
  private applyRemote(remote: RemoteMeeting): boolean {
    const id = String(remote.id ?? '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false

    interface WireSegment {
      channel: 'mic' | 'system'
      speaker?: unknown
      text: string
      startMs: number
      endMs: number
      absoluteStartMs?: unknown
      confidence?: unknown
    }
    const segments: TranscriptSegment[] = (Array.isArray(remote.segments) ? remote.segments : [])
      .filter(
        (s): s is WireSegment =>
          (s.channel === 'mic' || s.channel === 'system') &&
          typeof s.text === 'string' &&
          typeof s.startMs === 'number' &&
          Number.isFinite(s.startMs) &&
          typeof s.endMs === 'number' &&
          Number.isFinite(s.endMs)
      )
      .map((s, index) => ({
        // Segment ids are local-only (the cloud stores its own); synthesize.
        id: `${id}-pull-${index}`,
        channel: s.channel,
        // Names assigned on another device arrive as free text; keep them.
        speaker:
          (typeof s.speaker === 'string' ? sanitizeSpeakerName(s.speaker) : '') ||
          defaultSpeakerLabel(s.channel),
        speakerId: defaultSpeakerId(s.channel),
        text: s.text,
        startMs: Math.round(s.startMs),
        endMs: Math.round(s.endMs),
        ...(typeof s.absoluteStartMs === 'number' && Number.isFinite(s.absoluteStartMs)
          ? { absoluteStartMs: Math.round(s.absoluteStartMs) }
          : {}),
        confidence:
          typeof s.confidence === 'number' && Number.isFinite(s.confidence) ? s.confidence : 0.9
      }))

    const incoming: MeetingRecord = {
      id,
      ...(remote.kind === 'note' ? { kind: 'note' as const } : {}),
      title: typeof remote.title === 'string' ? remote.title : '',
      createdAt: typeof remote.createdAt === 'string' ? remote.createdAt : new Date().toISOString(),
      ...(typeof remote.startedAt === 'string' ? { startedAt: remote.startedAt } : {}),
      ...(typeof remote.endedAt === 'string' ? { endedAt: remote.endedAt } : {}),
      ...(typeof remote.calendarEventId === 'string'
        ? { calendarEventId: remote.calendarEventId }
        : {}),
      rawNotesMarkdown: typeof remote.rawNotesMarkdown === 'string' ? remote.rawNotesMarkdown : '',
      ...(typeof remote.enhancedMarkdown === 'string'
        ? { enhancedMarkdown: remote.enhancedMarkdown }
        : {}),
      // null (not absence) so applying clears a stale local assignment.
      folderId: typeof remote.folderId === 'string' ? remote.folderId : null,
      segments,
      echoSuppressed: 0
    }
    const remoteHash = contentHash(incoming, this.config.mediaUrls)

    const local = this.meetings.get(id)
    const action = decidePullAction({
      localExists: local !== null,
      localTrashed: Boolean(local?.trashedAt),
      localHash: local ? contentHash(local, this.config.mediaUrls) : null,
      syncedHash: this.config.pushed[id] ?? null,
      remoteHash
    })
    if (action === 'skip') {
      // Identical content still refreshes the bookkeeping hash.
      if (local && contentHash(local, this.config.mediaUrls) === remoteHash) {
        this.config.pushed[id] = remoteHash
      }
      return false
    }

    // Record the hash FIRST so the upsert's change hook sees this meeting
    // as clean and the debounced push loop doesn't echo it straight back.
    this.config.pushed[id] = remoteHash
    this.writeConfig()
    this.meetings.upsert(incoming)
    return true
  }

  /** Soft-trash synced meetings whose cloud copy disappeared. */
  private applyCloudDeletions(cloudIds: Set<string>): boolean {
    // Push runs before pull, but never reconcile against an empty cloud id
    // list while meetings are still queued — that trashed entire libraries
    // when link + sync raced on a fresh workspace.
    if (cloudIds.size === 0 && this.pendingMeetings().length > 0) return false

    let changed = false
    for (const local of this.meetings.readAll()) {
      const syncedHash = this.config.pushed[local.id]
      const trash = shouldTrashLocally({
        wasSynced: syncedHash !== undefined,
        presentInCloud: cloudIds.has(local.id),
        localTrashed: Boolean(local.trashedAt),
        localDirty:
          syncedHash !== undefined && contentHash(local, this.config.mediaUrls) !== syncedHash
      })
      if (!trash) continue
      // Drop the hash first: the trash upsert fires the delete hook, and a
      // missing entry keeps it from queueing a redundant cloud DELETE.
      delete this.config.pushed[local.id]
      this.writeConfig()
      this.meetings.upsert({ id: local.id, trashedAt: new Date().toISOString() } as MeetingRecord)
      changed = true
    }
    return changed
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
      return parseSyncConfigFromRaw(raw)
    } catch {
      return { ...EMPTY_SYNC_CONFIG }
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

interface RemoteMeeting {
  id?: unknown
  kind?: unknown
  title?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  startedAt?: unknown
  endedAt?: unknown
  calendarEventId?: unknown
  folderId?: unknown
  rawNotesMarkdown?: unknown
  enhancedMarkdown?: unknown
  segments?: Array<{
    channel?: unknown
    speaker?: unknown
    text?: unknown
    startMs?: unknown
    endMs?: unknown
    absoluteStartMs?: unknown
    confidence?: unknown
  }>
}

interface ShareResponseBody {
  error?: unknown
  code?: unknown
  emails?: unknown
  needsSubscription?: unknown
  results?: unknown
  recipients?: unknown
  url?: unknown
  includeTranscript?: unknown
  link?: unknown
  workspace?: unknown
}

/** Maps a failed share-route response to user guidance; never includes the token. */
export function shareFailure(
  status: number,
  body: ShareResponseBody,
  fallback: string
): ShareFailure {
  const message = typeof body.error === 'string' && body.error.length > 0 ? body.error : undefined
  if (status === 401) {
    return {
      code: 'unauthorized',
      error: 'This computer is no longer linked to cloud sync. Reconnect it in Settings.'
    }
  }
  if (status === 402) return { code: 'needs_subscription', error: message ?? SUBSCRIPTION_ERROR }
  if (status === 503) {
    return { code: 'unavailable', error: message ?? 'Cloud sync is unavailable right now.' }
  }
  if (status === 404) {
    return { code: 'not_found', error: message ?? 'Meeting not synced yet — sync it first' }
  }
  const emails = Array.isArray(body.emails)
    ? body.emails.filter((e): e is string => typeof e === 'string')
    : []
  return {
    code: 'request',
    error: message ?? `${fallback} (HTTP ${status})`,
    ...(emails.length > 0 ? { emails } : {})
  }
}

function pushRejectedMessage(reason: unknown): string {
  if (typeof reason === 'string' && /another workspace/i.test(reason)) {
    return 'This meeting belongs to a different cloud workspace, so it can’t be shared from this one.'
  }
  return typeof reason === 'string' && reason.length > 0
    ? `The cloud did not accept this meeting (${reason}), so it was not shared.`
    : 'The cloud did not accept this meeting, so it was not shared.'
}

const NOT_SYNCED_STATE: ShareState = {
  includeTranscript: false,
  link: null,
  recipients: [],
  workspace: null,
  synced: false
}

/** Coerces an IPC payload into a settings update; unknown or mistyped fields are dropped. */
export function sanitizeShareUpdate(raw: unknown): ShareSettingsUpdate {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const update: ShareSettingsUpdate = {}
  if (typeof input.includeTranscript === 'boolean')
    update.includeTranscript = input.includeTranscript
  if (input.link === 'on' || input.link === 'off') update.link = input.link
  if (typeof input.expiresInDays === 'number') {
    update.expiresInDays = input.expiresInDays as ShareSettingsUpdate['expiresInDays']
  }
  return update
}

/** The request body for an update, null when empty, or a local validation error. */
function validShareUpdate(update: ShareSettingsUpdate): ShareSettingsUpdate | ShareFailure | null {
  const body: ShareSettingsUpdate = {}
  if (update.includeTranscript !== undefined)
    body.includeTranscript = update.includeTranscript === true
  if (update.link !== undefined) {
    if (update.link !== 'on' && update.link !== 'off') {
      return { error: 'Choose who can open the link.', code: 'request' }
    }
    body.link = update.link
  }
  if (update.expiresInDays !== undefined) {
    if (!(SHARE_LINK_EXPIRY_DAYS as readonly number[]).includes(update.expiresInDays)) {
      return { error: 'Choose when the link expires.', code: 'request' }
    }
    body.expiresInDays = update.expiresInDays
  }
  return Object.keys(body).length === 0 ? null : body
}

function parseRecipients(body: ShareResponseBody): ShareRecipient[] {
  if (!Array.isArray(body.recipients)) return []
  return body.recipients.flatMap((raw: unknown) => {
    const r = (raw ?? {}) as Record<string, unknown>
    return typeof r.id === 'string' && typeof r.email === 'string'
      ? [
          {
            id: r.id,
            email: r.email,
            createdAt: typeof r.createdAt === 'string' ? r.createdAt : ''
          }
        ]
      : []
  })
}

function parseLink(raw: unknown): ShareLink | null {
  const link = (raw ?? {}) as Record<string, unknown>
  if (typeof link.url !== 'string' || link.url.length === 0) return null
  return { url: link.url, expiresAt: typeof link.expiresAt === 'string' ? link.expiresAt : null }
}

function parseWorkspace(raw: unknown): ShareWorkspace | null {
  const workspace = (raw ?? {}) as Record<string, unknown>
  if (typeof workspace.name !== 'string') return null
  return {
    name: workspace.name,
    personal: workspace.personal === true,
    memberCount: typeof workspace.memberCount === 'number' ? workspace.memberCount : 0
  }
}

function parseShareState(body: ShareResponseBody): ShareState {
  return {
    includeTranscript: body.includeTranscript === true,
    link: parseLink(body.link),
    recipients: parseRecipients(body),
    workspace: parseWorkspace(body.workspace),
    synced: true
  }
}

function toPushMeeting(record: MeetingRecord, mediaUrls: Record<string, string>): object {
  return {
    id: record.id,
    ...(record.kind === 'note' ? { kind: 'note' } : {}),
    title: record.title,
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    ...(record.calendarEventId ? { calendarEventId: record.calendarEventId } : {}),
    ...(record.folderId ? { folderId: record.folderId } : {}),
    ...(record.rawNotesMarkdown
      ? { rawNotesMarkdown: rewriteMedia(record.rawNotesMarkdown, mediaUrls) }
      : {}),
    ...(record.enhancedMarkdown
      ? { enhancedMarkdown: rewriteMedia(record.enhancedMarkdown, mediaUrls) }
      : {}),
    segments: syncableSegments(record).map((s) => ({
      channel: s.channel,
      speaker: s.speaker,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
      // The audio-playback seek anchor; without it, click-to-seek on a
      // synced meeting degrades to the channel-relative approximation.
      ...(typeof s.absoluteStartMs === 'number' ? { absoluteStartMs: s.absoluteStartMs } : {}),
      confidence: s.confidence
    }))
  }
}
