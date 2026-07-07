export const UPDATE_GET_STATE_CHANNEL = 'update:get-state'
export const UPDATE_CHECK_CHANNEL = 'update:check'
export const UPDATE_INSTALL_CHANNEL = 'update:install'
export const UPDATE_STATE_EVENT_CHANNEL = 'update:state-event'

export interface UpdateState {
  /** Version currently running. */
  currentVersion: string
  /** False in dev builds — the feed only serves packaged apps. */
  supported: boolean
  status: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  /** Version on the feed when newer than current. */
  latestVersion?: string
  /** Download progress 0-100 while status is "downloading". */
  percent?: number
  error?: string
}

export interface UpdateApi {
  getState(): Promise<UpdateState>
  /** Manual "Check for updates". Resolves with the post-check state. */
  check(): Promise<UpdateState>
  /** Quit and install the downloaded update (status must be "downloaded"). */
  install(): Promise<void>
  onState(cb: (state: UpdateState) => void): () => void
}
