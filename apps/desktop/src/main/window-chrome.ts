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
