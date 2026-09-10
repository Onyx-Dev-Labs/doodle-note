import type { SyncStatus } from '../../../shared/sync-api'

/** IPC replies can arrive after a newer event, including cancel/retry in the same account. */
export function latestSyncStatus(previous: SyncStatus | null, next: SyncStatus): SyncStatus {
  return previous && previous.statusRevision > next.statusRevision ? previous : next
}
