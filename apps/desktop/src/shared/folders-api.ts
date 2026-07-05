/**
 * Shared folders-store IPC contract, used by main + preload + renderer.
 *
 * Folders are a flat list persisted as userData/folders.json; meetings point
 * at them via MeetingRecord.folderId. Deleting a folder never deletes its
 * meetings — they fall back to "My notes" (folderId: null).
 */

export const FOLDERS_LIST_CHANNEL = 'folders:list'
export const FOLDERS_CREATE_CHANNEL = 'folders:create'
export const FOLDERS_RENAME_CHANNEL = 'folders:rename'
export const FOLDERS_DELETE_CHANNEL = 'folders:delete'

/** One folder as stored in userData/folders.json. */
export interface FolderRecord {
  id: string
  name: string
  /** ISO timestamp of creation. */
  createdAt: string
}

/** API surface exposed on `window.folders` by the preload script. */
export interface FoldersApi {
  list(): Promise<FolderRecord[]>
  create(name: string): Promise<FolderRecord>
  rename(id: string, name: string): Promise<FolderRecord | null>
  remove(id: string): Promise<void>
}
