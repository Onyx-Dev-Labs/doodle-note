import type { AppChannel } from './app-channel'
import type { DictionaryEntry } from './dictation-dictionary'
import type { HelperDeliveryTimings, HoldKey, MouseMode } from './dictation-helper-protocol'
import type { PermissionOutcome, PermissionPane } from './dictation-permissions'
import type { InputDevice, PillEdge } from './dictation-pill'
import {
  DEFAULT_STYLES,
  EMPTY_STYLE_APPS,
  type StyleApps,
  type StyleChoices
} from './dictation-style'
import { DEFAULT_TRANSFORM_SETTINGS, type TransformSettings } from './dictation-transforms'
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
export const DICTATION_RUN_TRANSFORM_CHANNEL = 'dictation:run-transform'
export const DICTATION_VIEW_CHANGE_CHANNEL = 'dictation:view-change'
export const DICTATION_UNDO_CHANGE_CHANNEL = 'dictation:undo-change'
export const DICTATION_REQUEST_PERMISSION_CHANNEL = 'dictation:request-permission'
export const DICTATION_CAPTURE_MOUSE_BUTTON_CHANNEL = 'dictation:capture-mouse-button'
export const DICTATION_APP_INFO_CHANNEL = 'dictation:app-info'
export const DICTATION_DICTIONARY_ADD_CHANNEL = 'dictation:dictionary-add'
export const DICTATION_DICTIONARY_REMOVE_CHANNEL = 'dictation:dictionary-remove'
export const DICTATION_DICTIONARY_CLEAR_LEARNED_CHANNEL = 'dictation:dictionary-clear-learned'

/** Off keeps the raw words, Light is instant and local, Full also uses a model. */
export const TIDY_LEVELS = ['off', 'light', 'full'] as const
export type TidyLevel = (typeof TIDY_LEVELS)[number]

export interface DictationSettings {
  /** Master switch. Off means no shortcut, no helper and no microphone use. */
  enabled: boolean
  /** Electron accelerator for press-to-start / press-to-stop; empty disables it. */
  toggleShortcut: string
  /** Modifier held on its own for hold-to-talk. */
  holdKey: HoldKey
  /**
   * Kept so older settings still load. It only says which model a Full tidy-up
   * and transforms prefer (byok = the user's provider); the page no longer shows it.
   */
  cleanupMode: CleanupMode
  /** How much a brain dump is tidied before it is inserted. */
  tidyLevel: TidyLevel
  /**
   * Full tidy-up uses the model only for dictations of at least this many words;
   * shorter ones get the instant Light tidy-up. 0 means always use the model.
   */
  fullTidyMinWords: number
  /** The tone per app category, applied after tidy-up. */
  styles: StyleChoices
  /** Apps the user placed in a category, over the built-in list. */
  styleApps: StyleApps
  /** Named rewrite prompts, run on a selection or the last dictation. */
  transforms: TransformSettings
  /** Words the recognizer gets wrong and how to write them. Changed only through the dictionary calls. */
  dictionary: DictionaryEntry[]
  /**
   * After a dictation is typed, watch that one field for a short while and, if you
   * correct a misheard word and send, add the correction to the dictionary.
   */
  learnFromEdits: boolean
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
  /** Show the words being recognised on the pill while speaking. Off keeps the pill quiet. */
  showLiveText: boolean
  /** Show status captions ("Transcribing", "Inserting") and success confirmations. */
  showStatusMessages: boolean
  /** Show the icon of the app the text will go into on the live pill. */
  showTargetApp: boolean
  /**
   * An optional second hold-to-talk trigger: a mouse button, numbered from 0
   * (2 middle, 3 back, 4 forward, higher extras). Left and right click (0, 1)
   * are never allowed. Null = none. Works alongside the hold key.
   */
  holdMouseButton: number | null
  /** Consume that button's events so the app under the pointer does not also act on them. */
  holdMouseSwallow: boolean
  /**
   * click: press once to start, press again to stop (the release is ignored).
   * hold: hold to talk, with a quick double tap for hands-free. Keyboard hold key unaffected.
   */
  holdMouseMode: MouseMode
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: false,
  toggleShortcut: 'Control+Alt+D',
  holdKey: 'off',
  cleanupMode: 'raw',
  tidyLevel: 'light',
  fullTidyMinWords: 12,
  styles: DEFAULT_STYLES,
  styleApps: EMPTY_STYLE_APPS,
  transforms: DEFAULT_TRANSFORM_SETTINGS,
  dictionary: [],
  learnFromEdits: true,
  byokConsent: null,
  showPill: true,
  pillEdge: 'bottom',
  pillHiddenUntil: null,
  microphoneUid: null,
  startSound: true,
  handsFreeDoubleTap: true,
  pasteLastShortcut: 'Control+Alt+Shift+V',
  copyLastShortcut: 'Control+Alt+Shift+C',
  showLiveText: true,
  showStatusMessages: true,
  showTargetApp: true,
  holdMouseButton: null,
  holdMouseSwallow: true,
  holdMouseMode: 'click'
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
  /** Input Monitoring as macOS reports it, so the page knows whether a prompt is still possible. */
  inputMonitoringAccess: 'granted' | 'denied' | 'not-determined' | null
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
  /** Shortcut state per transform id; a transform without a shortcut is absent. */
  transformShortcuts: Record<string, ShortcutState>
  /** Which model a Full tidy-up or a transform would use right now. */
  model: ModelAvailability
  /** The last few apps dictation went into, newest first; names only, for placing them in a style. */
  recentApps: Array<{ bundleId: string; name: string }>
  /** A transform's before and after text is held in memory, so Undo and View work. */
  hasLastChange: boolean
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
  mouseButton: 'off' | 'active' | 'needs-permission' | 'unavailable'
  /** The mouse trigger consumes its button's events (an active tap was available). */
  mouseSwallowing: boolean
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
  /**
   * Stop to the end of delivery, split by stage. Every field is a duration in
   * ms (never text); null when that stage did not run.
   */
  stages: DictationStopStages
}

export interface DictationStopStages {
  /** Stop request to the recognizer's final result (all of it, engine included). */
  stopToFinalMs: number | null
  /** Of that, audio still queued when capture stopped. */
  engineDrainMs: number | null
  /** Of that, the recognizer's final flush. */
  engineFinishMs: number | null
  /** Final result to delivery starting: the reducer hand-off, plus cleanup when it is on. */
  finalToDeliverMs: number | null
  /** Of that, the model's Full tidy-up, when it ran. */
  tidyMs: number | null
  /** Of that, an auto-applied transform, when it ran. */
  transformMs: number | null
  /** Waiting for the start-of-session target snapshot (normally 0). */
  targetWaitMs: number | null
  /** The helper request from our side: helper work plus pipe and queue time. */
  helperRoundTripMs: number | null
  helper: HelperDeliveryTimings | null
  /** Stop to the end of delivery, everything included. */
  stopToDoneMs: number | null
}

export type MouseCaptureOutcome = { ok: true; button: number } | { ok: false; message: string }

/**
 * local: the notes model on this Mac. byok: the user's provider, with consent.
 * needs-consent: a provider is set up but the user has not allowed sending text.
 * none: nothing available, so Full and transforms cannot run (Light and styles still do).
 */
export interface ModelAvailability {
  path: 'local' | 'byok' | 'needs-consent' | 'none'
  label: string | null
}

/** How an app is drawn on the settings page. Both null when it is not installed. */
export interface AppDisplay {
  name: string | null
  icon: string | null
}

export type DictionaryAddOutcome =
  { ok: true } | { ok: false; reason: 'invalid' | 'full' | 'unchanged' }

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
  /** Wait for the next mouse button press and say which button it was (or why it cannot be used). */
  captureMouseButton(): Promise<MouseCaptureOutcome>
  /**
   * Ask macOS for a permission (its own dialog, which also lists the app in System
   * Settings). The outcome says whether it was granted, is being decided, or macOS
   * will not ask again and System Settings must be opened.
   */
  requestPermission(pane: PermissionPane): Promise<PermissionOutcome>
  /** Run a transform now, on the selection in the focused app or else the last dictation. */
  runTransform(id: string): Promise<void>
  /** Show the before and after of the last transform. */
  viewLastChange(): Promise<void>
  /** Put the text from before the last transform back. */
  undoLastChange(): Promise<void>
  /** The real name and icon of each of these apps, by bundle identifier, for the apps that are installed. */
  getAppInfo(bundleIds: string[]): Promise<Record<string, AppDisplay>>
  /** Add a dictionary entry; an empty `heard` means "always write it exactly like this". */
  addDictionaryEntry(entry: { heard: string; written: string }): Promise<DictionaryAddOutcome>
  removeDictionaryEntry(id: string): Promise<void>
  /** Remove every entry that was learned from corrections, keeping the hand-made ones. */
  clearLearnedEntries(): Promise<void>
  copyRecovery(gen: number): Promise<boolean>
  dismissRecovery(gen: number): Promise<void>
  openPrivacySettings(pane: 'microphone' | 'accessibility' | 'input-monitoring'): Promise<void>
  onStatus(cb: (status: DictationStatus) => void): () => void
  /** The pill's menu asked to open the dictation settings. */
  onOpenSettings(cb: () => void): () => void
}
