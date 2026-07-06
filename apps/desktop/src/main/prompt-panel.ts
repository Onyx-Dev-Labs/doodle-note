import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { CalendarStartMeetingEvent } from '../shared/calendar-api'

/** The panel dismisses itself if the user ignores it this long. */
const PANEL_TTL_MS = 4 * 60_000

const PANEL_WIDTH = 340
const PANEL_HEIGHT = 108

/**
 * A small always-on-top "meeting is starting" card for when the main window
 * is closed or buried — the in-app banner can't be seen then, and macOS
 * notifications are best-effort on unsigned builds. Frameless, click-through
 * free, top-right of the active display.
 *
 * Zero-preload design: the page is a data: URL and the buttons navigate to
 * doodle-panel://<action>, which will-navigate intercepts. No IPC surface.
 */
export class PromptPanel {
  private window: BrowserWindow | null = null
  private closeTimer: NodeJS.Timeout | null = null

  show(prompt: CalendarStartMeetingEvent, onAction: (action: 'start' | 'dismiss') => void): void {
    this.close() // one panel at a time; a newer prompt replaces an older one

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { x, y, width } = display.workArea
    const panel = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      x: x + width - PANEL_WIDTH - 16,
      y: y + 16,
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
      hasShadow: true
    })
    this.window = panel
    panel.setAlwaysOnTop(true, 'floating')
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    panel.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url.startsWith('doodle-panel://start')) {
        this.close()
        onAction('start')
      } else if (url.startsWith('doodle-panel://dismiss')) {
        this.close()
        onAction('dismiss')
      }
    })

    void panel.loadURL(panelDataUrl(prompt))
    panel.once('ready-to-show', () => {
      // Never steal focus — the user may be mid-sentence in another app.
      panel.showInactive()
    })
    panel.on('closed', () => {
      if (this.window === panel) this.window = null
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function panelDataUrl(prompt: CalendarStartMeetingEvent): string {
  const heading = prompt.adHoc
    ? 'Looks like you’re in a meeting'
    : `${escapeHtml(prompt.subject)} is starting`
  const sub = prompt.adHoc
    ? 'Your microphone is live — want notes?'
    : 'Want DoodleNote to take notes?'
  // Follows nativeTheme, which the renderer keeps in sync with the in-app pref.
  const dark = nativeTheme.shouldUseDarkColors
  const c = dark
    ? { card: '#262922', border: '#3a3e33', ink: '#f0eee2', muted: '#93967f', go: '#8fb07a', goHover: '#aac996', goText: '#1d1f19' }
    : { card: '#fdfcf8', border: '#e7e3d8', ink: '#26281f', muted: '#8a8d7f', go: '#7c9769', goHover: '#5f7a4e', goText: '#fff' }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; -webkit-user-select: none; cursor: default; }
  body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; background: transparent; padding: 2px; }
  .card { background: ${c.card}; border: 1px solid ${c.border}; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,${dark ? '.5' : '.22'}); padding: 12px 14px; height: ${PANEL_HEIGHT - 4}px;
    display: flex; flex-direction: column; gap: 9px; -webkit-app-region: drag; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h1 { font-size: 13.5px; font-weight: 600; color: ${c.ink}; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  p { color: ${c.muted}; font-size: 12px; }
  .row { display: flex; gap: 8px; -webkit-app-region: no-drag; }
  a { text-decoration: none; border-radius: 8px; padding: 6px 12px; font-size: 12.5px; font-weight: 600; }
  .go { background: ${c.go}; color: ${c.goText}; flex: 1; text-align: center; }
  .go:hover { background: ${c.goHover}; }
  .no { color: ${c.muted}; padding: 6px 8px; }
  .no:hover { color: ${c.ink}; }
  </style></head><body><div class="card">
  <div class="head"><h1>${heading}</h1></div>
  <p>${sub}</p>
  <div class="row">
    <a class="go" href="doodle-panel://start">✎ Take notes</a>
    <a class="no" href="doodle-panel://dismiss">Dismiss</a>
  </div>
  </div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
