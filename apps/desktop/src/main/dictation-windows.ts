import type { BrowserWindow } from 'electron'

/**
 * Bark's own windows on Windows — the pill overlay and the hidden microphone-capture
 * window — must not keep the app alive once the main window is gone, or closing the
 * window would no longer quit. They are tagged here explicitly (not matched by URL, which
 * is empty before a page loads), so the quit check can exclude them reliably.
 */
const tagged = new WeakSet<BrowserWindow>()

export function tagDictationWindow(window: BrowserWindow): void {
  tagged.add(window)
}

export function isDictationWindow(window: BrowserWindow): boolean {
  return tagged.has(window)
}

/** True when every still-open window besides the main one is a tagged dictation window. */
export function onlyDictationWindowsRemain(
  windows: readonly BrowserWindow[],
  mainWindow: BrowserWindow | null
): boolean {
  return windows.every((window) => window === mainWindow || isDictationWindow(window))
}
