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

/* ---- right-click menu ---- */

export type PillMenuCommand =
  | { kind: 'hide-hour' }
  | { kind: 'microphone'; uid: string | null }
  | { kind: 'paste-last' }
  | { kind: 'settings' }
  | { kind: 'toggle-always' }

export interface PillMenuItem {
  label?: string
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
    { type: 'separator' },
    { type: 'normal', label: 'Open dictation settings', command: { kind: 'settings' } },
    {
      type: 'checkbox',
      label: 'Keep the pill on screen',
      checked: model.showAlways,
      command: { kind: 'toggle-always' }
    }
  ]
}

/** The shape Electron's Menu.buildFromTemplate accepts, kept free of Electron types. */
export interface MenuTemplateItem {
  label?: string
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

/* ---- shortcuts ---- */

/** Accelerators compare case-insensitively; an empty one never collides. */
export function shortcutsCollide(a: string, b: string): boolean {
  return a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase()
}
