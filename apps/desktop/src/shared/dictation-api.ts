import type { AppChannel } from './app-channel'
import type { HoldKey } from './dictation-helper-protocol'
import type { CleanupMode, Phase, RecoveryReason } from './dictation-session'

export const DICTATION_GET_STATUS_CHANNEL = 'dictation:get-status'
export const DICTATION_SET_SETTINGS_CHANNEL = 'dictation:set-settings'
export const DICTATION_TOGGLE_CHANNEL = 'dictation:toggle'
export const DICTATION_CANCEL_CHANNEL = 'dictation:cancel'
export const DICTATION_COPY_RECOVERY_CHANNEL = 'dictation:copy-recovery'
export const DICTATION_DISMISS_RECOVERY_CHANNEL = 'dictation:dismiss-recovery'
export const DICTATION_OPEN_PRIVACY_CHANNEL = 'dictation:open-privacy'
export const DICTATION_STATUS_EVENT_CHANNEL = 'dictation:status-event'

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
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: false,
  toggleShortcut: 'Control+Alt+D',
  holdKey: 'off',
  cleanupMode: 'raw',
  byokConsent: null
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
  copyRecovery(gen: number): Promise<boolean>
  dismissRecovery(gen: number): Promise<void>
  openPrivacySettings(pane: 'microphone' | 'accessibility' | 'input-monitoring'): Promise<void>
  onStatus(cb: (status: DictationStatus) => void): () => void
}
