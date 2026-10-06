export const DETECT_GET_STATE_CHANNEL = 'detect:get-state'
export const DETECT_SET_PREFS_CHANNEL = 'detect:set-prefs'
/** Broadcast when the meeting app released the mic mid-recording. */
export const DETECT_MEETING_ENDED_CHANNEL = 'detect:meeting-ended'
export type AutoStopStatus = 'disabled' | 'waiting' | 'armed' | 'unavailable' | 'stopping'
export const DETECT_AUTO_STOP_STATE_CHANNEL = 'detect:auto-stop-state'
export interface CaptureStopState {
  captureId: string
  meetingId?: string
  phase: 'active' | 'requested' | 'stopped' | 'completed' | 'failed'
  reason?: 'manual' | 'meeting-ended'
}
export interface AutoStopState {
  status: AutoStopStatus
  stop: CaptureStopState | null
}

export interface DetectState {
  /** DoodleNote starts when you log in to your Mac (OS is source of truth). */
  loginItem: boolean
  /** Prompt when another app holds the microphone open (ad-hoc meetings). */
  micDetect: boolean
  /** Stop the recording when the meeting app hangs up. */
  autoStop: boolean
  /** Detection and confirmed Stop lifecycle for the current/last capture. */
  autoStopState?: AutoStopState
  /** The engine micmon child is currently alive (diagnostic). */
  micMonitorAlive: boolean
  /** Mic-activity detection: macOS (CoreAudio) and Windows (ConsentStore). */
  micDetectSupported: boolean
  /** process.platform, for platform-specific renderer copy. */
  platform: string
  /** Running app version (package.json), e.g. "0.2.1". */
  appVersion: string
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
  onAutoStopState(cb: (state: AutoStopState) => void): () => void
}
