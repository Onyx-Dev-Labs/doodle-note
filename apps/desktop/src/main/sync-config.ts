/** Persisted desktop sync state in userData/sync.json. */
export interface SyncConfig {
  enabled: boolean
  /** safeStorage-encrypted sync token, base64. */
  tokenEnc?: string
  email?: string
  workspaceName?: string
  lastSyncAt?: string
  /** meetingId → content hash at last successful sync (push OR pull). */
  pushed: Record<string, string>
  /** updatedAt high-water mark of the last pull. */
  pullCursor?: string
  /** folderId → name at last successful sync (either direction). */
  syncedFolders: Record<string, string>
  /** Local folders deleted whose cloud copy still needs removing. */
  pendingFolderDeletes: string[]
  /** attachment file name → public blob URL (uploaded once, reused). */
  mediaUrls: Record<string, string>
  /** Local meetings deleted/trashed whose cloud copy still needs removing. */
  pendingDeletes: string[]
}

export const EMPTY_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  pushed: {},
  mediaUrls: {},
  pendingDeletes: [],
  syncedFolders: {},
  pendingFolderDeletes: []
}

/** Parse sync.json fields off disk — pure, unit-testable. */
export function parseSyncConfigFromRaw(raw: Partial<SyncConfig>): SyncConfig {
  return {
    enabled: raw.enabled === true,
    ...(typeof raw.tokenEnc === 'string' ? { tokenEnc: raw.tokenEnc } : {}),
    ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
    ...(typeof raw.workspaceName === 'string' ? { workspaceName: raw.workspaceName } : {}),
    ...(typeof raw.lastSyncAt === 'string' ? { lastSyncAt: raw.lastSyncAt } : {}),
    pushed:
      raw.pushed && typeof raw.pushed === 'object' ? (raw.pushed as Record<string, string>) : {},
    mediaUrls:
      raw.mediaUrls && typeof raw.mediaUrls === 'object'
        ? (raw.mediaUrls as Record<string, string>)
        : {},
    pendingDeletes: Array.isArray(raw.pendingDeletes) ? raw.pendingDeletes.map(String) : [],
    syncedFolders:
      raw.syncedFolders && typeof raw.syncedFolders === 'object'
        ? (raw.syncedFolders as Record<string, string>)
        : {},
    pendingFolderDeletes: Array.isArray(raw.pendingFolderDeletes)
      ? raw.pendingFolderDeletes.map(String)
      : [],
    ...(typeof raw.pullCursor === 'string' ? { pullCursor: raw.pullCursor } : {})
  }
}
