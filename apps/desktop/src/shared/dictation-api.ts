import type { AppChannel } from './app-channel'
import type { HoldKey } from './dictation-helper-protocol'
import type { InputDevice, PillEdge } from './dictation-pill'
import type { CleanupMode, Phase, RecoveryReason } from './dictation-session'

export const DICTATION_GET_STATUS_CHANNEL = 'dictation:get-status'
export const DICTATION_SET_SETTINGS_CHANNEL = 'dictation:set-settings'
export const DICTATION_TOGGLE_CHANNEL = 'dictation:toggle'
export const DICTATION_CANCEL_CHANNEL = 'dictation:cancel'
export const DICTATION_COPY_RECOVERY_CHANNEL = 'dictation:copy-recovery'
export const DICTATION_DISMISS_RECOVERY_CHANNEL = 'dictation:dismiss-recovery'
export const DICTATION_OPEN_PRIVACY_CHANNEL = 'dictation:open-privacy'
export const DICTATION_STATUS_EVENT_CHANNEL = 'dictation:status-event'
/** main → renderer: the pill's menu asked for the dictation settings page. */
export const DICTATION_OPEN_SETTINGS_EVENT_CHANNEL = 'dictation:open-settings'
export const DICTATION_PASTE_LAST_CHANNEL = 'dictation:paste-last'
export const DICTATION_COPY_LAST_CHANNEL = 'dictation:copy-last'

export interface DictationSettings {
  /** Master switch. Off means no shortcut, no helper and no microphone use. */
  enabled: boolean
  /** Electron accelerator for press-to-start / press-to-stop; empty disables it. */
  toggleShortcut: string
  /** Modifier held on its own for hold-to-talk. */
  holdKey: HoldKey
  /** Recognition is always local; this only chooses what happens to the text. */
  cleanupMode: CleanupMode
  /**
   * Approval to send dictated TEXT to one provider/model. Bound to that pair:
   * changing either invalidates it. Never covers audio.
   */
  byokConsent: { provider: string; model: string } | null
  /** Keep the resting pill on screen when no dictation is running. */
  showPill: boolean
  /** The screen edge the pill docks to. */
  pillEdge: PillEdge
  /** Epoch ms until which "hide for an hour" keeps the pill away; null = not hidden. */
  pillHiddenUntil: number | null
  /** CoreAudio UID of the chosen microphone; null = the system default. */
  microphoneUid: string | null
  /** Play a short tone when recording starts and stops. */
  startSound: boolean
  /** Two quick taps of the hold key latch hands-free. */
  handsFreeDoubleTap: boolean
  /** Electron accelerator that types the last transcript again; empty disables it. */
  pasteLastShortcut: string
  /** Electron accelerator that puts the last transcript on the clipboard; empty disables it. */
  copyLastShortcut: string
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: false,
  toggleShortcut: 'Control+Alt+D',
  holdKey: 'off',
  cleanupMode: 'raw',
  byokConsent: null,
  showPill: true,
  pillEdge: 'bottom',
  pillHiddenUntil: null,
  microphoneUid: null,
  startSound: true,
  handsFreeDoubleTap: true,
  pasteLastShortcut: 'Control+Alt+Shift+V',
  copyLastShortcut: 'Control+Alt+Shift+C'
}

export type DictationSettingsUpdate = Partial<DictationSettings>

export type MicrophoneAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
export type ShortcutState = 'off' | 'registered' | 'conflict' | 'invalid'

export interface DictationPermissions {
  microphone: MicrophoneAccess
  /** Needed to see the focused field and insert text. Null until the helper answers. */
  accessibility: boolean | null
  /** Needed only for hold-to-talk. */
  inputMonitoring: boolean | null
}

export interface RecoveryItem {
  gen: number
  text: string
  reason: RecoveryReason
  at: number
}

export interface DictationStatus {
  channel: AppChannel
  supported: boolean
  settings: DictationSettings
  phase: Phase
  permissions: DictationPermissions
  helper: 'ready' | 'unavailable'
  toggleShortcut: ShortcutState
  pasteLastShortcut: ShortcutState
  copyLastShortcut: ShortcutState
  /** What macOS does on a Fn/Globe press (0 nothing, 1 input source, 2 emoji, 3 dictation); null = unknown. */
  fnKeyAction: number | null
  /** Input devices last seen by the engine; empty until the first listing returns. */
  microphones: InputDevice[]
  /** The saved microphone is not among the listed devices (the default is used). */
  microphoneMissing: boolean
  /** "Hide for an hour" is running right now. */
  pillHidden: boolean
  /** Whether a transcript is held in memory for "paste last". The text itself is never sent. */
  hasLastTranscript: boolean
  holdKey: 'off' | 'active' | 'needs-permission' | 'unavailable'
  /** Names of other dictation apps detected running; shortcuts may overlap. */
  conflicts: string[]
  /** warm: models loaded in the resident engine; cold: first use loads them. */
  speech: 'warm' | 'cold' | 'unavailable'
  cleanup: {
    localModelLabel: string | null
    byok: { provider: string; model: string; hasKey: boolean } | null
  }
  /** Most recent texts that could not be inserted, newest first. */
  recoveries: RecoveryItem[]
  lastLatency: DictationLatency | null
}

/** Measured on this machine for the most recent completed session. */
export interface DictationLatency {
  /** Shortcut to microphone open. */
  startMs: number | null
  /** Stop to final transcript. */
  stopToFinalMs: number | null
  cleanupMs: number | null
  /** Delivery request to helper reply. */
  insertMs: number | null
  recordedMs: number | null
  warm: boolean
}

export interface DictationApi {
  getStatus(): Promise<DictationStatus>
  setSettings(update: DictationSettingsUpdate): Promise<DictationStatus>
  /** Start, or stop if already recording. Same action as the shortcut. */
  toggle(): Promise<void>
  cancel(): Promise<void>
  /** Type the most recent transcript into the focused field again. */
  pasteLast(): Promise<void>
  /** Put the most recent transcript on the clipboard. */
  copyLast(): Promise<void>
  copyRecovery(gen: number): Promise<boolean>
  dismissRecovery(gen: number): Promise<void>
  openPrivacySettings(pane: 'microphone' | 'accessibility' | 'input-monitoring'): Promise<void>
  onStatus(cb: (status: DictationStatus) => void): () => void
  /** The pill's menu asked to open the dictation settings. */
  onOpenSettings(cb: () => void): () => void
}
