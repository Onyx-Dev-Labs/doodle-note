export const DETECT_GET_STATE_CHANNEL = 'detect:get-state'
export const DETECT_SET_PREFS_CHANNEL = 'detect:set-prefs'
/** Broadcast when the meeting app released the mic mid-recording. */
export const DETECT_MEETING_ENDED_CHANNEL = 'detect:meeting-ended'

export interface DetectState {
  /** DoodleNote starts when you log in to your Mac (OS is source of truth). */
  loginItem: boolean
  /** Prompt when another app holds the microphone open (ad-hoc meetings). */
  micDetect: boolean
  /** Stop the recording when the meeting app hangs up. */
  autoStop: boolean
  /** The engine micmon child is currently alive (diagnostic). */
  micMonitorAlive: boolean
}

export interface DetectPrefsUpdate {
  loginItem?: boolean
  micDetect?: boolean
  autoStop?: boolean
}

export interface DetectApi {
  getState(): Promise<DetectState>
  setPrefs(update: DetectPrefsUpdate): Promise<DetectState>
  /** The meeting ended while recording — the editor stops its capture. */
  onMeetingEnded(cb: () => void): () => void
}
