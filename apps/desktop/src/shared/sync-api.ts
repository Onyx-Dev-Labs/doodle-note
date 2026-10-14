export const SYNC_GET_STATUS_CHANNEL = 'sync:get-status'
export const SYNC_REMOTE_MCP_ELIGIBILITY_CHANNEL = 'sync:remote-mcp-eligibility'
export const SYNC_CANCEL_CONNECT_CHANNEL = 'sync:cancel-connect'
export const SYNC_CONNECT_CHANNEL = 'sync:connect'
export const SYNC_DISCONNECT_CHANNEL = 'sync:disconnect'
export const SYNC_SET_ENABLED_CHANNEL = 'sync:set-enabled'
export const SYNC_NOW_CHANNEL = 'sync:now'
export const SYNC_SHARE_CHANNEL = 'sync:share'
export const SYNC_SHARE_STATE_CHANNEL = 'sync:share-state'
export const SYNC_SHARE_ADD_RECIPIENTS_CHANNEL = 'sync:share-add-recipients'
export const SYNC_SHARE_REMOVE_RECIPIENT_CHANNEL = 'sync:share-remove-recipient'
export const SYNC_SHARE_SET_LINK_CHANNEL = 'sync:share-set-link'
export const SYNC_SHARE_REVOKE_LINK_CHANNEL = 'sync:share-revoke-link'
export const SYNC_STATUS_EVENT_CHANNEL = 'sync:status-event'

export interface SyncStatus {
  /** Monotonic status ordering, including pending link lifecycle changes. */
  statusRevision: number
  /** In-memory generation: invalidates UI state when a device is linked/disconnected. */
  connectionRevision: number
  /** A sync token is stored (the device has been linked). */
  connected: boolean
  /** Account email captured during linking. */
  email?: string
  /** Cloud workspace the device pushes into. */
  workspaceName?: string
  /** User's "Sync with cloud" toggle. Off by default — local-first. */
  enabled: boolean
  /** A push cycle is running right now. */
  syncing: boolean
  /** ISO time of the last fully successful push cycle. */
  lastSyncAt?: string
  /** Meetings whose local content hasn't been pushed yet. */
  pendingCount: number
  /** Last push/link error, cleared on the next success. */
  lastError?: string
  /** True while the browser link flow is waiting for approval. */
  linking: boolean
  /** Web app origin (prod, or DOODLE_SYNC_URL override) for building links. */
  baseUrl: string
}

export type ShareResult = { url: string } | { error: string }

/** Someone a meeting is shared with (never reveals whether they have an account). */
export interface ShareRecipient {
  id: string
  email: string
  includeTranscript: boolean
  createdAt: string
}

/** A meeting's public link; `expiresAt` null = never expires. */
export interface PublicLink {
  url: string
  includeTranscript: boolean
  expiresAt: string | null
}

/** Public-link lifetimes the server accepts; 0 = never expires. */
export const PUBLIC_LINK_EXPIRY_DAYS = [0, 1, 7, 30] as const
export type PublicLinkExpiryDays = (typeof PUBLIC_LINK_EXPIRY_DAYS)[number]

export interface PublicLinkOptions {
  includeTranscript: boolean
  expiresInDays: PublicLinkExpiryDays
}

/**
 * Why a share request failed. The first group blocks the whole dialog
 * (show the guidance, offer no actions); `request` is a per-request error.
 */
export type ShareFailureCode =
  | 'not_linked'
  | 'unauthorized'
  | 'needs_subscription'
  | 'unavailable'
  | 'local_only'
  | 'not_found'
  | 'push_rejected'
  | 'request'
  | 'network'

export interface ShareFailure {
  error: string
  code: ShareFailureCode
  /** Addresses the server rejected (invalid, duplicate, already shared). */
  emails?: string[]
}

/** Dialog state. `synced` is false while the cloud has no copy yet (nothing shared). */
export type ShareStateResult =
  { recipients: ShareRecipient[]; link: PublicLink | null; synced: boolean } | ShareFailure
export type ShareRecipientsResult = { recipients: ShareRecipient[] } | ShareFailure
export type PublicLinkResult = { link: PublicLink | null } | ShareFailure

export interface SyncApi {
  reader(request: unknown): Promise<unknown>
  /** Push the meeting (fresh) and mint/fetch its public share link. */
  share(meetingId: string): Promise<ShareResult>
  /** Current recipients and public link; reads only, never pushes. */
  shareState(meetingId: string): Promise<ShareStateResult>
  /** Push the meeting, then share it with one or more comma/space-separated addresses. */
  addShareRecipients(
    meetingId: string,
    emails: string,
    includeTranscript: boolean
  ): Promise<ShareRecipientsResult>
  removeShareRecipient(meetingId: string, recipientId: string): Promise<ShareRecipientsResult>
  /** Push the meeting, then create or update its public link with these options. */
  setPublicLink(meetingId: string, options: PublicLinkOptions): Promise<PublicLinkResult>
  revokePublicLink(meetingId: string): Promise<PublicLinkResult>
  getStatus(): Promise<SyncStatus>
  /** Revalidate paid remote-setup visibility; does not enable Sync or upload data. */
  getRemoteMcpEligibility(): Promise<boolean>
  /** Opens the browser link flow; resolves when linked, failed, or timed out. */
  connect(): Promise<SyncStatus>
  /** Retires only the pending attempt; leaves existing account and notes intact. */
  cancelConnect(): Promise<SyncStatus>
  disconnect(): Promise<SyncStatus>
  setEnabled(enabled: boolean): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  onStatus(cb: (status: SyncStatus) => void): () => void
}
