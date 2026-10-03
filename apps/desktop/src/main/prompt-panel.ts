import { readFileSync } from 'node:fs'
import mascotPath from '../renderer/src/assets/mascot-square.png?asset'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { panelBounds, panelDataUrl } from './prompt-panel-content'
import type { CalendarStartMeetingEvent } from '../shared/calendar-api'

/** The panel dismisses itself if the user ignores it this long. */
const PANEL_TTL_MS = 4 * 60_000

/**
 * A small always-on-top "meeting is starting" card for when the main window
 * is closed or buried — the in-app banner can't be seen then, and macOS
 * notifications are best-effort on unsigned builds. Frameless, click-through
 * free, bottom-center of the active display on macOS.
 *
 * Zero-preload design: the page is a data: URL and the buttons navigate to
 * doodle-panel://<action>, which will-navigate intercepts. No IPC surface.
 */
export class PromptPanel {
  private window: BrowserWindow | null = null
  private readonly logoDataUrl = `data:image/png;base64,${readFileSync(mascotPath).toString('base64')}`
  private closeTimer: NodeJS.Timeout | null = null

  ownsWindow(window: BrowserWindow): boolean {
    return this.window === window
  }

  show(prompt: CalendarStartMeetingEvent, onAction: (action: 'start' | 'dismiss') => void): void {
    this.close() // one panel at a time; a newer prompt replaces an older one

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const panel = new BrowserWindow({
      ...panelBounds(display.workArea, process.platform),
      ...(process.platform === 'darwin' ? { type: 'panel' as const, acceptFirstMouse: true } : {}),
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      show: false,
      transparent: true,
      hasShadow: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.window = panel
    panel.setAlwaysOnTop(true, 'floating')
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    let settled = false
    const act = (action: 'start' | 'dismiss'): void => {
      if (settled || this.window !== panel || panel.isDestroyed()) return
      settled = true
      this.close()
      onAction(action)
    }
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url === 'doodle-panel://start') act('start')
      else if (url === 'doodle-panel://dismiss') act('dismiss')
    })
    panel.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        act('dismiss')
      }
    })
    panel.once('ready-to-show', () => {
      // A replaced/expired panel must never reappear or steal focus.
      if (this.window === panel && !panel.isDestroyed()) panel.showInactive()
    })
    void panel
      .loadURL(
        panelDataUrl(prompt, nativeTheme.shouldUseDarkColors, process.platform, this.logoDataUrl)
      )
      .catch(() => {
        if (this.window === panel) this.close()
      })
    panel.on('closed', () => {
      if (this.window === panel) {
        this.window = null
        if (this.closeTimer) clearTimeout(this.closeTimer)
        this.closeTimer = null
      }
    })

    this.closeTimer = setTimeout(() => this.close(), PANEL_TTL_MS)
    this.closeTimer.unref?.()
  }

  close(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
    if (this.window && !this.window.isDestroyed()) this.window.close()
    this.window = null
  }
}
