export const STORAGE_STATUS_CHANNEL = 'storage:status'
export const STORAGE_CHOOSE_CHANNEL = 'storage:choose'
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
  cancel(): Promise<StorageResult>
  open(): Promise<StorageResult>
}
