/**
 * Pure formatting for the menu-bar recording indicator — kept Electron-free
 * so it unit-tests under node like calendar-events.ts.
 */

/** Elapsed recording time as the menu bar shows it: "0:07", "12:34", "1:02:05". */
export function recordingElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mmss = `${minutes}:${String(seconds).padStart(2, '0')}`
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : mmss
}

/** The full tray title: a red dot that stays red in any menu-bar theme. */
export function recordingTrayTitle(elapsedMs: number): string {
  return `🔴 ${recordingElapsed(elapsedMs)}`
}
