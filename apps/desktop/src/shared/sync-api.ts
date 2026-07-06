export const SYNC_GET_STATUS_CHANNEL = 'sync:get-status'
export const SYNC_CONNECT_CHANNEL = 'sync:connect'
export const SYNC_DISCONNECT_CHANNEL = 'sync:disconnect'
export const SYNC_SET_ENABLED_CHANNEL = 'sync:set-enabled'
export const SYNC_NOW_CHANNEL = 'sync:now'
export const SYNC_STATUS_EVENT_CHANNEL = 'sync:status-event'

export interface SyncStatus {
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
}

export interface SyncApi {
  getStatus(): Promise<SyncStatus>
  /** Opens the browser link flow; resolves when linked, failed, or timed out. */
  connect(): Promise<SyncStatus>
  disconnect(): Promise<SyncStatus>
  setEnabled(enabled: boolean): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  onStatus(cb: (status: SyncStatus) => void): () => void
}
