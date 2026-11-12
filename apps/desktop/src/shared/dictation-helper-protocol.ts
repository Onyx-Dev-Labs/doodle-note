/** Typed view of the NDJSON contract with the native dictation helper. */

export interface HelperStatus {
  accessibility: boolean
  inputMonitoring: boolean
  secureInput: boolean
  /** Running dictation apps whose shortcuts may overlap (names only). */
  conflicts: string[]
  holdActive: boolean
  mouseActive: boolean
  /** Input Monitoring as macOS reports it; null when the helper does not say. */
  inputMonitoringAccess: 'granted' | 'denied' | 'not-determined' | null
  /**
   * What macOS does on its own when the Fn/Globe key is pressed: 0 nothing,
   * 1 change input source, 2 emoji and symbols, 3 start dictation. Null when
   * the setting cannot be read.
   */
  fnKeyAction: number | null
}

export interface TargetDescription {
  snapshotId: string
  pid: number
  bundleId: string
  appName: string
  /** The app bundle on disk, used only to draw its icon. May be absent or empty. */
  appPath?: string
  hasElement: boolean
  accessibility: boolean
  role?: string
  secure?: boolean
  editable?: boolean
}

/** An installed app's own name and icon, found from its bundle identifier. Null when not installed. */
export interface AppInfoEntry {
  bundleId: string
  name: string | null
  /** A small PNG data URL. */
  icon: string | null
}

/** Guards for a delivery that edits text already in the field. */
export interface DeliveryGuards {
  /** Plain dictation targets the field focused at delivery, not at recording start. */
  useCurrentFocus?: boolean
  /** Refuse unless the selection is exactly this text. */
  expectSelection?: string
  /** Select the one copy of this text in the field and replace it; refuse if it is not there once. */
  replace?: string
  /** After a confirmed insertion, keep the field so it can be read back for a few minutes. */
  watch?: boolean
}

/**
 * A read-back of a watched field. `ok` carries the field's text and whether it
 * still has the user's focus. gone: the field or its app no longer exists (a sent
 * message usually clears or removes it). secure: it became a password field.
 * unreadable: this control does not expose its text. too-long: over the size cap.
 */
export type FieldReading =
  | { state: 'ok'; value: string; focused: boolean }
  | { state: 'gone' | 'secure' | 'unreadable' | 'too-long' }

export type SelectionResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'no-target' | 'focus-changed' | 'secure-field' | 'unavailable' }

export type HelperDeliveryOutcome = 'delivered' | 'uncertain' | 'refused' | 'failed'

/** Where the helper's time went for one insertion, whole milliseconds. Numbers only. */
export interface HelperDeliveryTimings {
  /** Re-validating the target right before touching it. */
  validateMs: number
  /** The insertion call itself. */
  insertMs: number
  /** Polling the control to see the text arrive. */
  confirmMs: number
  /** A fixed wait before restoring the clipboard when arrival cannot be seen. */
  settleMs: number
  /** Accessibility insertion was skipped because this app ignores it. */
  skippedAx: boolean
}

export interface HelperDelivery {
  outcome: HelperDeliveryOutcome
  reason?: string
  method?: 'ax' | 'paste'
  verified: boolean
  /** untouched | restored | user-changed | partial */
  clipboard: string
  timings?: HelperDeliveryTimings
}

export type HoldFailure = 'input-monitoring-denied' | 'unknown-key' | 'helper-unavailable'

/**
 * Mouse buttons are numbered from 0: 0 left, 1 right, 2 middle, 3 back, 4 forward,
 * then the extras. Only 2 and up may be a trigger; left and right click never.
 */
export const MIN_MOUSE_TRIGGER_BUTTON = 2
export const MAX_MOUSE_TRIGGER_BUTTON = 31

export function isAllowedMouseButton(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MOUSE_TRIGGER_BUTTON &&
    value <= MAX_MOUSE_TRIGGER_BUTTON
  )
}

/** click: every press is a click (start, then stop). hold: hold to talk, double tap for hands-free. */
export const MOUSE_MODES = ['click', 'hold'] as const
export type MouseMode = (typeof MOUSE_MODES)[number]

export type MouseFailure = HoldFailure | 'invalid-button'

export type MouseStartResult =
  | {
      ok: true
      /** The helper consumes this button's events so other apps never see them. */ swallowing: boolean
    }
  | { ok: false; failure: MouseFailure }

export type MouseCaptureFailure =
  'primary-button' | 'timeout' | 'input-monitoring-denied' | 'helper-unavailable' | 'failed'

export type MouseCaptureResult =
  { ok: true; button: number } | { ok: false; failure: MouseCaptureFailure }

export const HOLD_KEYS = ['off', 'rightOption', 'rightControl', 'rightCommand', 'fn'] as const
export type HoldKey = (typeof HOLD_KEYS)[number]

/** What the helper could read about the microphone a session is recording from. */
export interface InputState {
  /** The device's mute switch, when it has one. */
  muted: boolean | null
  /** Input volume 0..1, when the device exposes one. */
  volume: number | null
}

/** Muted, or turned all the way down: either way the user will not be heard. */
export function micLooksMuted(state: InputState | null): boolean {
  if (!state) return false
  return state.muted === true || (state.volume !== null && state.volume <= 0)
}
