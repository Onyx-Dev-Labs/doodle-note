import { Menu, Tray, nativeImage } from 'electron'
import { recordingTrayTitle } from './recording-indicator-logic'

/**
 * A menu-bar item that exists only while a live capture runs: a red dot and
 * the elapsed time, so "am I being recorded?" is answerable from any window
 * — including none. Separate from the calendar Tray on purpose: that one
 * needs a signed-in calendar, this one must always work.
 *
 * macOS only, like the calendar Tray; other platforms get a no-op.
 */
export class RecordingIndicator {
  private tray: Tray | null = null
  private startedAtMs = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly focusWindow: () => void) {}

  start(): void {
    if (process.platform !== 'darwin' || this.tray !== null) return
    this.startedAtMs = Date.now()
    try {
      this.tray = new Tray(nativeImage.createEmpty())
      this.tray.setToolTip('DoodleNote — recording')
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Recording…', enabled: false },
          { type: 'separator' },
          { label: 'Open DoodleNote', click: () => this.focusWindow() }
        ])
      )
      this.tick()
      this.timer = setInterval(() => this.tick(), 1000)
    } catch (err) {
      // Tray support can be flaky (headless CI) — never let the menu bar
      // break a recording.
      console.error('[recording] tray failed:', err)
      this.stop()
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.tray !== null) {
      try {
        this.tray.destroy()
      } catch {
        // Already gone.
      }
      this.tray = null
    }
  }

  private tick(): void {
    this.tray?.setTitle(recordingTrayTitle(Date.now() - this.startedAtMs), {
      fontType: 'monospacedDigit'
    })
  }
}
