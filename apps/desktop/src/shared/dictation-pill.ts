import { FEATURE_NAME } from './dictation-brand'
import { BARK_COPY } from './dictation-platform'
/**
 * Pure helpers for the always-visible dictation pill: where it docks, when a
 * "hide for an hour" ends, which microphone a session uses, what the right-click
 * menu lists and which tones the start and stop sounds play. No Electron and no
 * I/O, so every rule here is covered by unit tests.
 */

export const PILL_EDGES = ['bottom', 'left', 'right'] as const
export type PillEdge = (typeof PILL_EDGES)[number]

/** "Hide for an hour" lasts exactly this long. */
export const HIDE_PILL_MS = 60 * 60 * 1000

/** Gap kept between the pill and the screen edge it docks to. */
export const PILL_EDGE_MARGIN = 14

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/* ---- hide for an hour ---- */

export function hideExpiry(nowMs: number): number {
  return nowMs + HIDE_PILL_MS
}

/** True while a "hide for an hour" is still running. The expiry instant itself is visible again. */
export function isPillHidden(hiddenUntilMs: number | null, nowMs: number): boolean {
  return hiddenUntilMs !== null && hiddenUntilMs > nowMs
}

/** Milliseconds until the pill should come back, or null when it is not hidden. */
export function msUntilPillReturns(hiddenUntilMs: number | null, nowMs: number): number | null {
  return isPillHidden(hiddenUntilMs, nowMs) ? (hiddenUntilMs as number) - nowMs : null
}

/* ---- docking ---- */

/**
 * The edge nearest to where the pill was dropped: bottom, left or right of the
 * display's work area. There is no top dock. Ties prefer the bottom, then left.
 */
export function snapEdge(point: Point, area: Rect): PillEdge {
  const toBottom = area.y + area.height - point.y
  const toLeft = point.x - area.x
  const toRight = area.x + area.width - point.x
  const nearest = Math.min(toBottom, toLeft, toRight)
  if (nearest === toBottom) return 'bottom'
  if (nearest === toLeft) return 'left'
  return 'right'
}

/**
 * Where a window of `size` sits when docked to `edge`: centred along the edge,
 * `margin` px in from it, and never outside the work area.
 */
export function dockedBounds(
  edge: PillEdge,
  size: Size,
  area: Rect,
  margin: number = PILL_EDGE_MARGIN
): Rect {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const centreX = area.x + (area.width - width) / 2
  const centreY = area.y + (area.height - height) / 2
  const [x, y] =
    edge === 'bottom'
      ? [centreX, area.y + area.height - height - margin]
      : edge === 'left'
        ? [area.x + margin, centreY]
        : [area.x + area.width - width - margin, centreY]
  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** Anything not on the dock list falls back to the bottom. */
export function coerceEdge(value: unknown): PillEdge {
  return (PILL_EDGES as readonly unknown[]).includes(value) ? (value as PillEdge) : 'bottom'
}

/* ---- microphone ---- */

export interface InputDevice {
  uid: string
  name: string
  isDefault: boolean
}

export interface MicrophoneChoice {
  /** CoreAudio UID to record from; null means the system default. */
  uid: string | null
  /** The saved device is gone, so the default is used instead. */
  fellBack: boolean
}

/**
 * Pick the device for a session. A saved device that is missing from a known,
 * non-empty device list falls back to the system default. An empty list means
 * the listing failed, not that no device exists, so the saved choice is kept
 * and the audio engine's own fallback covers a truly missing device.
 */
export function resolveMicrophone(
  savedUid: string | null,
  devices: readonly InputDevice[]
): MicrophoneChoice {
  if (!savedUid) return { uid: null, fellBack: false }
  if (devices.length === 0) return { uid: savedUid, fellBack: false }
  return devices.some((device) => device.uid === savedUid)
    ? { uid: savedUid, fellBack: false }
    : { uid: null, fellBack: true }
}

/* ---- quiet mode: which overlay messages may be switched off ---- */

/**
 * Every kind of text the overlay can show. The ones that may be turned off are
 * the ones that only narrate; anything that explains a failure, a refusal or
 * a risk of losing text is always shown, whatever the quiet settings say.
 */
export type OverlayMessageKind =
  /** The words being recognised, while speaking or finishing. */
  | 'live-text'
  /** "Starting microphone", "Transcribing", "Cleaning up", "Inserting". */
  | 'status'
  /** The note that cleanup was skipped or timed out and the raw words were used. */
  | 'cleanup-note'
  /** "Inserted.", "Pasted.", "Copied.": the action worked. */
  | 'success'
  /** "Changed by Polish. View / Undo" after a transform. Undo also lives in the pill menu. */
  | 'change'
  /** "Polish..." while a transform runs. */
  | 'working'
  /** "Added to your dictionary: Alec to Alex" after a correction was learned. */
  | 'learned'
  /** A refusal or an empty result: no speech, nothing to paste, still finishing. */
  | 'info'
  /** A failure: microphone denied or lost, helper missing, engine error. */
  | 'error'
  /** Text that could not be inserted and is kept for copying. */
  | 'recovery'
  /** Accessibility is off, so text will be kept instead of typed. */
  | 'accessibility-hint'
  | 'mic-muted'
  | 'mic-fallback'
  /** One minute left in a hands-free session. */
  | 'limit-warning'
  /** A shortcut that another app or action already owns (shown on the settings page). */
  | 'shortcut-conflict'

export type MessageVisibility = 'always' | 'suppressible'

export interface QuietPrefs {
  showLiveText: boolean
  showStatusMessages: boolean
}

/** Which setting, if any, can hide each kind. */
const MESSAGE_GOVERNOR: Record<OverlayMessageKind, 'liveText' | 'status' | 'always'> = {
  'live-text': 'liveText',
  status: 'status',
  'cleanup-note': 'status',
  success: 'status',
  change: 'status',
  working: 'status',
  learned: 'status',
  info: 'always',
  error: 'always',
  recovery: 'always',
  'accessibility-hint': 'always',
  'mic-muted': 'always',
  'mic-fallback': 'always',
  'limit-warning': 'always',
  'shortcut-conflict': 'always'
}

export const OVERLAY_MESSAGE_KINDS = Object.keys(MESSAGE_GOVERNOR) as OverlayMessageKind[]

export function messageVisibility(kind: OverlayMessageKind): MessageVisibility {
  return MESSAGE_GOVERNOR[kind] === 'always' ? 'always' : 'suppressible'
}

/** Whether a message is shown under the user's quiet settings. 'always' kinds never depend on them. */
export function isMessageShown(kind: OverlayMessageKind, prefs: QuietPrefs): boolean {
  switch (MESSAGE_GOVERNOR[kind]) {
    case 'liveText':
      return prefs.showLiveText
    case 'status':
      return prefs.showStatusMessages
    default:
      return true
  }
}

/* ---- right-click menu ---- */

export type PillMenuCommand =
  | { kind: 'hide-hour' }
  | { kind: 'microphone'; uid: string | null }
  | { kind: 'paste-last' }
  | { kind: 'copy-last' }
  | { kind: 'transform'; id: string }
  | { kind: 'view-change' }
  | { kind: 'undo-change' }
  | { kind: 'settings' }
  | { kind: 'toggle-always' }
  | { kind: 'toggle-live-text' }
  | { kind: 'toggle-status' }

export interface PillMenuItem {
  label?: string
  /** A second line under the label on macOS 14.4 and later; ignored earlier. */
  sublabel?: string
  type: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  command?: PillMenuCommand
  submenu?: PillMenuItem[]
}

export interface PillMenuModel {
  showAlways: boolean
  devices: readonly InputDevice[]
  /** The saved microphone choice; null = system default. */
  selectedUid: string | null
  hasLastTranscript: boolean
  showLiveText: boolean
  showStatusMessages: boolean
  /** The transforms the menu offers; empty when transforms are off. */
  transforms?: ReadonlyArray<{ id: string; name: string }>
  /** A transform's before and after is held, so View and Undo make sense. */
  hasLastChange?: boolean
  /** The mouse button for dictation, if one is set, and how it behaves. */
  mouseButton: number | null
  mouseMode: 'click' | 'hold'
}

/** What the pill's right-click menu shows. Wording is our own. */
export function buildPillMenu(model: PillMenuModel): PillMenuItem[] {
  const known = model.devices.some((device) => device.uid === model.selectedUid)
  // A saved device that is unplugged is not listed, so the default row owns the tick.
  const effectiveUid = known ? model.selectedUid : null
  const microphones: PillMenuItem[] = [
    {
      type: 'radio',
      label: 'System default',
      checked: effectiveUid === null,
      command: { kind: 'microphone', uid: null }
    },
    ...model.devices.map((device): PillMenuItem => ({
      type: 'radio',
      label: device.name,
      checked: effectiveUid === device.uid,
      command: { kind: 'microphone', uid: device.uid }
    }))
  ]
  return [
    { type: 'normal', label: 'Hide the pill for an hour', command: { kind: 'hide-hour' } },
    { type: 'normal', label: 'Microphone', submenu: microphones },
    {
      type: 'normal',
      label: 'Paste the last transcript',
      enabled: model.hasLastTranscript,
      command: { kind: 'paste-last' }
    },
    {
      type: 'normal',
      label: 'Copy the last transcript',
      enabled: model.hasLastTranscript,
      command: { kind: 'copy-last' }
    },
    ...(model.transforms && model.transforms.length > 0
      ? [
          {
            type: 'normal' as const,
            label: 'Rewrite the selection or the last thing you said',
            submenu: model.transforms.map((item): PillMenuItem => ({
              type: 'normal',
              label: item.name,
              command: { kind: 'transform', id: item.id }
            }))
          }
        ]
      : []),
    ...(model.hasLastChange
      ? [
          {
            type: 'normal' as const,
            label: 'View the last change',
            command: { kind: 'view-change' as const }
          },
          {
            type: 'normal' as const,
            label: 'Undo the last change',
            command: { kind: 'undo-change' as const }
          }
        ]
      : []),
    { type: 'separator' },
    { type: 'normal', label: `Open ${FEATURE_NAME} settings`, command: { kind: 'settings' } },
    {
      type: 'normal',
      label: `Mouse button for ${FEATURE_NAME}: ${model.mouseButton === null ? 'none' : `${describeMouseButton(model.mouseButton)}, ${model.mouseMode === 'click' ? 'click to start and stop' : 'hold to talk'}`}`,
      sublabel: MOUSE_SOFTWARE_NOTE,
      command: { kind: 'settings' }
    },
    {
      type: 'checkbox',
      label: 'Keep the pill on screen',
      checked: model.showAlways,
      command: { kind: 'toggle-always' }
    },
    {
      type: 'checkbox',
      label: "Show what I'm saying",
      checked: model.showLiveText,
      command: { kind: 'toggle-live-text' }
    },
    {
      type: 'checkbox',
      label: 'Show status messages',
      checked: model.showStatusMessages,
      command: { kind: 'toggle-status' }
    }
  ]
}

/** The shape Electron's Menu.buildFromTemplate accepts, kept free of Electron types. */
export interface MenuTemplateItem {
  label?: string
  sublabel?: string
  type: PillMenuItem['type']
  checked?: boolean
  enabled?: boolean
  submenu?: MenuTemplateItem[]
  click?: () => void
}

/** Turn menu items into a native menu template whose clicks report their command. */
export function toMenuTemplate(
  items: readonly PillMenuItem[],
  onPick: (command: PillMenuCommand) => void
): MenuTemplateItem[] {
  return items.map((item) => {
    const command = item.command
    return {
      type: item.type,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.sublabel !== undefined ? { sublabel: item.sublabel } : {}),
      ...(item.checked !== undefined ? { checked: item.checked } : {}),
      ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
      ...(item.submenu ? { submenu: toMenuTemplate(item.submenu, onPick) } : {}),
      ...(command ? { click: () => onPick(command) } : {})
    }
  })
}

/* ---- sounds ---- */

export type SoundKind = 'start' | 'stop'

export interface Tone {
  freq: number
  /** Offset from the start of the sound. */
  atMs: number
  durMs: number
  gain: number
}

/**
 * Two short rising notes for start and two falling for stop, played as plain
 * sine tones by the overlay page. Original and generated: nothing is sampled.
 */
export function soundTones(kind: SoundKind): Tone[] {
  return kind === 'start'
    ? [
        { freq: 523.25, atMs: 0, durMs: 70, gain: 0.07 },
        { freq: 783.99, atMs: 60, durMs: 110, gain: 0.07 }
      ]
    : [
        { freq: 783.99, atMs: 0, durMs: 70, gain: 0.06 },
        { freq: 523.25, atMs: 60, durMs: 110, gain: 0.06 }
      ]
}

/**
 * Which sound, if any, a phase change calls for. A hold plays its start tone
 * only once recording really began, so an accidental tap stays silent.
 */
export function soundForTransition(
  previous: string,
  next: string,
  trigger: string | null,
  enabled: boolean
): SoundKind | null {
  if (!enabled) return null
  const resting = (phase: string): boolean =>
    phase === 'idle' || phase === 'recovery' || phase === 'notice'
  if (trigger === 'hold') {
    if (previous === 'preparing' && next === 'recording') return 'start'
  } else if (resting(previous) && next === 'preparing') {
    return 'start'
  }
  if ((previous === 'recording' || previous === 'preparing') && next === 'finalizing') {
    return 'stop'
  }
  return null
}

/** Settings text for the double-tap option, including how it meets hold-to-talk. */
export function describeDoubleTap(enabled: boolean, holdKey: string): string {
  if (!enabled) return 'Off. The hold key only works while held.'
  if (holdKey === 'off') return 'On, but it needs a hold-to-talk key. Pick one above.'
  return 'Tap the key twice quickly to keep recording, then tap once to finish. A press that begins right after a tap latches instead of acting as hold-to-talk.'
}

/**
 * Heads-up for the Fn/Globe key, which macOS can act on by itself. `action` is
 * the system's "Press Globe key to" setting (0 nothing, 1 input source, 2 emoji
 * and symbols, 3 dictation); null when unreadable. Null result = nothing to say.
 */
export function describeFnKey(action: number | null): string | null {
  const external = ' External keyboards often have no Fn key.'
  switch (action) {
    case 0:
      return `macOS leaves the Globe key alone.${external}`
    case 1:
      return `macOS switches input source on the Globe key, which will fire with every tap. Set System Settings, Keyboard, "Press Globe key to" to Do Nothing.${external}`
    case 2:
      return `macOS opens Emoji and Symbols on a Globe tap, which will pop up with every double tap. Set System Settings, Keyboard, "Press Globe key to" to Do Nothing.${external}`
    case 3:
      return `macOS starts its own dictation on the Globe key, which collides with this one. Set System Settings, Keyboard, "Press Globe key to" to Do Nothing.${external}`
    default:
      return `If a macOS popup appears when you tap the Globe key, set System Settings, Keyboard, "Press Globe key to" to Do Nothing.${external}`
  }
}

/* ---- mouse button trigger ---- */

/** What to tell people whose mouse buttons do nothing: their mouse software gets there first. */
export const MOUSE_SOFTWARE_NOTE =
  'Mouse software such as Logitech Options+ can remap buttons before macOS sees them. If a button does nothing, set it to its default or generic action there.'

/** The two ways the mouse button can behave, in the words the settings page uses. */
export const MOUSE_MODE_LABELS = {
  click: 'Click to start, click to stop',
  hold: 'Hold to talk'
} as const

export function describeMouseMode(mode: 'click' | 'hold', quickTapsLatch = true): string {
  return mode === 'click'
    ? 'Press the button once to start recording and press it again to stop and insert. Esc or Cancel still cancels. Holding it down does not matter: only the presses count.'
    : `Hold the button while you speak and let go to insert.${quickTapsLatch ? ' Two quick clicks keep recording; one more click finishes.' : ''}`
}

/** A button as people count it (left is 1), with the common names. */
export function describeMouseButton(button: number): string {
  switch (button) {
    case 2:
      return 'Middle button'
    case 3:
      return 'Back button'
    case 4:
      return 'Forward button'
    default:
      return `Button ${button + 1}`
  }
}

/** Plain words for a capture that did not produce a usable button. */
export function describeMouseCaptureFailure(
  failure: string,
  platform: 'darwin' | 'win32' = 'darwin'
): string {
  if (platform === 'win32') {
    // Windows hooks can tell only the middle, back and forward buttons apart.
    if (failure === 'primary-button')
      return 'Left and right click cannot be used, because they are needed for everything else. Press the middle, back or forward button.'
    if (failure === 'input-monitoring-denied') return BARK_COPY.win32.mouseCaptureDenied
  }
  switch (failure) {
    case 'primary-button':
      return 'Left and right click cannot be used, because they are needed for everything else. Press the middle, back, forward or an extra button.'
    case 'timeout':
      return 'No button was pressed. Try again and press the mouse button you want within a few seconds.'
    case 'input-monitoring-denied':
      return 'Allow Input Monitoring for DoodleNote Dev first, then try again.'
    case 'helper-unavailable':
      return `The ${FEATURE_NAME} helper is not available.`
    default:
      return 'Could not read a mouse button. Try again.'
  }
}

/* ---- where the time between Stop and text went ---- */

const ms = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value)} ms`)

/**
 * One readable line for the settings page: each stage of the wait between Stop
 * and the text appearing. Durations only; the input never contains text.
 */
export function describeStopStages(stages: {
  stopToFinalMs: number | null
  engineDrainMs: number | null
  engineFinishMs: number | null
  finalToDeliverMs: number | null
  tidyMs?: number | null
  transformMs?: number | null
  targetWaitMs: number | null
  helperRoundTripMs: number | null
  helper: {
    validateMs: number
    insertMs: number
    confirmMs: number
    settleMs: number
    skippedAx: boolean
  } | null
  stopToDoneMs: number | null
}): string {
  const parts = [
    `speech ${ms(stages.stopToFinalMs)} (queue ${ms(stages.engineDrainMs)}, final flush ${ms(stages.engineFinishMs)})`,
    `hand-off ${ms(stages.finalToDeliverMs)}${stages.tidyMs != null ? ` (model tidy-up ${ms(stages.tidyMs)}` : ''}${stages.transformMs != null ? `${stages.tidyMs != null ? ',' : ' ('} transform ${ms(stages.transformMs)}` : ''}${stages.tidyMs != null || stages.transformMs != null ? ')' : ''}`,
    `target ${ms(stages.targetWaitMs)}`
  ]
  const helper = stages.helper
  parts.push(
    helper
      ? `helper ${ms(stages.helperRoundTripMs)} (check ${ms(helper.validateMs)}, insert ${ms(helper.insertMs)}, confirm ${ms(helper.confirmMs)}, clipboard wait ${ms(helper.settleMs)}${helper.skippedAx ? ', accessibility skipped for this app' : ''})`
      : `helper ${ms(stages.helperRoundTripMs)}`
  )
  return `Stop to done ${ms(stages.stopToDoneMs)}: ${parts.join(' · ')}`
}

/* ---- shortcuts ---- */

/** Accelerators compare case-insensitively; an empty one never collides. */
export function shortcutsCollide(a: string, b: string): boolean {
  return a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase()
}
