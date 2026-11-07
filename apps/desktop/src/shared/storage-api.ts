export const STORAGE_STATUS_CHANNEL = 'storage:status'
export const STORAGE_CHOOSE_CHANNEL = 'storage:choose'
export const STORAGE_RETRY_CHANNEL = 'storage:retry'
export const STORAGE_PROGRESS_CHANNEL = 'storage:progress'
export const STORAGE_CANCEL_CHANNEL = 'storage:cancel'
export const STORAGE_OPEN_CHANNEL = 'storage:open'

export interface StorageStatus {
  currentPath: string
  pendingPath?: string
  recoveryPath?: string
}

export interface StorageResult {
  status?: StorageStatus
  error?: string
}

export interface StorageApi {
  status(): Promise<StorageStatus>
  choose(): Promise<StorageResult>
  retry(): Promise<StorageResult>
  onProgress(callback: (progress: StorageProgress) => void): () => void
  cancel(): Promise<StorageResult>
  open(): Promise<StorageResult>
}

export interface StorageProgress {
  phase: 'waiting' | 'copying' | 'verifying'
  completedBytes?: number
  totalBytes?: number
  /** Extra status, e.g. a Windows file-lock retry while the transfer finishes. */
  detail?: string
}

/**
 * Where the library location can be chosen and transferred. The controller
 * (library-storage.ts) is platform-neutral and its transfer tests run on
 * macOS and Windows; other platforms keep the library in the app profile.
 */
export function supportsLibraryLocation(platform: string | undefined): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/** The system file manager's name, for "Open in …" actions. */
export function fileManagerName(platform: string | undefined): string {
  return platform === 'win32' ? 'File Explorer' : 'Finder'
}
