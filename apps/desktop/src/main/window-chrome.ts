/**
 * Per-platform main-window chrome. Pure decisions (no Electron runtime) so the
 * macOS branch can be pinned by tests while Windows gets native-looking chrome.
 *
 * macOS: content extends under a hidden title bar; the renderer provides a drag
 * strip and keeps clear of the inset traffic lights.
 * Windows: the title bar is hidden and Windows draws its own caption buttons
 * (minimize / maximize / close) in a Window Controls Overlay at the top right,
 * colored to match the app theme. The renderer keeps clear of the overlay with
 * the titlebar-area CSS environment variables.
 */

/** Height of the Windows caption-button overlay, in CSS pixels. */
export const WINDOWS_TITLE_BAR_HEIGHT = 40

export interface TitleBarOverlayColors {
  color: string
  symbolColor: string
  height: number
}

/**
 * Transparent caption buttons sit directly on whichever page is showing (Home,
 * notes and Settings use slightly different papers); Windows still draws its
 * hover and pressed states, red for Close. The glyphs follow the app theme.
 */
export function titleBarOverlayFor(dark: boolean): TitleBarOverlayColors {
  return {
    color: '#00000000',
    symbolColor: dark ? '#f0eee2' : '#26281f',
    height: WINDOWS_TITLE_BAR_HEIGHT
  }
}

export type WindowChromeOptions =
  | {
      titleBarStyle: 'hiddenInset'
      trafficLightPosition: { x: number; y: number }
    }
  | {
      titleBarStyle: 'hidden'
      titleBarOverlay: TitleBarOverlayColors
    }

export function windowChromeOptions(platform: NodeJS.Platform, dark: boolean): WindowChromeOptions {
  if (platform === 'win32') {
    return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlayFor(dark) }
  }
  // macOS (and the unchanged Linux development fallback).
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } }
}

/** Only Windows draws themed caption buttons that must follow the app theme. */
export function hasThemedTitleBarOverlay(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

/**
 * Closing the window while a recording runs keeps the renderer (which owns
 * the capture on Windows and the document on both) alive: the window hides
 * and the tray icon remains the way back. Other platforms close as before.
 */
export function hidesToTrayOnClose(
  platform: NodeJS.Platform,
  recordingBusy: boolean,
  quitting: boolean
): boolean {
  return (platform === 'darwin' || platform === 'win32') && recordingBusy && !quitting
}

/**
 * Windows: the window was closed during a recording and stayed hidden. Once
 * that recording is over, finish the close the person asked for and quit,
 * as closing always did on Windows, unless they reopened the window meanwhile.
 */
export function quitsAfterBackgroundRecording(
  platform: NodeJS.Platform,
  closedWhileRecording: boolean,
  phase: 'idle' | 'requested' | 'starting' | 'recording' | 'finishing'
): boolean {
  return platform === 'win32' && closedWhileRecording && phase === 'idle'
}

/** Windows ends a shutdown/log-off session quickly; finish the recording within this. */
export const SESSION_END_FINISH_TIMEOUT_MS = 4_000

/** If no shutdown follows query-session-end within this, the person cancelled it. */
export const SESSION_END_CANCEL_RESET_MS = 30_000

/**
 * Windows: after a recording that outlived its window ends, automatic notes
 * (on by default) run in the hidden renderer and then save. The deferred quit
 * waits for that work, bounded:
 * - startGraceMs: time for automatic notes to start after the recording ends
 *   (the renderer reads settings and saves rough notes first);
 * - quietMs: no notes progress and no library write for this long;
 * - maxWaitMs: quit after this long unless notes are still making progress
 *   (a long local CPU/GPU run on a long meeting reports progress every second);
 * - notesMaxWaitMs: absolute limit, for a job that never stops reporting.
 */
export const BACKGROUND_FINISH_LIMITS = {
  startGraceMs: 15_000,
  quietMs: 5_000,
  maxWaitMs: 5 * 60_000,
  notesMaxWaitMs: 30 * 60_000
} as const

export function backgroundQuitDue(
  now: number,
  activity: { endedAt: number; lastNotesActivityAt: number; lastLibraryWriteAt: number },
  limits: {
    startGraceMs: number
    quietMs: number
    maxWaitMs: number
    notesMaxWaitMs: number
  } = BACKGROUND_FINISH_LIMITS
): boolean {
  const waited = now - activity.endedAt
  if (waited >= limits.notesMaxWaitMs) return true
  const notesProgressing =
    activity.lastNotesActivityAt >= activity.endedAt &&
    now - activity.lastNotesActivityAt < limits.quietMs
  if (notesProgressing) return false
  if (waited >= limits.maxWaitMs) return true
  const latest = Math.max(
    activity.endedAt,
    activity.lastNotesActivityAt,
    activity.lastLibraryWriteAt
  )
  if (now - latest < limits.quietMs) return false
  const notesStarted = activity.lastNotesActivityAt >= activity.endedAt
  return notesStarted || now - activity.endedAt >= limits.startGraceMs
}

/**
 * Bark keeps two windows alive for the app's lifetime on Windows: the dictation pill
 * overlay (a `data:` page) and the hidden microphone-capture window
 * (`dictation-capture.html`). They must not keep the app running once the main window
 * is gone, or closing the window would no longer quit. True when every still-open
 * window is one of these utility windows, so the app can quit.
 */
export function onlyDictationWindowsRemain(remainingWindowUrls: readonly string[]): boolean {
  if (remainingWindowUrls.length === 0) return true
  return remainingWindowUrls.every(
    (url) => url.startsWith('data:text/html') || url.includes('dictation-capture.html')
  )
}
