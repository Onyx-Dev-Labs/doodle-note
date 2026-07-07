/**
 * Pure decision logic for applying pulled cloud meetings to the local
 * store, Electron-free so it unit-tests with node:test. SyncService feeds
 * it one remote meeting at a time plus the local bookkeeping hashes.
 *
 * The invariant behind every rule: LOCAL EDITS ALWAYS WIN until they've
 * been pushed. A meeting is "dirty" when its current local hash differs
 * from the hash recorded at its last successful push/pull — applying a
 * remote copy over a dirty meeting would eat unsynced work.
 */

export type PullAction = 'import' | 'apply' | 'skip'

export interface PullDecisionInput {
  /** The meeting exists locally. */
  localExists: boolean
  /** Local copy is in the trash (user intent — never resurrect over it). */
  localTrashed: boolean
  /** Hash of the local record's current content, null when absent. */
  localHash: string | null
  /** Hash recorded at this meeting's last successful push/pull, if any. */
  syncedHash: string | null
  /** Hash of the remote content as it would be stored locally. */
  remoteHash: string
}

/** What to do with one changed meeting from the pull feed. */
export function decidePullAction(input: PullDecisionInput): PullAction {
  if (!input.localExists) return 'import'
  if (input.localTrashed) return 'skip' // pendingDeletes will clear the cloud copy
  if (input.localHash === input.remoteHash) return 'skip' // already identical
  // Dirty: local content differs from what was last synced — push wins.
  if (input.syncedHash === null || input.localHash !== input.syncedHash) return 'skip'
  return 'apply'
}

export interface DeleteDecisionInput {
  /** The id was synced with the cloud at some point (pushed or imported). */
  wasSynced: boolean
  /** The id is present in the cloud's current full id list. */
  presentInCloud: boolean
  /** Local copy is already in the trash. */
  localTrashed: boolean
  /** Local copy has edits that never made it to the cloud. */
  localDirty: boolean
}

/**
 * True when a local meeting should be soft-trashed because its cloud copy
 * disappeared (deleted on another device or on the dashboard). Soft-trash,
 * never hard-delete: the user can restore from Trash if this was a surprise.
 * Dirty meetings are spared — unsynced edits outrank a remote deletion.
 */
export function shouldTrashLocally(input: DeleteDecisionInput): boolean {
  return input.wasSynced && !input.presentInCloud && !input.localTrashed && !input.localDirty
}

/* ---- folders ---- */

export type FolderPullAction = 'create' | 'rename' | 'skip'

export interface FolderPullInput {
  localExists: boolean
  /** Current local name, null when absent. */
  localName: string | null
  /** Name recorded at the folder's last successful sync, if any. */
  syncedName: string | null
  remoteName: string
}

/** Same discipline as meetings: an unsynced local rename outranks remote. */
export function decideFolderPull(input: FolderPullInput): FolderPullAction {
  if (!input.localExists) return 'create'
  if (input.localName === input.remoteName) return 'skip'
  if (input.syncedName === null || input.localName !== input.syncedName) return 'skip'
  return 'rename'
}

export interface FolderDeleteInput {
  wasSynced: boolean
  presentInCloud: boolean
  /** Local name differs from the last-synced name (rename pending push). */
  localDirty: boolean
}

/** Remove locally when the cloud copy vanished — unless a rename is pending. */
export function shouldRemoveFolderLocally(input: FolderDeleteInput): boolean {
  return input.wasSynced && !input.presentInCloud && !input.localDirty
}
