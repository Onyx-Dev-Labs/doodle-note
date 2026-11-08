import { FEATURE_NAME } from '../shared/dictation-brand'
import { randomUUID } from 'node:crypto'
import type { AppChannel } from '../shared/app-channel'
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationLatency,
  type DictationPermissions,
  type DictationSettings,
  type AppDisplay,
  type DictationSettingsUpdate,
  type DictationStatus,
  type DictionaryAddOutcome,
  type MouseCaptureOutcome,
  type MicrophoneAccess,
  type RecoveryItem,
  type ShortcutState
} from '../shared/dictation-api'
import {
  MAX_DICTIONARY_ENTRIES,
  mergeLearned,
  wordsOf,
  sanitizePhrase,
  type DictionaryEntry,
  type LearnedPair
} from '../shared/dictation-dictionary'
import { DictationLearner } from './dictation-learner'
import type {
  DeliveryGuards,
  HelperDelivery,
  AppInfoEntry,
  FieldReading,
  HelperDeliveryTimings,
  HelperStatus,
  HoldFailure,
  HoldKey,
  InputState,
  MouseCaptureResult,
  MouseMode,
  MouseStartResult,
  SelectionResult,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import { micLooksMuted } from '../shared/dictation-helper-protocol'
import type { ClipboardOffer, ClipboardOfferRestore } from '../shared/dictation-helper-protocol'
import {
  buildPillMenu,
  isMessageShown,
  describeMouseCaptureFailure,
  hideExpiry,
  isPillHidden,
  msUntilPillReturns,
  resolveMicrophone,
  soundForTransition,
  type InputDevice,
  type PillEdge,
  type PillMenuCommand,
  type PillMenuItem,
  type SoundKind
} from '../shared/dictation-pill'
import {
  initialSessionState,
  isBusy,
  isDoubleTap,
  reduce,
  type CleanupMode,
  type CleanupOutcome,
  type DeliveryOutcome,
  type RecoveryReason,
  type SessionEffect,
  type SessionEvent,
  type SessionState
} from '../shared/dictation-session'
import type { EngineEvent, EngineStartOptions } from '../shared/engine-events'
import type { PermissionOutcome, PermissionPane } from '../shared/dictation-permissions'
import type { CaptureLease, CaptureOwnership } from './capture-ownership'
import { MAX_CLEANUP_CHARS, buildTransformRequest, validateTransform } from './dictation-cleanup'
import {
  CLIPBOARD_PROBLEM_MESSAGES,
  RECOVERY_MESSAGES,
  clipboardProblem,
  overlayView,
  panelView,
  type OverlayContext,
  type OverlayTarget,
  type OverlayPanel,
  type OverlayView
} from './dictation-overlay-view'
import {
  deterministicText,
  fallbackText,
  planDictation,
  resolveModel,
  runModelSteps,
  type DictationPlan,
  type TransformChange
} from './dictation-pipeline'
import { conflictingShortcuts, diffWords } from '../shared/dictation-transforms'
import { barkCopy, barkPlatform, type BarkCopy } from '../shared/dictation-platform'
import type { HelperIntegrityState } from './helper-integrity'
import type { OverlayAction } from './dictation-overlay'

export interface EngineLike {
  tryStartLive(opts: EngineStartOptions): { started: true } | { started: false; reason: string }
  stop(): void
  readonly running: boolean
  readonly warm: boolean
  /** Audio inputs, for the microphone picker. Resolves [] when listing fails. */
  listInputDevices?(): Promise<InputDevice[]>
  /**
   * Windows: whether the dictation-quality model (Parakeet) is loaded. Absent on macOS, where
   * the engine always runs the full model. `ready: false` means Bark should not dictate yet.
   */
  dictationModelState?(): {
    ready: boolean
    downloadProgress: number | null
    usingFallback: boolean
    downloadFailed: boolean
  }
  /** Windows: retry a failed background model download when dictation is attempted. */
  /** Windows: retry a failed model download; what happened decides the words shown. */
  retryDictationModel?(): 'started' | 'in-progress' | 'unavailable'
}

export interface HelperLike {
  readonly available: boolean
  /** Windows only: the helper exists but Windows would not start it. Absent or false on macOS. */
  readonly blocked?: boolean
  status(): Promise<HelperStatus | null>
  snapshot(snapshotId: string): Promise<TargetDescription | null>
  /** An app bundle's icon as a small PNG data URL; null when it cannot be drawn. */
  appIcon(appPath: string): Promise<string | null>
  /** deliveryId (Windows): the service's name for this delivery; later clipboard results name it. */
  deliver(
    snapshotId: string,
    text: string,
    guards?: DeliveryGuards,
    deliveryId?: string
  ): Promise<HelperDelivery>
  /** The text selected in the snapshot's field; refused for secure fields. */
  selection(snapshotId: string): Promise<SelectionResult>
  /** The name and icon of each installed app among these bundle identifiers. */
  appInfo(bundleIds: string[]): Promise<AppInfoEntry[]>
  /** Read a watched field back (see DeliveryGuards.watch). */
  watchRead(watchId: string): Promise<FieldReading>
  watchStop(watchId: string): void
  release(snapshotId: string): void
  setHoldKey(key: HoldKey): Promise<HoldFailure | null>
  /** Arm or disarm the optional mouse-button trigger. Null result means it was switched off. */
  setMouseButton(
    button: number | null,
    swallow: boolean,
    mode: MouseMode
  ): Promise<MouseStartResult | null>
  /** The mouse trigger in click mode went down. */
  onClick(listener: () => void): () => void
  /** Replace the helper process (it re-arms its triggers when it comes back). */
  restart(): void
  /**
   * Windows: a delivery's clipboard result arrived after its reply (a late rollback, a recovery of a kept
   * transaction, or a kept one left pending); it names the delivery when known (see the client).
   */
  onClipboardLate?(listener: (clipboard: string, deliveryId?: string) => void): () => void
  /** Windows: a kept clipboard transaction offered to the user, and its withdrawal (see the client). */
  onClipboardOffer?(listener: (offer: ClipboardOffer) => void): () => void
  onClipboardOfferGone?(listener: (record: string) => void): () => void
  clipboardOffers?(): Promise<ClipboardOffer[]>
  restoreClipboardOffer?(record: string, sequence: number): Promise<ClipboardOfferRestore>
  dismissClipboardOffer?(record: string): Promise<boolean>
  /** Windows: whether a helper that leaves now is started again on its own (absent: assume yes). */
  willRestart?(): boolean
  /** Ask macOS for Accessibility from the helper. Returns whether it is granted now. */
  requestAccessibility(): Promise<boolean | null>
  /** Ask macOS for Input Monitoring from the helper. Returns whether it is granted now. */
  requestInputMonitoring(): Promise<boolean | null>
  /** Wait for the next mouse button the user presses. */
  captureMouseButton(): Promise<MouseCaptureResult>
  onHold(listener: (event: { phase: 'down' | 'up'; holdId: number }) => void): () => void
  /** A quick press and release of the hold key that was too short to count as a hold. */
  onTap(listener: () => void): () => void
  /** Mute and volume of the input a session records from; null when unreadable. */
  inputState(uid: string | null): Promise<InputState | null>
  /** Silence the sound output (true if this call did). Always paired with restoreOutput. */
  muteOutput(): Promise<boolean>
  restoreOutput(): Promise<void>
  onExit(listener: () => void): () => void
  /** Windows: the low-level hooks were lost and re-installed (or could not be). */
  onHooks?(listener: (phase: 'lost' | 'restored' | 'failed') => void): () => void
  dispose(): Promise<void>
}

export interface ShortcutsLike {
  /** Returns false when another app owns the combination; throws on a malformed one. */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface OverlayLike {
  render(view: OverlayView): void
  dispose(): void
  playSound(kind: SoundKind): void
  popupMenu(items: PillMenuItem[], onPick: (command: PillMenuCommand) => void): void
}

/** Runs one cleanup request and returns the model's text. Throws with a user-readable message. */
export type CleanupRunner = (
  mode: 'local' | 'byok',
  request: { system: string; prompt: string },
  signal: AbortSignal,
  consent: { provider: string; model: string } | null
) => Promise<string>

export interface DictationDeps {
  channel: AppChannel
  supported: boolean
  /** Picks the platform's words (see dictation-platform.ts). Defaults to macOS. */
  platform?: NodeJS.Platform
  /**
   * Windows: the helper's integrity (see helper-integrity.ts). 'unchecked' until Bark first needs
   * the helper, 'checking' while verifying, then 'ok', 'damaged' or 'absent'. Absent on macOS.
   */
  helperIntegrity?(): HelperIntegrityState
  /**
   * Windows: whether the helper's last check held its file (false while it runs checked by digest
   * only, e.g. after repeated lost holds); shown in the Settings status row. Absent on macOS.
   */
  helperLocked?(): boolean
  /** Windows: start (or join) the integrity check; it runs asynchronously. */
  checkHelperIntegrity?(): void
  settings: {
    get(): DictationSettings
    update(patch: DictationSettingsUpdate): DictationSettings
    setDictionary(entries: DictionaryEntry[]): DictationSettings
  }
  engine: EngineLike
  ownership: CaptureOwnership
  helper: HelperLike
  shortcuts: ShortcutsLike
  overlay: OverlayLike
  cleanup: CleanupRunner
  cleanupOptions(): DictationStatus['cleanup']
  microphoneAccess(): MicrophoneAccess
  /** Show macOS's microphone dialog (which also lists the app). Resolves true when allowed. */
  requestMicrophone(): Promise<boolean>
  /** Electron's clipboard API is asynchronous; resolve only once the text is on it. */
  writeClipboard(text: string): Promise<void> | void
  broadcast(status: DictationStatus): void
  /** The microphone is held (true) or free (false); lets the host quiet meeting detection. */
  onMicHeld(held: boolean): void
  /** Bring the app's dictation settings page forward. */
  openSettings(): void
  now(): number
  /** Begin loading the local cleanup model; called as a dictation starts that expects to use it. */
  warmCleanupModel?(): void
  /** Run `tick` every `ms` until the returned function is called. Defaults to setInterval. */
  every?(ms: number, tick: () => void): () => void
  log(line: string): void
  /** Numbers-only latency record; never receives transcript text. */
  recordMetrics(record: Record<string, number | string | boolean | null>): void
}

interface SessionContext {
  gen: number
  snapshotId: string
  target: Promise<TargetDescription | null>
  targetDescription: TargetDescription | null
  consent: { provider: string; model: string } | null
  /** CoreAudio UID this session records from; null = system default. */
  micUid: string | null
  warmAtStart: boolean
  /** Settings and model availability as they were when the session began; later changes apply to the next one. */
  settings: DictationSettings
  modelOptions: DictationStatus['cleanup']
  /** Decided when the speech ends, once the focused app is known. */
  plan: DictationPlan | null
  /** The auto-applied transform's before and after, once it has run. */
  change: TransformChange | null
  marks: {
    start: number
    micOpen?: number
    stop?: number
    final?: number
    cleanupStart?: number
    cleanupEnd?: number
    deliverStart?: number
    /** The target snapshot was in hand and the helper request was about to go out. */
    helperSent?: number
    deliverEnd?: number
  }
  /** Durations reported by the engine's final event and by the helper's reply. */
  detail: {
    engineDrainMs?: number
    engineFinishMs?: number
    helper?: HelperDeliveryTimings
    tidyMs?: number
    transformMs?: number
  }
}

const MAX_RECOVERIES = 5
const SUCCESS_NOTICE_MS = 1_200
const NOTICE_MS = 6_000
const ESCAPE = 'Escape'
/** How often the chosen input is checked for a mute or zero volume while recording. */
const MIC_POLL_MS = 2_000
/** Let the start tone finish before the sound is muted, or the tone would be cut off. */
const MUTE_AFTER_TONE_MS = 350
/** "Changed by Polish. View / Undo" stays this long. */
const CHANGE_PANEL_MS = 8_000
const DIFF_PANEL_MS = 60_000
const APP_INFO_TTL_MS = 10 * 60_000
const LEARNED_PANEL_MS = 7_000
/** A transform run by hand gives up after this long. */
const TRANSFORM_TIMEOUT_MS = { local: 40_000, byok: 25_000 } as const
/** The device list is re-read at most this often unless the menu asks. */
const DEVICE_REFRESH_MS = 3_000
/** The menu waits this long for a fresh device list before it shows what it has. */
const MENU_DEVICE_WAIT_MS = 400
/** A double tap that lands while the engine drains the last session waits this long for it. */
const DEFERRED_START_MS = 2_000
/** A fresh helper refuses requests for a moment after the old one exits. */
const HELPER_RESTART_SETTLE_MS = 700
/** A Finish click this soon after a start is a stray second click, not a real stop. */
const STRAY_STOP_MS = 400

/**
 * Orchestrates one dictation at a time: shortcut and hold events in, engine
 * events and helper replies in, overlay and insertion out. All decisions about
 * ordering live in the pure reducer; this class performs the effects and feeds
 * results back tagged with the session generation they belong to.
 */
export class DictationService {
  private state: SessionState = initialSessionState()
  private readonly sessions = new Map<number, SessionContext>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private cleanupAbort: { gen: number; controller: AbortController } | null = null
  private restingTimer: NodeJS.Timeout | null = null
  /** The engine session, which can outlive the logical session during drain. */
  private capture: { gen: number; lease: CaptureLease } | null = null
  private micOpen = false
  private level = 0
  private lastPartialRender = 0
  private recoveries: RecoveryItem[] = []
  private lastLatency: DictationLatency | null = null
  private helperStatus: HelperStatus | null = null
  private toggleAccelerator: string | null = null
  private toggleState: ShortcutState = 'off'
  /** The paste-last and copy-last shortcuts. */
  private readonly actionKeys = {
    paste: { accelerator: null as string | null, state: 'off' as ShortcutState },
    copy: { accelerator: null as string | null, state: 'off' as ShortcutState }
  }
  /** The most recent transcript, in memory only, for "paste last". Never written anywhere. */
  private lastTranscript: string | null = null
  private pasting = false
  private devices: InputDevice[] = []
  private devicesAt = 0
  private devicesPending: Promise<void> | null = null
  private hideTimer: NodeJS.Timeout | null = null
  private micPoll: NodeJS.Timeout | null = null
  /** Sound is silenced (or about to be) for the current recording and must be given back. */
  private audioMuted = false
  private muteTimer: NodeJS.Timeout | null = null
  private muteInFlight: Promise<unknown> | null = null
  private deferredStart: { until: number } | null = null
  private lastStartAt = 0
  private holdState: DictationStatus['holdKey'] = 'off'
  private mouseState: DictationStatus['mouseButton'] = 'off'
  private mouseSwallowing = false
  private askingMicrophone = false
  /** What the last transform changed, for View and Undo. Memory only, forgotten on quit. */
  private lastChange: {
    name: string
    before: string
    after: string
  } | null = null
  private panel: OverlayPanel | null = null
  /** Windows: the clipboard offer standing now (shown whenever no other panel is). */
  private offer: ClipboardOffer | null = null
  /** Windows: the clipboard changed since the offer; what a restore would overwrite, and the sequence to ask with. */
  private offerChanged: { formats: number; bytes: number | null; sequence: number } | null = null
  private panelTimer: NodeJS.Timeout | null = null
  private transforming: AbortController | null = null
  private readonly transformKeys = new Map<
    string,
    { accelerator: string | null; state: ShortcutState }
  >()
  /** The apps dictation went into lately, newest first, so one can be placed in a style. */
  private recentApps: Array<{ bundleId: string; name: string }> = []
  /** App icons by bundle id, so each app's icon is read from disk once. */
  private readonly appIcons = new Map<string, string | null>()
  /** Names and icons for the settings page's app lists, by bundle id. */
  private readonly appInfoCache = new Map<
    string,
    { name: string | null; icon: string | null; at: number }
  >()
  private rearming = false
  private restartedForPermission = false
  private escapeRegistered = false
  private disposed = false
  private readonly learner: DictationLearner
  private lastToggleAt = 0
  private readonly unsubscribe: Array<() => void> = []
  private readonly copy: BarkCopy
  private readonly windows: boolean
  /** Windows: the clipboard note for one recovery card (by generation). */
  private clipboardWarning: { gen: number; message: string } | null = null
  /** Windows: the delivery the clipboard notice (warning line or panel) is about, when the helper named it. */
  private clipboardDelivery: string | null = null

  constructor(private readonly deps: DictationDeps) {
    this.copy = barkCopy(deps.platform ?? 'darwin')
    this.windows = barkPlatform(deps.platform ?? 'darwin') === 'win32'
    this.learner = new DictationLearner({
      read: (id) => deps.helper.watchRead(id),
      stop: (id) => deps.helper.watchStop(id),
      now: () => deps.now(),
      onLearn: (pairs) => this.onLearned(pairs),
      every:
        deps.every ??
        ((ms, tick) => {
          const timer = setInterval(tick, ms)
          timer.unref?.()
          return () => clearInterval(timer)
        })
    })
    this.unsubscribe.push(
      deps.helper.onHold((event) => this.onHold(event)),
      deps.helper.onTap(() => this.onTap()),
      deps.helper.onClick(() => this.onClick()),
      deps.helper.onExit(() => this.onHelperExit())
    )
    // Windows: a hook loss/re-install changes what the permissions panel shows; refresh it.
    if (deps.helper.onClipboardLate) {
      this.unsubscribe.push(
        deps.helper.onClipboardLate((clipboard, deliveryId) =>
          this.clipboardLate(clipboard, deliveryId)
        )
      )
    }
    if (deps.helper.onClipboardOffer)
      this.unsubscribe.push(deps.helper.onClipboardOffer((offer) => this.showOffer(offer)))
    if (deps.helper.onClipboardOfferGone)
      this.unsubscribe.push(deps.helper.onClipboardOfferGone((record) => this.offerGone(record)))
    if (deps.helper.onHooks) {
      this.unsubscribe.push(deps.helper.onHooks(() => void this.status()))
    }
  }

  /* ---- lifecycle ---- */

  /** Apply persisted settings: register shortcuts, arm hold-to-talk. */
  async start(): Promise<void> {
    await this.applySettings()
    // Off means idle: do not even list microphones until the person turns it on.
    if (this.deps.settings.get().enabled) void this.refreshDevices()
    // Windows: a clipboard kept by an earlier session (a crash, a restart) is offered again.
    if (this.windows && this.deps.settings.get().enabled) void this.loadClipboardOffers()
  }

  /* ---- clipboard offers (Windows) ---- */

  private async loadClipboardOffers(): Promise<void> {
    if (!this.deps.helper.clipboardOffers) return
    try {
      const [first] = await this.deps.helper.clipboardOffers()
      if (first) this.showOffer(first)
    } catch {
      // No helper: nothing to offer now; a later helper start sends its offers itself.
    }
  }

  private showOffer(offer: ClipboardOffer): void {
    if (this.disposed) return
    if (this.offer?.record !== offer.record) this.offerChanged = null
    this.offer = offer
    this.deps.log(
      `clipboard offer: a kept clipboard (${offer.formats} formats, ${offer.bytes} bytes) can be restored`
    )
    // Shown now unless another panel is up (then when it closes, see setPanel).
    if (!this.panel || this.panel.kind === 'clipboard' || this.panel.kind === 'clipboard-offer')
      this.setPanel(this.offerPanel())
  }

  private offerPanel(): OverlayPanel | null {
    if (!this.offer) return null
    return {
      kind: 'clipboard-offer',
      offer: this.offer,
      ...(this.offerChanged
        ? { changed: { formats: this.offerChanged.formats, bytes: this.offerChanged.bytes } }
        : {})
    }
  }

  private offerGone(record: string): void {
    if (this.offer?.record !== record) return
    this.offer = null
    this.offerChanged = null
    if (this.panel?.kind === 'clipboard-offer') this.setPanel(null)
  }

  /** The user's Restore: only while the clipboard is as it was offered (or as the "changed" card showed). */
  private async restoreOffer(): Promise<void> {
    const offer = this.offer
    if (!offer || !this.deps.helper.restoreClipboardOffer) return
    const sequence = this.offerChanged?.sequence ?? offer.sequence
    const done = await this.deps.helper.restoreClipboardOffer(offer.record, sequence)
    this.deps.log(`clipboard offer: restore ${done.result}`)
    if (this.offer?.record !== offer.record) return
    if (done.result === 'changed' && typeof done.sequence === 'number') {
      // Ask again, showing what a restore would overwrite now (formats and size only).
      this.offerChanged = {
        formats: done.formats ?? 0,
        bytes: done.bytes ?? null,
        sequence: done.sequence
      }
      this.setPanel(this.offerPanel())
      return
    }
    if (done.result === 'restored' || done.result === 'partial' || done.result === 'skipped') {
      this.offer = null
      this.offerChanged = null
      const problem = clipboardProblem(done.result, undefined)
      this.setPanel(problem ? { kind: 'clipboard', problem } : null, problem ? NOTICE_MS : 0)
      return
    }
    if (done.result === 'gone') {
      this.offer = null
      this.offerChanged = null
      this.setPanel(null)
    }
    // Otherwise (busy, failed): the offer stands; the card stays.
  }

  /** The user's Dismiss: the saved copy is deleted and the clipboard left as it is. */
  private async dismissOffer(): Promise<void> {
    const offer = this.offer
    this.offer = null
    this.offerChanged = null
    this.setPanel(null)
    if (offer && this.deps.helper.dismissClipboardOffer)
      await this.deps.helper.dismissClipboardOffer(offer.record)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.learner.discard()
    this.dispatch({ type: 'cancel' })
    this.clearAllTimers()
    this.stopMicPoll()
    this.restoreAudio()
    this.unregisterEscape()
    if (this.toggleAccelerator) this.deps.shortcuts.unregister(this.toggleAccelerator)
    this.toggleAccelerator = null
    for (const key of [...Object.values(this.actionKeys), ...this.transformKeys.values()]) {
      if (key.accelerator) this.deps.shortcuts.unregister(key.accelerator)
      key.accelerator = null
    }
    this.transformKeys.clear()
    this.transforming?.abort()
    this.setPanel(null)
    this.lastTranscript = null
    this.lastChange = null
    for (const stop of this.unsubscribe) stop()
    this.deps.overlay.dispose()
    await this.deps.helper.dispose()
  }

  /** Corrections the watcher saw you make to a dictation: add them to the dictionary. */
  private onLearned(pairs: LearnedPair[]): void {
    const settings = this.deps.settings.get()
    if (this.disposed || !settings.enabled || !settings.learnFromEdits) return
    const { entries, added } = mergeLearned(settings.dictionary, pairs, this.deps.now())
    if (JSON.stringify(entries) === JSON.stringify(settings.dictionary)) return
    this.deps.settings.setDictionary(entries)
    // Counts only; the words themselves never go to the log.
    this.deps.log(`dictionary learned ${added.length} correction(s)`)
    if (added.length > 0 && isMessageShown('learned', this.quiet())) {
      this.setPanel({ kind: 'learned', pairs: added }, LEARNED_PANEL_MS)
    }
    this.broadcast()
  }

  /**
   * The real name and icon of apps, for the style lists. Asked of the helper in one
   * batch, remembered for ten minutes (an app installed later turns up then).
   */
  async appInfo(ids: unknown): Promise<Record<string, AppDisplay>> {
    if (!Array.isArray(ids)) return {}
    const wanted = [
      ...new Set(
        ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200
        )
      )
    ].slice(0, 60)
    const now = this.deps.now()
    const missing = wanted.filter((id) => {
      const hit = this.appInfoCache.get(id)
      return !hit || now - hit.at > APP_INFO_TTL_MS
    })
    if (missing.length > 0) {
      let found: AppInfoEntry[] = []
      try {
        found = this.deps.helper.available ? await this.deps.helper.appInfo(missing) : []
      } catch {
        found = []
      }
      if (this.appInfoCache.size > 200) this.appInfoCache.clear()
      for (const id of missing) {
        const entry = found.find((item) => item.bundleId === id)
        this.appInfoCache.set(id, { name: entry?.name ?? null, icon: entry?.icon ?? null, at: now })
      }
    }
    const out: Record<string, AppDisplay> = {}
    for (const id of wanted) {
      const hit = this.appInfoCache.get(id)
      out[id] = { name: hit?.name ?? null, icon: hit?.icon ?? null }
    }
    return out
  }

  /** Add a hand-made dictionary entry. `heard` may be empty: always write it exactly like this. */
  async addDictionaryEntry(entry: {
    heard: unknown
    written: unknown
  }): Promise<DictionaryAddOutcome> {
    const written = sanitizePhrase(entry.written)
    const heard = entry.heard === '' || entry.heard === undefined ? '' : sanitizePhrase(entry.heard)
    if (written === null || heard === null) return { ok: false, reason: 'invalid' }
    const entries = this.deps.settings.get().dictionary
    if (entries.some((existing) => existing.from === heard && existing.to === written))
      return { ok: false, reason: 'unchanged' }
    // The same heard words already map somewhere: the new entry replaces it.
    const heardKey = (heard || written).toLowerCase()
    const kept = entries.filter(
      (existing) => (existing.from || existing.to).toLowerCase() !== heardKey
    )
    if (kept.length >= MAX_DICTIONARY_ENTRIES) return { ok: false, reason: 'full' }
    const now = this.deps.now()
    this.deps.settings.setDictionary([
      ...kept,
      {
        id: `dict-${now}-${randomUUID().slice(0, 8)}`,
        from: heard,
        to: written,
        source: 'manual',
        count: 1,
        at: now
      }
    ])
    this.broadcast()
    return { ok: true }
  }

  removeDictionaryEntry(id: unknown): void {
    if (typeof id !== 'string') return
    const entries = this.deps.settings.get().dictionary
    const kept = entries.filter((entry) => entry.id !== id)
    if (kept.length === entries.length) return
    this.deps.settings.setDictionary(kept)
    this.broadcast()
  }

  clearLearnedEntries(): void {
    const entries = this.deps.settings.get().dictionary
    const kept = entries.filter((entry) => entry.source !== 'learned')
    if (kept.length === entries.length) return
    this.deps.settings.setDictionary(kept)
    this.broadcast()
  }

  async setSettings(update: DictationSettingsUpdate): Promise<DictationStatus> {
    const before = this.deps.settings.get()
    const next = this.deps.settings.update(update)
    // The consent belongs to one provider/model pair. A different pair clears it.
    if (
      next.byokConsent &&
      update.byokConsent === undefined &&
      JSON.stringify(before.byokConsent) !== JSON.stringify(next.byokConsent)
    ) {
      this.deps.settings.update({ byokConsent: null })
    }
    await this.applySettings()
    return this.status()
  }

  private async applySettings(): Promise<void> {
    const settings = this.deps.settings.get()
    if (!settings.enabled || !settings.learnFromEdits) this.learner.discard()
    if (!this.deps.supported || !settings.enabled) {
      this.dispatch({ type: 'cancel' })
      this.setToggleShortcut('')
      this.setActionShortcut('paste', '', new Set())
      this.setActionShortcut('copy', '', new Set())
      this.applyTransformShortcuts(
        { ...settings, transforms: { ...settings.transforms, enabled: false } },
        new Set()
      )
      this.holdState = 'off'
      this.mouseState = 'off'
      this.mouseSwallowing = false
      void this.deps.helper.setHoldKey('off')
      void this.deps.helper.setMouseButton(null, false, 'hold')
      this.refreshPillTimer()
      this.render()
      return
    }
    // Windows: Bark is on, so the helper is about to be needed; verify it now (asynchronously).
    this.deps.checkHelperIntegrity?.()
    this.setToggleShortcut(settings.toggleShortcut)
    const clashes = this.shortcutClashes(settings)
    this.setActionShortcut('paste', settings.pasteLastShortcut, clashes)
    this.setActionShortcut('copy', settings.copyLastShortcut, clashes)
    this.applyTransformShortcuts(settings, clashes)
    this.refreshPillTimer()
    this.render()
    if (settings.holdKey === 'off') {
      this.holdState = 'off'
      await this.deps.helper.setHoldKey('off')
    } else {
      const failure = await this.deps.helper.setHoldKey(settings.holdKey)
      this.holdState =
        failure === null
          ? 'active'
          : failure === 'input-monitoring-denied'
            ? 'needs-permission'
            : 'unavailable'
    }
    await this.applyMouseButton(settings)
  }

  /** The optional mouse-button trigger, independent of the hold key. */
  private async applyMouseButton(settings: DictationSettings): Promise<void> {
    if (settings.holdMouseButton === null) {
      this.mouseState = 'off'
      this.mouseSwallowing = false
      await this.deps.helper.setMouseButton(null, false, 'hold')
      return
    }
    const result = await this.deps.helper.setMouseButton(
      settings.holdMouseButton,
      settings.holdMouseSwallow,
      settings.holdMouseMode
    )
    this.mouseState = result?.ok
      ? 'active'
      : result?.failure === 'input-monitoring-denied'
        ? 'needs-permission'
        : 'unavailable'
    this.mouseSwallowing = result?.ok === true && result.swallowing
  }

  /**
   * Wait for the user to press a mouse button, for the settings page. Left and
   * right click are refused with an explanation, never stored.
   */
  async captureMouseButton(): Promise<MouseCaptureOutcome> {
    if (this.disposed || !this.deps.supported) {
      return { ok: false, message: describeMouseCaptureFailure('helper-unavailable') }
    }
    const result = await this.deps.helper.captureMouseButton()
    return result.ok
      ? { ok: true, button: result.button }
      : {
          ok: false,
          message: describeMouseCaptureFailure(
            result.failure,
            barkPlatform(this.deps.platform ?? 'darwin')
          )
        }
  }

  private setToggleShortcut(accelerator: string): void {
    if (this.toggleAccelerator === accelerator && this.toggleState === 'registered') return
    if (this.toggleAccelerator) this.deps.shortcuts.unregister(this.toggleAccelerator)
    this.toggleAccelerator = null
    if (!accelerator) {
      this.toggleState = 'off'
      return
    }
    try {
      const ok = this.deps.shortcuts.register(accelerator, () => this.toggle())
      this.toggleState = ok ? 'registered' : 'conflict'
      if (ok) this.toggleAccelerator = accelerator
    } catch {
      this.toggleState = 'invalid'
    }
  }

  /** Register (or clear) the paste-last or copy-last shortcut. */
  private setActionShortcut(
    slot: 'paste' | 'copy',
    accelerator: string,
    blocked: ReadonlySet<string>
  ): void {
    const key = this.actionKeys[slot]
    // Two actions on one combination would shadow each other; both are flagged.
    const collides = blocked.has(slot)
    if (!collides && key.accelerator === accelerator && key.state === 'registered') return
    if (key.accelerator) this.deps.shortcuts.unregister(key.accelerator)
    key.accelerator = null
    if (!accelerator) {
      key.state = 'off'
      return
    }
    if (collides) {
      key.state = 'conflict'
      return
    }
    try {
      const run = slot === 'paste' ? () => void this.pasteLast() : () => void this.copyLast()
      const ok = this.deps.shortcuts.register(accelerator, run)
      key.state = ok ? 'registered' : 'conflict'
      if (ok) key.accelerator = accelerator
    } catch {
      key.state = 'invalid'
    }
  }

  /* ---- the resting pill ---- */

  private pillVisible(): boolean {
    const settings = this.deps.settings.get()
    return (
      this.deps.supported &&
      settings.enabled &&
      settings.showPill &&
      !isPillHidden(settings.pillHiddenUntil, this.deps.now())
    )
  }

  /** Keep the pill's "hide for an hour" honest: drop an expired one, time a running one. */
  private refreshPillTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
    const until = this.deps.settings.get().pillHiddenUntil
    if (until === null) return
    const remaining = msUntilPillReturns(until, this.deps.now())
    if (remaining === null) {
      this.deps.settings.update({ pillHiddenUntil: null })
      return
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.deps.settings.update({ pillHiddenUntil: null })
      this.render()
      this.broadcast()
    }, remaining)
    this.hideTimer.unref?.()
  }

  /** Hotkey dictation brings a hidden pill back. */
  private showHiddenPill(): void {
    if (this.deps.settings.get().pillHiddenUntil === null) return
    this.deps.settings.update({ pillHiddenUntil: null })
    this.refreshPillTimer()
  }

  /** Apply a settings change that came from the pill itself, then tell the settings page. */
  private async patch(update: DictationSettingsUpdate): Promise<void> {
    await this.setSettings(update)
    this.broadcast()
  }

  private async openMenu(): Promise<void> {
    // Show the list we already have if a fresh one is slow.
    await Promise.race([
      this.refreshDevices(true),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, MENU_DEVICE_WAIT_MS)
        timer.unref?.()
      })
    ])
    if (this.disposed) return
    const settings = this.deps.settings.get()
    this.deps.overlay.popupMenu(
      buildPillMenu({
        showAlways: settings.showPill,
        devices: this.devices,
        selectedUid: settings.microphoneUid,
        hasLastTranscript: this.lastTranscript !== null,
        transforms: settings.transforms.enabled
          ? settings.transforms.items.map((item) => ({ id: item.id, name: item.name }))
          : [],
        hasLastChange: this.lastChange !== null,
        mouseButton: settings.holdMouseButton,
        mouseMode: settings.holdMouseMode,
        showLiveText: settings.showLiveText,
        showStatusMessages: settings.showStatusMessages
      }),
      (command) => this.onMenuCommand(command)
    )
  }

  onMenuCommand(command: PillMenuCommand): void {
    switch (command.kind) {
      case 'hide-hour':
        void this.patch({ pillHiddenUntil: hideExpiry(this.deps.now()) })
        break
      case 'microphone':
        void this.patch({ microphoneUid: command.uid })
        break
      case 'paste-last':
        void this.pasteLast()
        break
      case 'copy-last':
        void this.copyLast()
        break
      case 'settings':
        this.deps.openSettings()
        break
      case 'transform':
        void this.runTransform(command.id)
        break
      case 'view-change':
        this.viewLastChange()
        break
      case 'undo-change':
        void this.undoLastChange()
        break
      case 'toggle-live-text':
        void this.patch({ showLiveText: !this.deps.settings.get().showLiveText })
        break
      case 'toggle-status':
        void this.patch({ showStatusMessages: !this.deps.settings.get().showStatusMessages })
        break
      case 'toggle-always':
        void this.patch({ showPill: !this.deps.settings.get().showPill })
        break
    }
  }

  /** The pill was dropped near a screen edge. */
  onPillEdge(edge: PillEdge): void {
    if (edge !== this.deps.settings.get().pillEdge) void this.patch({ pillEdge: edge })
  }

  /* ---- microphones ---- */

  private refreshDevices(force = false): Promise<void> {
    const list = this.deps.engine.listInputDevices
    if (!list) return Promise.resolve()
    if (this.devicesPending) return this.devicesPending
    if (!force && this.deps.now() - this.devicesAt < DEVICE_REFRESH_MS) return Promise.resolve()
    this.devicesAt = this.deps.now()
    this.devicesPending = list
      .call(this.deps.engine)
      .then((devices) => {
        const changed = JSON.stringify(devices) !== JSON.stringify(this.devices)
        this.devices = devices
        if (changed && !this.disposed) this.broadcast()
      })
      .catch(() => {})
      .finally(() => {
        this.devicesPending = null
      })
    return this.devicesPending
  }

  /* ---- user actions ---- */

  /** The shortcut, tray item and settings button all land here. */
  toggle(): void {
    if (this.disposed) return
    const now = this.deps.now()
    // Key auto-repeat or a double tap must not stop a session that just began.
    if (now - this.lastToggleAt < 250) return
    this.lastToggleAt = now
    if (this.state.phase === 'preparing' || this.state.phase === 'recording') {
      this.dispatch({ type: 'stop', source: 'toggle', nowMs: now })
      return
    }
    this.begin('toggle')
  }

  cancel(): void {
    this.deferredStart = null
    this.dispatch({ type: 'cancel' })
  }

  private onHold(event: { phase: 'down' | 'up'; holdId: number }): void {
    if (this.disposed) return
    if (event.phase === 'down') {
      // A press while a double tap has the microphone latched on ends it.
      if (this.state.active?.trigger === 'handsfree') {
        this.dispatch({ type: 'tap', nowMs: this.deps.now() })
        return
      }
      this.begin('hold', event.holdId)
    } else {
      this.dispatch({
        type: 'stop',
        source: 'release',
        holdId: event.holdId,
        nowMs: this.deps.now()
      })
    }
  }

  /**
   * A quick tap of the hold key. The second of two taps latches hands-free; a
   * tap during a latched session ends it. With the double tap off, taps do nothing.
   */
  private onTap(): void {
    const settings = this.deps.settings.get()
    if (this.disposed || !this.deps.supported || !settings.enabled) return
    const now = this.deps.now()
    if (this.state.active?.trigger === 'handsfree') {
      this.dispatch({ type: 'tap', nowMs: now })
      return
    }
    if (!settings.handsFreeDoubleTap || isBusy(this.state)) return
    if (isDoubleTap(this.state.lastTapAtMs, now)) this.begin('handsfree')
    else this.dispatch({ type: 'tap', nowMs: now })
  }

  /**
   * A press of the mouse trigger in click mode: the first starts a hands-free
   * session, the next one (from any hands-free session, however it began) stops
   * and inserts. It never touches a key hold, and the reducer ignores a click
   * right after the start so a double click cannot start and stop in one go.
   */
  private onClick(): void {
    const settings = this.deps.settings.get()
    if (this.disposed || !this.deps.supported || !settings.enabled) return
    if (this.state.active) {
      this.dispatch({ type: 'click', nowMs: this.deps.now() })
      return
    }
    if (isBusy(this.state)) return
    this.begin('click')
  }

  /** The helper died. A hold can no longer see its key-up, so finish what was said. */
  private onHelperExit(): void {
    if (this.disposed) return
    const active = this.state.active
    if (active?.trigger === 'hold' && ['preparing', 'recording'].includes(this.state.phase)) {
      this.dispatch({ type: 'stop', source: 'button', nowMs: this.deps.now() })
    }
    this.helperStatus = null
  }

  onOverlayAction(action: OverlayAction, gen: number | null): void {
    switch (action) {
      case 'pill':
        this.begin('pill')
        break
      case 'menu':
        void this.openMenu()
        break
      case 'stop':
        // The pill grows under the pointer; a second click of a double click lands on Finish.
        if (this.deps.now() - this.lastStartAt < STRAY_STOP_MS) break
        this.dispatch({
          type: 'stop',
          source: 'button',
          ...(gen !== null ? { gen } : {}),
          nowMs: this.deps.now()
        })
        break
      case 'cancel':
        this.dispatch({ type: 'cancel', ...(gen !== null ? { gen } : {}) })
        break
      case 'copy':
        if (gen !== null) void this.copyRecovery(gen)
        break
      case 'dismiss':
        if (this.panel?.kind === 'clipboard-offer') void this.dismissOffer()
        else if (this.panel) this.setPanel(null)
        else this.dispatch({ type: 'dismiss' })
        break
      case 'restore':
        if (this.panel?.kind === 'clipboard-offer') void this.restoreOffer()
        break
      case 'view':
        this.viewLastChange()
        break
      case 'undo':
        void this.undoLastChange()
        break
    }
  }

  async copyRecovery(gen: number): Promise<boolean> {
    const item = this.recoveries.find((r) => r.gen === gen)
    if (!item) return false
    try {
      await this.deps.writeClipboard(item.text)
      return true
    } catch {
      return false
    }
  }

  dismissRecovery(gen: number): void {
    this.recoveries = this.recoveries.filter((r) => r.gen !== gen)
    if (this.state.resting?.kind === 'recovery' && this.state.resting.gen === gen) {
      this.dispatch({ type: 'dismiss' })
    } else {
      this.broadcast()
    }
  }

  /* ---- starting a session ---- */

  private begin(
    trigger: 'toggle' | 'hold' | 'handsfree' | 'pill' | 'click',
    holdId?: number
  ): void {
    const settings = this.deps.settings.get()
    if (!this.deps.supported || !settings.enabled) return
    if (
      this.state.phase !== 'idle' &&
      this.state.phase !== 'notice' &&
      this.state.phase !== 'recovery'
    ) {
      return // a live session already owns the shortcut
    }
    if (!this.deps.helper.available) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: `The ${FEATURE_NAME} helper is missing from this build.`
      })
      return
    }
    const integrity = this.deps.helperIntegrity?.()
    if (integrity === 'damaged') {
      this.dispatch({ type: 'notice', level: 'error', message: this.copy.helperDamaged })
      return
    }
    if (integrity === 'unchecked' || integrity === 'checking') {
      // Windows: the helper is verified before it may run; this usually takes well under a second.
      this.deps.checkHelperIntegrity?.()
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: `Checking the ${FEATURE_NAME} helper. Try again in a moment.`
      })
      return
    }
    if (this.deps.helper.blocked) {
      this.dispatch({ type: 'notice', level: 'error', message: this.copy.helperBlocked })
      return
    }
    const model = this.deps.engine.dictationModelState?.()
    if (model && !model.ready) {
      // A fresh install serves a weaker model while Parakeet downloads; do not dictate on it
      // (the Mac never dictates on a weaker model either).
      if (model.downloadFailed) {
        // Attempting dictation re-triggers the download, rather than waiting for a recording, and
        // the words say what actually happened.
        const retry = this.deps.engine.retryDictationModel?.() ?? 'unavailable'
        this.dispatch({
          type: 'notice',
          level: retry === 'in-progress' ? 'info' : 'error',
          message:
            retry === 'started'
              ? `The ${FEATURE_NAME} speech model could not be downloaded. Retrying the download now.`
              : retry === 'in-progress'
                ? `The ${FEATURE_NAME} speech model download is being retried. Try again when it finishes.`
                : `The ${FEATURE_NAME} speech model could not be downloaded. Check your connection and try again.`
        })
        return
      }
      const percent =
        model.downloadProgress !== null ? ` ${Math.round(model.downloadProgress * 100)}%` : ''
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: model.usingFallback
          ? `Downloading the speech model…${percent} ${FEATURE_NAME} will be ready in a moment.`
          : `Preparing the speech model.${percent ? ` Downloading…${percent}.` : ''} Try again in a moment.`
      })
      return
    }
    const access = this.deps.microphoneAccess()
    if (access === 'not-determined') {
      // macOS has never been asked: show its dialog from here, so it appears from
      // the pill and the app gets listed, instead of failing deeper in the engine.
      void this.askMicrophoneThenStart(trigger, holdId)
      return
    }
    if (access === 'denied' || access === 'restricted') {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: this.copy.microphoneOff
      })
      return
    }
    const claim = this.deps.ownership.claim('dictation', this.deps.engine.running)
    if (!claim.ok) {
      const finishing = claim.heldBy === 'dictation'
      if (trigger === 'handsfree' && finishing) {
        // The first tap of the double tap opened and discarded a session; the
        // engine is still draining it. Start as soon as it lets go.
        this.deferredStart = { until: this.deps.now() + DEFERRED_START_MS }
        return
      }
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: finishing
          ? 'Finishing the previous dictation. Try again in a moment.'
          : claim.message
      })
      return
    }
    // From here the lease is ours; every exit path below must release it.
    const now = this.deps.now()
    const gen = this.state.nextGen
    const snapshotId = `dn-${gen}-${now}`
    const microphone = resolveMicrophone(settings.microphoneUid, this.devices)
    void this.refreshDevices()
    this.deferredStart = null
    this.lastStartAt = now
    this.showHiddenPill()
    this.setPanel(null)
    const context: SessionContext = {
      gen,
      snapshotId,
      target: Promise.resolve(null),
      targetDescription: null,
      micUid: microphone.uid,
      consent: settings.byokConsent,
      warmAtStart: this.deps.engine.warm,
      settings: structuredClone(settings),
      modelOptions: this.deps.cleanupOptions(),
      plan: null,
      change: null,
      marks: { start: now },
      detail: {}
    }
    this.sessions.set(gen, context)
    this.capture = { gen, lease: claim.lease }
    this.deps.onMicHeld(true)
    this.micOpen = false
    this.level = 0
    const expectedEngine = modelEngineFor(context)
    // Load the local model while the person speaks, so it is ready when they stop.
    if (expectedEngine === 'local') this.deps.warmCleanupModel?.()
    this.dispatch({
      type: 'start',
      trigger,
      // Only the model steps need the engine path; the rest is instant and runs in place.
      cleanupMode: expectedEngine,
      nowMs: now,
      doubleTap: settings.handsFreeDoubleTap,
      micFellBack: microphone.fellBack,
      ...(holdId !== undefined ? { holdId } : {})
    })
  }

  /**
   * First use: ask for the microphone, then start the session the user asked for.
   * A hold key may have been released while the dialog was up, so a hold only
   * reports the result and waits for the next press.
   */
  private async askMicrophoneThenStart(
    trigger: 'toggle' | 'hold' | 'handsfree' | 'pill' | 'click',
    holdId?: number
  ): Promise<void> {
    if (this.askingMicrophone) return
    this.askingMicrophone = true
    this.dispatch({
      type: 'notice',
      level: 'info',
      message: this.copy.microphoneAsk
    })
    let allowed = false
    try {
      allowed = await this.deps.requestMicrophone()
    } finally {
      this.askingMicrophone = false
    }
    if (this.disposed) return
    this.broadcast()
    if (!allowed) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: this.copy.microphoneOff
      })
      return
    }
    if (trigger === 'hold') {
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: 'Microphone allowed. Hold the key again to dictate.'
      })
      return
    }
    this.dispatch({ type: 'dismiss' })
    this.begin(trigger, holdId)
  }

  /**
   * Ask macOS for one of the permissions from the process that needs it: the
   * microphone from the app, Accessibility and Input Monitoring from the helper.
   * Returns how it ended; the settings page refreshes from the status broadcast.
   */
  async requestPermission(pane: PermissionPane): Promise<PermissionOutcome> {
    if (this.disposed || !this.deps.supported) return 'unavailable'
    let outcome: PermissionOutcome
    switch (pane) {
      case 'microphone': {
        const access = this.deps.microphoneAccess()
        if (access === 'granted') outcome = 'granted'
        // Windows has no per-app microphone prompt; the switch is in Windows Settings.
        else if (barkPlatform(this.deps.platform ?? 'darwin') === 'win32') outcome = 'open-settings'
        else if (access === 'not-determined')
          outcome = (await this.deps.requestMicrophone()) ? 'granted' : 'denied'
        else outcome = 'open-settings'
        break
      }
      case 'accessibility': {
        const trusted = await this.deps.helper.requestAccessibility()
        outcome = trusted === null ? 'unavailable' : trusted ? 'granted' : 'prompted'
        break
      }
      case 'input-monitoring': {
        const state = (await this.deps.helper.status())?.inputMonitoringAccess ?? null
        if (state === 'granted') outcome = 'granted'
        else if (state === 'denied') outcome = 'open-settings'
        else {
          const granted = await this.deps.helper.requestInputMonitoring()
          outcome = granted === null ? 'unavailable' : granted ? 'granted' : 'prompted'
        }
        break
      }
    }
    // Pick up whatever changed, without a restart where macOS allows it.
    await this.status()
    this.broadcast()
    return outcome
  }

  /* ---- engine events (routed here by the host while dictation owns capture) ---- */

  /** Returns true when the event belonged to dictation and was consumed. */
  handleEngineEvent(event: EngineEvent): boolean {
    const capture = this.capture
    if (!capture) return false
    const gen = capture.gen
    switch (event.event) {
      case 'status':
        if (event.stage === 'transcribing') this.dispatch({ type: 'asr-ready', gen })
        if (event.stage === 'input_default_fallback') {
          this.dispatch({ type: 'mic-fallback', gen })
        }
        if (event.stage === 'input_default_fallback' || event.stage === 'mic_restarting') {
          this.deps.log(`engine ${event.stage}`)
        }
        break
      case 'ready':
        this.micOpen = true
        this.mark(gen, 'micOpen')
        this.dispatch({ type: 'capture-ready', gen })
        break
      case 'level':
        this.handleLevel(Math.min(1, Math.sqrt(event.peak) * 1.3))
        break
      case 'partial':
        if (event.channel === undefined || event.channel === 'mic') {
          this.dispatch({ type: 'partial', gen, text: event.text })
        }
        break
      case 'final':
        if (event.channel === undefined || event.channel === 'mic') {
          this.mark(gen, 'final')
          const detail = this.sessions.get(gen)?.detail
          if (detail && typeof event.drainMs === 'number') detail.engineDrainMs = event.drainMs
          if (detail && typeof event.finishMs === 'number') detail.engineFinishMs = event.finishMs
          this.finishSpeech(gen, event.text)
        }
        break
      case 'error':
        this.onEngineError(gen, event.message)
        break
      case 'done':
        // A finished session that produced no final text ended without speech.
        this.dispatch({ type: 'engine-ended', gen })
        break
      case 'spawn-error':
        this.dispatch({ type: 'engine-failed', gen, message: event.message })
        this.releaseCapture()
        break
      case 'exit':
        this.dispatch({ type: 'engine-ended', gen })
        this.releaseCapture()
        break
      default:
        break
    }
    return true
  }

  /**
   * The speech has ended. Run the instant steps (tidy-up, style) in place and hand
   * the reducer the finished text, or, when a model step is planned, the raw words
   * with the text to fall back on. The focused app, known since the session began,
   * decides the style.
   */
  private finishSpeech(gen: number, text: string): void {
    const context = this.sessions.get(gen)
    if (!context) {
      this.dispatch({ type: 'final', gen, text })
      return
    }
    const trimmed = text.trim()
    const plan = planDictation(
      context.settings,
      context.modelOptions,
      context.targetDescription?.bundleId,
      wordsOf(trimmed).length
    )
    context.plan = plan
    if (!trimmed || plan.steps === 0) {
      // steps: 0 says no model call is coming, even if the session began expecting one.
      this.dispatch({
        type: 'final',
        gen,
        text: trimmed ? deterministicText(trimmed, plan) : text,
        steps: 0
      })
      return
    }
    this.dispatch({
      type: 'final',
      gen,
      text: trimmed,
      fallback: fallbackText(trimmed, plan),
      steps: plan.steps
    })
  }

  /** Whether a sidecar event stream is currently owned by dictation. */
  get ownsCapture(): boolean {
    return this.capture !== null
  }

  /** Microphone level, 0..1, from the engine; drives the meter. */
  handleLevel(peak: number): void {
    this.level = Math.max(0, Math.min(1, peak))
    if (this.state.phase === 'recording' && this.deps.now() - this.lastPartialRender > 90) {
      this.lastPartialRender = this.deps.now()
      this.render()
    }
  }

  private onEngineError(gen: number, message: string): void {
    this.deps.log(`engine error: ${message.slice(0, 120)}`)
    const active = this.state.active
    // Words already heard are worth keeping: drain instead of discarding.
    if (active?.gen === gen && this.state.phase === 'recording' && active.partial.trim()) {
      this.dispatch({ type: 'stop', source: 'button', gen, nowMs: this.deps.now() })
      return
    }
    this.dispatch({
      type: 'engine-failed',
      gen,
      message:
        // Pass the capture layer's own specific microphone messages straight through.
        /no microphone was found|access is turned off|could not be opened/i.test(message)
          ? message
          : /microphone/i.test(message)
            ? 'The microphone stopped delivering audio. Check your input device and try again.'
            : 'The speech engine reported an error. Nothing was inserted.'
    })
  }

  private releaseCapture(): void {
    const capture = this.capture
    if (!capture) return
    this.capture = null
    this.micOpen = false
    this.deps.ownership.release(capture.lease)
    this.deps.onMicHeld(false)
    const deferred = this.deferredStart
    this.deferredStart = null
    if (deferred && this.deps.now() <= deferred.until) this.begin('handsfree')
  }

  /* ---- reducer plumbing ---- */

  private dispatch(event: SessionEvent): void {
    if (this.disposed && event.type !== 'cancel') return
    const previous = this.state
    const result = reduce(this.state, event)
    this.state = result.state
    for (const effect of result.effects) this.perform(effect)
    if (result.state !== previous) this.afterTransition(previous)
  }

  private perform(effect: SessionEffect): void {
    switch (effect.type) {
      case 'escape-register':
        this.registerEscape()
        break
      case 'escape-unregister':
        this.unregisterEscape()
        break
      case 'snapshot-target':
        this.takeSnapshot(effect.gen)
        break
      case 'capture-start':
        this.startCapture(effect.gen)
        break
      case 'capture-stop':
        this.mark(effect.gen, 'stop')
        if (this.capture?.gen === effect.gen) this.deps.engine.stop()
        break
      case 'capture-cancel':
        // The sidecar drains whatever it buffered; the result is ignored
        // because the session is gone, and the lease stays until it exits.
        if (this.capture?.gen === effect.gen) this.deps.engine.stop()
        this.finishSession(effect.gen)
        break
      case 'timers-set':
        this.setTimer(effect.gen, effect.stage, effect.ms)
        break
      case 'timers-clear':
        this.clearTimers(effect.gen)
        break
      case 'cleanup-start':
        void this.runCleanup(effect.gen, effect.mode, effect.raw)
        break
      case 'cleanup-abort':
        if (this.cleanupAbort?.gen === effect.gen) {
          this.cleanupAbort.controller.abort()
          this.cleanupAbort = null
        }
        break
      case 'deliver':
        void this.runDelivery(effect.gen, effect.text)
        break
    }
  }

  private afterTransition(previous: SessionState): void {
    const state = this.state
    if (state.phase === 'recovery' && state.resting?.kind === 'recovery') {
      const resting = state.resting
      if (!this.recoveries.some((r) => r.gen === resting.gen)) {
        this.recoveries = [
          { gen: resting.gen, text: resting.text, reason: resting.reason, at: this.deps.now() },
          ...this.recoveries
        ].slice(0, MAX_RECOVERIES)
      }
    }
    if (previous.active && !state.active) this.finishSession(previous.active.gen)
    if (state.phase === 'recording' && previous.phase !== 'recording' && state.active) {
      this.startMicPoll(state.active.gen)
    } else if (previous.phase === 'recording' && state.phase !== 'recording') {
      this.stopMicPoll()
    }
    // Sound comes back before the stop tone is played, and goes away after the start tone.
    if (state.phase === 'recording' && previous.phase !== 'recording' && state.active) {
      this.muteAudio(state.active.gen)
    } else if (state.phase !== 'recording' && state.phase !== 'preparing') {
      this.restoreAudio()
    }
    this.scheduleRestingDismiss()
    this.render()
    this.broadcast()
    const sound = soundForTransition(
      previous.phase,
      state.phase,
      (state.active ?? previous.active)?.trigger ?? null,
      this.deps.settings.get().startSound
    )
    if (sound) this.deps.overlay.playSound(sound)
  }

  /**
   * Silence music, radio or video for the length of the recording. Only when the
   * person has asked for it, and only a change the helper can undo: whatever it
   * mutes comes back when recording ends, is cancelled or fails.
   */
  private muteAudio(gen: number): void {
    this.restoreAudio()
    const context = this.sessions.get(gen)
    if (!context?.settings.muteAudioWhileDictating) return
    this.audioMuted = true
    const mute = (): void => {
      this.muteTimer = null
      this.muteInFlight = this.deps.helper.muteOutput().catch(() => false)
    }
    if (context.settings.startSound) {
      this.muteTimer = setTimeout(mute, MUTE_AFTER_TONE_MS)
      this.muteTimer.unref?.()
    } else {
      mute()
    }
  }

  private restoreAudio(): void {
    if (!this.audioMuted) return
    this.audioMuted = false
    if (this.muteTimer) clearTimeout(this.muteTimer)
    this.muteTimer = null
    // Wait for a mute that is already on its way (the helper may still be starting), so
    // the restore can never run first and leave the sound off. With nothing held the
    // helper treats it as a no-op.
    const pending = this.muteInFlight
    this.muteInFlight = null
    void Promise.resolve(pending)
      .then(() => this.deps.helper.restoreOutput())
      .catch(() => undefined)
  }

  /** While recording, watch the chosen input for a mute or a volume of zero. */
  private startMicPoll(gen: number): void {
    this.stopMicPoll()
    const check = (): void => {
      const uid = this.sessions.get(gen)?.micUid ?? null
      void this.deps.helper.inputState(uid).then((input) => {
        if (input) this.dispatch({ type: 'mic-state', gen, muted: micLooksMuted(input) })
      })
    }
    check()
    this.micPoll = setInterval(check, MIC_POLL_MS)
    this.micPoll.unref?.()
  }

  private stopMicPoll(): void {
    if (this.micPoll) clearInterval(this.micPoll)
    this.micPoll = null
  }

  private scheduleRestingDismiss(): void {
    if (this.restingTimer) clearTimeout(this.restingTimer)
    this.restingTimer = null
    const resting = this.state.resting
    if (this.state.phase !== 'notice' || resting?.kind !== 'notice') return
    const ms = resting.level === 'success' ? SUCCESS_NOTICE_MS : NOTICE_MS
    this.restingTimer = setTimeout(() => this.dispatch({ type: 'dismiss' }), ms)
    this.restingTimer.unref?.()
  }

  /** Drop per-session bookkeeping once the logical session is over. */
  private finishSession(gen: number): void {
    this.clearTimers(gen)
    if (this.cleanupAbort?.gen === gen) {
      this.cleanupAbort.controller.abort()
      this.cleanupAbort = null
    }
    const context = this.sessions.get(gen)
    if (context) this.deps.helper.release(context.snapshotId)
    // Keep the context a moment for latency accounting by delivery; the map is
    // tiny and bounded, so prune old entries instead of timing precisely.
    for (const key of [...this.sessions.keys()]) if (key < gen - 3) this.sessions.delete(key)
  }

  private render(): void {
    const context: OverlayContext = {
      micOpen: this.micOpen,
      level: this.level,
      insertionUnavailable: this.helperStatus !== null && !this.helperStatus.accessibility,
      pillVisible: this.pillVisible(),
      edge: this.deps.settings.get().pillEdge,
      showLiveText: this.deps.settings.get().showLiveText,
      showStatusMessages: this.deps.settings.get().showStatusMessages,
      target: this.overlayTarget(),
      ...(this.clipboardWarning
        ? {
            clipboardWarning:
              this.state.resting?.kind === 'recovery' &&
              this.state.resting.gen === this.clipboardWarning.gen
                ? this.clipboardWarning.message
                : null
          }
        : {})
    }
    const base = overlayView(this.state, context)
    this.deps.overlay.render(this.panel && this.panelFits() ? panelView(this.panel, base) : base)
  }

  /** The app a live session will type into, when the user wants it shown on the pill. */
  private overlayTarget(): OverlayTarget | null {
    const active = this.state.active
    if (!active) return null
    const context = this.sessions.get(active.gen)
    // The setting is read once per session, with the rest, so it cannot flip mid-flight.
    if (!context?.settings.showTargetApp) return null
    const description = context.targetDescription
    if (!description || !description.appName) return null
    // Wait for the icon to be read (or to fail) so the pill never flashes a placeholder.
    if (description.appPath && description.bundleId && !this.appIcons.has(description.bundleId))
      return null
    return {
      name: description.appName,
      icon: this.appIcons.get(description.bundleId) ?? null
    }
  }

  private async loadAppIcon(gen: number, description: TargetDescription): Promise<void> {
    const { bundleId, appPath } = description
    if (!bundleId || !appPath || this.appIcons.has(bundleId)) return
    if (!this.sessions.get(gen)?.settings.showTargetApp) return
    let icon: string | null = null
    try {
      icon = await this.deps.helper.appIcon(appPath)
    } catch {
      icon = null
    }
    // Remember a miss too, so a bad bundle is not retried on every session.
    if (this.appIcons.size >= 64) this.appIcons.clear()
    this.appIcons.set(bundleId, icon)
    if (this.state.active?.gen === gen) this.render()
  }

  /** A panel sits over the resting pill; it never covers a live session, kept text or an error. */
  private panelFits(): boolean {
    if (isBusy(this.state) || this.state.phase === 'recovery') return false
    const resting = this.state.resting
    return !(resting?.kind === 'notice' && resting.level !== 'success')
  }

  private setPanel(panel: OverlayPanel | null, ms = 0): void {
    if (this.panelTimer) clearTimeout(this.panelTimer)
    this.panelTimer = null
    // A standing clipboard offer comes back whenever no other panel is shown (it never times out).
    if (!panel && this.offer && !this.disposed) {
      panel = this.offerPanel()
      ms = 0
    }
    this.panel = panel
    if (panel && ms > 0) {
      this.panelTimer = setTimeout(() => this.setPanel(null), ms)
      this.panelTimer.unref?.()
    }
    this.render()
  }

  private mark(gen: number, key: keyof SessionContext['marks']): void {
    const context = this.sessions.get(gen)
    if (context && context.marks[key] === undefined) context.marks[key] = this.deps.now()
  }

  /* ---- effects ---- */

  private registerEscape(): void {
    if (this.escapeRegistered) return
    try {
      this.escapeRegistered = this.deps.shortcuts.register(ESCAPE, () =>
        this.dispatch({ type: 'cancel' })
      )
    } catch {
      this.escapeRegistered = false
    }
  }

  private unregisterEscape(): void {
    if (!this.escapeRegistered) return
    this.escapeRegistered = false
    this.deps.shortcuts.unregister(ESCAPE)
  }

  private takeSnapshot(gen: number): void {
    const context = this.sessions.get(gen)
    if (!context) return
    context.target = this.deps.helper.snapshot(context.snapshotId).then((description) => {
      context.targetDescription = description
      if (description?.bundleId) this.noteRecentApp(description.bundleId, description.appName)
      if (description) void this.loadAppIcon(gen, description)
      if (description && this.helperStatus)
        this.helperStatus.accessibility = description.accessibility
      if (description && !this.helperStatus) {
        this.helperStatus = {
          accessibility: description.accessibility,
          inputMonitoring: false,
          inputMonitoringAccess: null,
          secureInput: false,
          conflicts: [],
          holdActive: false,
          mouseActive: false,
          fnKeyAction: null,
          hooksLive: null
        }
      }
      if (this.state.active?.gen === gen) this.render()
      return description
    })
  }

  private startCapture(gen: number): void {
    const micUid = this.sessions.get(gen)?.micUid ?? null
    const started = this.deps.engine.tryStartLive({
      source: 'mic',
      levels: true,
      ...(micUid ? { inputDevice: micUid } : {})
    })
    if (started.started) return
    this.deps.log(`capture refused: ${started.reason}`)
    this.dispatch({ type: 'engine-failed', gen, message: started.reason })
    this.releaseCapture()
  }

  private setTimer(
    gen: number,
    stage: 'recording' | 'warning' | 'finalizing' | 'cleaning',
    ms: number
  ): void {
    const key = `${gen}:${stage}`
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      if (stage === 'recording') {
        this.dispatch({ type: 'stop', source: 'limit', gen, nowMs: this.deps.now() })
      } else if (stage === 'warning') {
        this.dispatch({ type: 'limit-warning', gen })
      } else {
        this.dispatch({ type: 'timeout', gen, stage })
      }
    }, ms)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  private clearTimers(gen: number): void {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${gen}:`)) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    if (this.restingTimer) clearTimeout(this.restingTimer)
    this.restingTimer = null
  }

  private async runCleanup(
    gen: number,
    mode: Exclude<CleanupMode, 'raw'>,
    raw: string
  ): Promise<void> {
    const context = this.sessions.get(gen)
    const finish = (outcome: CleanupOutcome): void => {
      this.mark(gen, 'cleanupEnd')
      this.dispatch({ type: 'cleanup-done', gen, outcome })
    }
    this.mark(gen, 'cleanupStart')
    const plan = context?.plan
    if (!context || !plan) {
      finish({ kind: 'kept-raw', reason: 'The cleanup had no plan; the raw transcript was used.' })
      return
    }
    const controller = new AbortController()
    this.cleanupAbort = { gen, controller }
    try {
      const outcome = await runModelSteps(
        raw,
        plan,
        (request, signal) => this.deps.cleanup(mode, request, signal, context.consent),
        controller.signal,
        this.deps.now
      )
      // Cancelled, timed out, or superseded while the model was working.
      if (controller.signal.aborted || this.state.active?.gen !== gen) return
      if (outcome.timings.tidyMs !== null) context.detail.tidyMs = outcome.timings.tidyMs
      if (outcome.timings.transformMs !== null) {
        context.detail.transformMs = outcome.timings.transformMs
      }
      context.change = outcome.change
      finish({
        kind: 'cleaned',
        text: outcome.text,
        ...(outcome.note ? { note: outcome.note } : {})
      })
    } catch (error) {
      if (controller.signal.aborted || this.state.active?.gen !== gen) return
      const message = error instanceof Error ? error.message : 'Cleanup failed.'
      finish({ kind: 'kept-raw', reason: `${message.slice(0, 120)} The raw transcript was used.` })
    } finally {
      if (this.cleanupAbort?.controller === controller) this.cleanupAbort = null
    }
  }

  private async runDelivery(gen: number, text: string): Promise<void> {
    const context = this.sessions.get(gen)
    this.mark(gen, 'deliverStart')
    // Kept only in memory so "paste last" can type it again; never logged or written.
    this.lastTranscript = text
    // Ask the helper to keep the field only when learning from corrections is on.
    const learn = context?.settings.learnFromEdits === true
    const outcome = await this.deliver(
      context,
      text,
      (stage) => {
        if (stage === 'sent') this.mark(gen, 'helperSent')
      },
      learn ? { watch: true } : undefined
    )
    this.mark(gen, 'deliverEnd')
    if (context?.detail && outcome.helper) context.detail.helper = outcome.helper
    // A transform that changed the text: remember before and after, for View and Undo.
    if (outcome.kind === 'delivered' && context?.change) {
      this.recordChange(context.change)
    }
    if (learn && context && outcome.kind === 'delivered')
      this.learner.start(context.snapshotId, text)
    if (context) this.recordLatency(context)
    // A newer session may exist by now; the reducer ignores a stale generation.
    this.dispatch({ type: 'delivery-done', gen, outcome })
    this.reportClipboard(outcome)
  }

  /**
   * Windows only: the user's own clipboard could not be fully put back after a delivery attempt.
   * Every entry point (dictation, paste last, undo, transforms) reports it here, whatever the
   * outcome: a panel after a delivery, the recovery card's warning line when one is showing.
   * Returns the sentence for a caller that shows a plain notice instead (no card), else null.
   */
  private reportClipboard(outcome: {
    kind: string
    clipboard?: string
    clipboardHolds?: string
    deliveryId?: string
  }): string | null {
    // The newest delivery is the one a later clipboard result may still change.
    if (this.windows) this.clipboardDelivery = outcome.deliveryId ?? null
    const problem = this.windows
      ? clipboardProblem(outcome.clipboard, outcome.clipboardHolds)
      : null
    if (!problem) return null
    if (outcome.kind === 'delivered') {
      this.setPanel({ kind: 'clipboard', problem }, NOTICE_MS)
      return null
    }
    const resting = this.state.resting
    if (resting?.kind === 'recovery') {
      this.clipboardWarning = { gen: resting.gen, message: CLIPBOARD_PROBLEM_MESSAGES[problem] }
      this.render()
      return null
    }
    return CLIPBOARD_PROBLEM_MESSAGES[problem]
  }

  /**
   * Windows: the warning for the last delivery said the clipboard could not be told; its rollback
   * finished later. The card's line and the panel now say what actually happened (or go away).
   */
  private clipboardLate(clipboard: string, deliveryId?: string): void {
    // Only the newest delivery's notice changes: a result for an older one never clears (or sets) it.
    if (deliveryId && this.clipboardDelivery && deliveryId !== this.clipboardDelivery) {
      this.deps.log(
        `clipboard result for an earlier delivery (${clipboard}); the current notice stays`
      )
      return
    }
    const problem = clipboardProblem(clipboard, undefined)
    this.deps.log(`clipboard result after the reply: ${clipboard}`)
    if (this.clipboardWarning) {
      this.clipboardWarning = problem
        ? { gen: this.clipboardWarning.gen, message: CLIPBOARD_PROBLEM_MESSAGES[problem] }
        : null
      this.render()
    }
    if (this.panel?.kind === 'clipboard')
      this.setPanel(problem ? { kind: 'clipboard', problem } : null, problem ? NOTICE_MS : 0)
    // A problem nobody was told about yet (a kept transaction left pending, a rollback that failed later):
    // the recovery card's warning line when that card shows, else the clipboard panel.
    else if (problem && !this.clipboardWarning) {
      const resting = this.state.resting
      if (resting?.kind === 'recovery') {
        this.clipboardWarning = { gen: resting.gen, message: CLIPBOARD_PROBLEM_MESSAGES[problem] }
        this.render()
      } else this.setPanel({ kind: 'clipboard', problem }, NOTICE_MS)
    }
  }

  private async deliver(
    context: Pick<SessionContext, 'snapshotId' | 'target'> | undefined,
    text: string,
    onStage?: (stage: 'sent') => void,
    guards?: DeliveryGuards
  ): Promise<
    DeliveryOutcome & {
      helper?: HelperDeliveryTimings
      clipboard?: string
      clipboardHolds?: string
      deliveryId?: string
    }
  > {
    if (!context) return { kind: 'recover', reason: 'no-target' }
    const target = await context.target
    if (!target) return { kind: 'recover', reason: 'helper-unavailable' }
    if (!target.accessibility) return { kind: 'recover', reason: 'accessibility-denied' }
    if (!target.hasElement) return { kind: 'recover', reason: 'no-target' }
    if (target.secure) return { kind: 'recover', reason: 'secure-field' }
    onStage?.('sent')
    // Windows: named here, so a clipboard result that arrives later can be matched to this delivery.
    const deliveryId = this.windows ? randomUUID() : undefined
    const result = await this.deps.helper.deliver(context.snapshotId, text, guards, deliveryId)
    this.deps.log(
      `delivery ${result.outcome}${result.reason ? ` (${result.reason})` : ''} via ${result.method ?? 'none'}, clipboard ${result.clipboard}`
    )
    // The helper's clipboard result travels with the outcome to every caller (reportClipboard).
    const helper = {
      ...(result.timings ? { helper: result.timings } : {}),
      clipboard: result.clipboard,
      ...(result.clipboardHolds ? { clipboardHolds: result.clipboardHolds } : {}),
      ...(deliveryId ? { deliveryId } : {})
    }
    if (result.outcome === 'delivered') return { kind: 'delivered', ...helper }
    if (result.outcome === 'uncertain') {
      // Windows: the typing fallback stopped part-way, and the helper says why.
      if (this.windows && result.method === 'type' && typeof result.charsDelivered === 'number')
        return {
          kind: 'recover',
          reason: result.reason === 'secure-field' ? 'typing-stopped-secure' : 'typing-stopped',
          ...helper
        }
      return { kind: 'recover', reason: 'insertion-uncertain', ...helper }
    }
    if (result.outcome === 'refused') {
      // The helper is restarting itself; say so only when a restart will actually happen.
      if (result.reason === 'helper-busy' && this.deps.helper.willRestart?.() === false)
        return { kind: 'recover', reason: 'helper-stopped', ...helper }
      return { kind: 'recover', reason: refusalReason(result.reason), ...helper }
    }
    return { kind: 'recover', reason: 'insertion-failed', ...helper }
  }

  /**
   * Type the last transcript into whatever field has focus now, through the same
   * snapshot, validation and insertion path as a live dictation.
   */
  async pasteLast(): Promise<void> {
    const settings = this.deps.settings.get()
    if (this.disposed || !this.deps.supported || !settings.enabled || this.pasting) return
    if (isBusy(this.state)) return
    const text = this.lastTranscript
    if (!text) {
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: 'There is no transcript to paste yet.'
      })
      return
    }
    if (!this.deps.helper.available) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: `The ${FEATURE_NAME} helper is missing from this build.`
      })
      return
    }
    this.pasting = true
    const snapshotId = `dn-paste-${this.deps.now()}`
    try {
      const outcome = await this.deliver(
        { snapshotId, target: this.deps.helper.snapshot(snapshotId) },
        text
      )
      if (outcome.kind === 'delivered') {
        this.dispatch({ type: 'notice', level: 'success', message: 'Pasted.' })
        this.reportClipboard(outcome)
      } else {
        const note = this.reportClipboard(outcome)
        this.dispatch({
          type: 'notice',
          level: 'error',
          message: note
            ? `${RECOVERY_MESSAGES[outcome.reason]} ${note}`
            : RECOVERY_MESSAGES[outcome.reason]
        })
      }
    } finally {
      this.deps.helper.release(snapshotId)
      this.pasting = false
    }
  }

  /**
   * Put the last transcript on the clipboard. Same rules as paste-last: the text
   * comes from memory only and is never logged or written anywhere else.
   */
  async copyLast(): Promise<void> {
    const settings = this.deps.settings.get()
    if (this.disposed || !this.deps.supported || !settings.enabled || isBusy(this.state)) return
    const text = this.lastTranscript
    if (!text) {
      this.dispatch({
        type: 'notice',
        level: 'info',
        message: 'There is no transcript to copy yet.'
      })
      return
    }
    try {
      await this.deps.writeClipboard(text)
      this.dispatch({ type: 'notice', level: 'success', message: 'Copied.' })
    } catch {
      this.dispatch({ type: 'notice', level: 'error', message: 'Could not copy to the clipboard.' })
    }
  }

  private recordLatency(context: SessionContext): void {
    const m = context.marks
    const diff = (a?: number, b?: number): number | null =>
      a !== undefined && b !== undefined ? b - a : null
    const helper = context.detail.helper ?? null
    this.lastLatency = {
      startMs: diff(m.start, m.micOpen),
      stopToFinalMs: diff(m.stop, m.final),
      cleanupMs: diff(m.cleanupStart, m.cleanupEnd),
      insertMs: diff(m.deliverStart, m.deliverEnd),
      recordedMs: diff(m.micOpen, m.stop),
      warm: context.warmAtStart,
      stages: {
        stopToFinalMs: diff(m.stop, m.final),
        engineDrainMs: context.detail.engineDrainMs ?? null,
        engineFinishMs: context.detail.engineFinishMs ?? null,
        finalToDeliverMs: diff(m.final, m.deliverStart),
        tidyMs: context.detail.tidyMs ?? null,
        transformMs: context.detail.transformMs ?? null,
        targetWaitMs: diff(m.deliverStart, m.helperSent),
        helperRoundTripMs: diff(m.helperSent, m.deliverEnd),
        helper,
        stopToDoneMs: diff(m.stop, m.deliverEnd)
      }
    }
    const { stages, ...top } = this.lastLatency
    const { helper: helperTimings, ...stageNumbers } = stages
    // Numbers and booleans only; never text.
    this.deps.recordMetrics({
      at: this.deps.now(),
      ...top,
      ...stageNumbers,
      ...(helperTimings
        ? {
            helperValidateMs: helperTimings.validateMs,
            helperInsertMs: helperTimings.insertMs,
            helperConfirmMs: helperTimings.confirmMs,
            helperSettleMs: helperTimings.settleMs,
            helperSkippedAx: helperTimings.skippedAx
          }
        : {})
    })
  }

  /* ---- transforms ---- */

  private noteRecentApp(bundleId: string, name: string): void {
    this.recentApps = [
      { bundleId, name: name || bundleId },
      ...this.recentApps.filter((app) => app.bundleId !== bundleId)
    ].slice(0, 8)
  }

  /** Remember what a transform changed, and offer View and Undo on the pill. */
  private recordChange(change: TransformChange): void {
    this.lastChange = { name: change.name, before: change.before, after: change.after }
    // Quiet mode may hide the offer; View and Undo stay in the pill's menu.
    if (isMessageShown('change', this.quiet()))
      this.setPanel({ kind: 'changed', name: change.name }, CHANGE_PANEL_MS)
    else this.render()
    this.broadcast()
  }

  private quiet(): { showLiveText: boolean; showStatusMessages: boolean } {
    const settings = this.deps.settings.get()
    return { showLiveText: settings.showLiveText, showStatusMessages: settings.showStatusMessages }
  }

  /** Show the before and after of the last transform. */
  viewLastChange(): void {
    if (!this.lastChange || this.disposed) return
    this.setPanel(
      {
        kind: 'diff',
        name: this.lastChange.name,
        segments: diffWords(this.lastChange.before, this.lastChange.after)
      },
      DIFF_PANEL_MS
    )
  }

  /**
   * Put the text from before the last transform back, through the same verified
   * insertion: the helper finds the one copy of the new text in the focused field,
   * selects it and replaces it. If the field no longer holds it, the old text is
   * kept on the recovery card instead of being forced in.
   */
  async undoLastChange(): Promise<void> {
    const change = this.lastChange
    if (!change || this.disposed || isBusy(this.state)) return
    this.setPanel(null)
    this.lastChange = null
    const snapshotId = `dn-undo-${this.deps.now()}`
    try {
      const target = this.deps.helper.snapshot(snapshotId)
      const outcome = await this.deliver({ snapshotId, target }, change.before, undefined, {
        replace: change.after
      })
      if (outcome.kind === 'delivered') {
        this.lastTranscript = change.before
        this.dispatch({ type: 'notice', level: 'success', message: 'Put back.' })
      } else {
        this.dispatch({ type: 'keep', text: change.before, reason: outcome.reason })
      }
      this.reportClipboard(outcome)
    } finally {
      this.deps.helper.release(snapshotId)
      this.broadcast()
    }
  }

  /**
   * Run one transform now. It works on the text selected in the focused app when
   * that can be read, and replaces exactly that selection; otherwise on the last
   * dictation, inserted at the cursor. Whatever the model returns is checked, and
   * if it is doubtful or the field changed meanwhile, nothing is touched and the
   * result is kept for copying.
   */
  async runTransform(id: string): Promise<void> {
    const settings = this.deps.settings.get()
    if (this.disposed || !this.deps.supported || !settings.enabled) return
    if (!settings.transforms.enabled || this.transforming || isBusy(this.state)) return
    const def = settings.transforms.items.find((item) => item.id === id)
    if (!def) return
    const model = resolveModel(this.deps.cleanupOptions(), settings)
    if (!model.engine) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message:
          model.path === 'needs-consent'
            ? `Allow sending text to ${model.label} in Settings, ${FEATURE_NAME}, Tidy-up, then try ${def.name} again.`
            : this.copy.transformsNeedModel
      })
      return
    }
    if (!this.deps.helper.available) {
      this.dispatch({
        type: 'notice',
        level: 'error',
        message: `The ${FEATURE_NAME} helper is missing from this build.`
      })
      return
    }
    const controller = new AbortController()
    this.transforming = controller
    const snapshotId = `dn-tf-${this.deps.now()}`
    const timeout = setTimeout(
      () => controller.abort(),
      model.engine === 'local' ? TRANSFORM_TIMEOUT_MS.local : TRANSFORM_TIMEOUT_MS.byok
    )
    timeout.unref?.()
    try {
      const target = await this.deps.helper.snapshot(snapshotId)
      let source: string | null = null
      let guards: DeliveryGuards = {}
      let how: 'selection' | 'insert' = 'insert'
      if (target?.accessibility && target.hasElement && target.secure !== true) {
        const selection = await this.deps.helper.selection(snapshotId)
        if (selection.ok && selection.text.trim()) {
          source = selection.text
          guards = { expectSelection: selection.text }
          how = 'selection'
        }
      }
      if (source === null) {
        source = this.lastTranscript
        how = 'insert'
      }
      if (!source) {
        this.dispatch({
          type: 'notice',
          level: 'info',
          message: 'Select some text first, or dictate something to rewrite.'
        })
        return
      }
      if (source.length > MAX_CLEANUP_CHARS) {
        this.dispatch({
          type: 'notice',
          level: 'error',
          message: `That is too long for ${def.name}. Select a shorter piece.`
        })
        return
      }
      if (isMessageShown('working', this.quiet()))
        this.setPanel({ kind: 'working', name: def.name })
      const started = this.deps.now()
      let output: string
      try {
        output = await this.deps.cleanup(
          model.engine,
          buildTransformRequest(def, source),
          controller.signal,
          settings.byokConsent
        )
      } catch (error) {
        this.setPanel(null)
        this.dispatch({
          type: 'notice',
          level: 'error',
          message: controller.signal.aborted
            ? `${def.name} took too long. Nothing was changed.`
            : `${def.name}: ${error instanceof Error ? error.message.slice(0, 120) : 'the model failed'}. Nothing was changed.`
        })
        return
      }
      this.setPanel(null)
      const verdict = validateTransform(source, output, def.keepFacts)
      if (!verdict.ok) {
        this.dispatch({
          type: 'notice',
          level: 'error',
          message: `${def.name}: ${verdict.reason} Nothing was changed.`
        })
        return
      }
      if (verdict.text === source) {
        this.dispatch({ type: 'notice', level: 'info', message: 'Nothing to change.' })
        return
      }
      this.deps.recordMetrics({ at: this.deps.now(), transformMs: this.deps.now() - started })
      const outcome = await this.deliver(
        { snapshotId, target: Promise.resolve(target) },
        verdict.text,
        undefined,
        guards
      )
      if (outcome.kind === 'delivered') {
        if (how === 'insert') this.lastTranscript = verdict.text
        this.recordChange({ name: def.name, before: source, after: verdict.text })
      } else {
        // Never lose the rewrite: it waits on the card for copying.
        this.dispatch({ type: 'keep', text: verdict.text, reason: outcome.reason })
      }
      this.reportClipboard(outcome)
    } finally {
      clearTimeout(timeout)
      if (this.transforming === controller) this.transforming = null
      this.deps.helper.release(snapshotId)
      if (this.panel?.kind === 'working') this.setPanel(null)
      this.broadcast()
    }
  }

  /** Each transform's global shortcut, registered while transforms are on. */
  private applyTransformShortcuts(settings: DictationSettings, blocked: ReadonlySet<string>): void {
    const wanted = new Map<string, string>()
    if (settings.transforms.enabled) {
      for (const item of settings.transforms.items)
        if (item.hotkey) wanted.set(item.id, item.hotkey)
    }
    for (const [id, key] of this.transformKeys) {
      if (
        wanted.get(id) === key.accelerator &&
        key.state === 'registered' &&
        !blocked.has(`transform:${id}`)
      )
        continue
      if (key.accelerator) this.deps.shortcuts.unregister(key.accelerator)
      this.transformKeys.delete(id)
    }
    for (const [id, accelerator] of wanted) {
      if (this.transformKeys.has(id)) continue
      if (blocked.has(`transform:${id}`)) {
        this.transformKeys.set(id, { accelerator: null, state: 'conflict' })
        continue
      }
      try {
        const ok = this.deps.shortcuts.register(accelerator, () => void this.runTransform(id))
        this.transformKeys.set(id, {
          accelerator: ok ? accelerator : null,
          state: ok ? 'registered' : 'conflict'
        })
      } catch {
        this.transformKeys.set(id, { accelerator: null, state: 'invalid' })
      }
    }
  }

  /** Shortcut ids that share a combination with another action. The toggle shortcut always wins. */
  private shortcutClashes(settings: DictationSettings): Set<string> {
    const clash = conflictingShortcuts([
      { id: 'toggle', accelerator: settings.toggleShortcut },
      { id: 'paste', accelerator: settings.pasteLastShortcut },
      { id: 'copy', accelerator: settings.copyLastShortcut },
      ...(settings.transforms.enabled
        ? settings.transforms.items.map((item) => ({
            id: `transform:${item.id}`,
            accelerator: item.hotkey
          }))
        : [])
    ])
    clash.delete('toggle')
    return clash
  }

  /* ---- status ---- */

  async status(): Promise<DictationStatus> {
    // Windows: with Bark off the helper is not started (or verified) just to fill the settings page.
    if (this.deps.helperIntegrity && !this.deps.settings.get().enabled) return this.snapshotStatus()
    const helper = await this.deps.helper.status()
    if (helper) this.helperStatus = helper
    this.rearmAfterPermissionGrant(helper)
    void this.refreshDevices()
    return this.snapshotStatus()
  }

  /**
   * A trigger that needed Input Monitoring is retried once the permission shows
   * up, so granting it never needs a manual toggle. If the running helper still
   * cannot create its event tap although macOS now says yes, it is replaced once,
   * because a process started before the grant may not see it.
   */
  private rearmAfterPermissionGrant(helper: HelperStatus | null): void {
    if (!helper) return
    if (!helper.inputMonitoring) {
      this.restartedForPermission = false
      return
    }
    const waiting = this.holdState === 'needs-permission' || this.mouseState === 'needs-permission'
    if (!waiting || this.rearming || !this.deps.settings.get().enabled) return
    this.rearming = true
    void (async () => {
      try {
        await this.applySettings()
        const stillWaiting =
          this.holdState === 'needs-permission' || this.mouseState === 'needs-permission'
        if (stillWaiting && !this.restartedForPermission) {
          this.restartedForPermission = true
          this.deps.helper.restart()
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, HELPER_RESTART_SETTLE_MS)
            timer.unref?.()
          })
          if (!this.disposed) await this.applySettings()
        }
      } finally {
        this.rearming = false
        if (!this.disposed) this.broadcast()
      }
    })()
  }

  private snapshotStatus(): DictationStatus {
    const helper = this.helperStatus
    const settings = this.deps.settings.get() ?? DEFAULT_DICTATION_SETTINGS
    const permissions: DictationPermissions = {
      microphone: this.deps.microphoneAccess(),
      accessibility: helper ? helper.accessibility : null,
      inputMonitoring: helper ? helper.inputMonitoring : null,
      inputMonitoringAccess: helper ? helper.inputMonitoringAccess : null,
      hooksLive: helper ? (helper.hooksLive ?? null) : null
    }
    return {
      channel: this.deps.channel,
      supported: this.deps.supported,
      settings,
      phase: this.state.phase,
      permissions,
      helper: this.helperState(settings.enabled),
      ...(this.deps.helperLocked ? { helperLocked: this.deps.helperLocked() } : {}),
      toggleShortcut: this.toggleState,
      pasteLastShortcut: this.actionKeys.paste.state,
      copyLastShortcut: this.actionKeys.copy.state,
      fnKeyAction: helper?.fnKeyAction ?? null,
      microphones: this.devices,
      microphoneMissing:
        settings.microphoneUid !== null &&
        this.devices.length > 0 &&
        !this.devices.some((device) => device.uid === settings.microphoneUid),
      pillHidden: isPillHidden(settings.pillHiddenUntil, this.deps.now()),
      hasLastTranscript: this.lastTranscript !== null,
      hasLastChange: this.lastChange !== null,
      transformShortcuts: Object.fromEntries(
        [...this.transformKeys].map(([id, key]) => [id, key.state])
      ),
      model: (({ path, label }) => ({ path, label }))(
        resolveModel(this.deps.cleanupOptions(), settings)
      ),
      recentApps: this.recentApps,
      holdKey: this.holdState,
      mouseButton: this.mouseState,
      mouseSwallowing: this.mouseSwallowing,
      conflicts: helper?.conflicts ?? [],
      speech: this.deps.engine.warm ? 'warm' : 'cold',
      cleanup: this.deps.cleanupOptions(),
      recoveries: this.recoveries,
      lastLatency: this.lastLatency
    }
  }

  private broadcast(): void {
    this.deps.broadcast(this.snapshotStatus())
  }

  /** Windows: the integrity verdict changed; the settings page and the pill reflect it. */
  helperIntegrityChanged(): void {
    this.broadcast()
  }

  /** The helper row. macOS: ready or unavailable, as before Windows support. */
  private helperState(enabled: boolean): DictationStatus['helper'] {
    if (!this.deps.helperIntegrity) {
      // macOS: ready or unavailable as before Windows support (blocked is always false there).
      if (!this.deps.helper.available) return 'unavailable'
      return this.deps.helper.blocked ? 'blocked' : 'ready'
    }
    const integrity = this.deps.helperIntegrity()
    if (!this.deps.helper.available || integrity === 'absent') return 'unavailable'
    if (integrity === 'damaged') return 'damaged'
    if (this.deps.helper.blocked) return 'blocked'
    if (!enabled) return 'off'
    return integrity === 'ok' ? 'ready' : 'checking'
  }

  /** Exposed for tests: the reducer state, never persisted. */
  get phase(): SessionState['phase'] {
    return this.state.phase
  }
}

/** The engine path the reducer should expect: only when the plan makes a model call. */
function modelEngineFor(context: SessionContext): CleanupMode {
  const plan = planDictation(context.settings, context.modelOptions, null)
  return plan.steps > 0 && plan.engine ? plan.engine : 'raw'
}

function refusalReason(reason: string | undefined): RecoveryReason {
  switch (reason) {
    case 'focus-changed':
    case 'secure-field':
    case 'no-target':
    case 'not-editable':
    case 'accessibility-denied':
    case 'elevated-target':
    case 'selection-changed':
    case 'text-changed':
      return reason
    case 'helper-unavailable':
      return 'helper-unavailable'
    // Windows: the paste could not happen and the typing fallback was refused up front.
    case 'typing-unsupported':
    case 'typing-unobservable':
      return 'paste-unavailable'
    case 'target-unverifiable':
      return 'target-unverifiable'
    // Windows: a classic box that does not take a line break from dictation (nothing was typed).
    case 'line-break-unsupported':
      return 'line-break-unsupported'
    // Windows: a modifier was down right before Ctrl+V or a typed key (never sent then).
    case 'keys-held':
      return 'keys-held'
    case 'helper-busy':
      return 'helper-busy'
    // A delivery the helper refused because the client had already given up: keep the text.
    case 'deadline-exceeded':
      return 'insertion-failed'
    default:
      return 'insertion-failed'
  }
}
