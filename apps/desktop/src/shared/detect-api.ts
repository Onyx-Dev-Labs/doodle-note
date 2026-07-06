export const DETECT_GET_STATE_CHANNEL = 'detect:get-state'
export const DETECT_SET_PREFS_CHANNEL = 'detect:set-prefs'

export interface DetectState {
  /** DoodleNote starts when you log in to your Mac (OS is source of truth). */
  loginItem: boolean
  /** Prompt when another app holds the microphone open (ad-hoc meetings). */
  micDetect: boolean
  /** The engine micmon child is currently alive (diagnostic). */
  micMonitorAlive: boolean
}

export interface DetectPrefsUpdate {
  loginItem?: boolean
  micDetect?: boolean
}

export interface DetectApi {
  getState(): Promise<DetectState>
  setPrefs(update: DetectPrefsUpdate): Promise<DetectState>
}
