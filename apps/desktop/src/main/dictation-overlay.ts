import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { OverlayView } from './dictation-overlay-view'

export type OverlayAction = 'stop' | 'cancel' | 'copy' | 'dismiss'

const WIDTH = 380
const HEIGHT = 132
const BOTTOM_MARGIN = 28

/**
 * Status overlay for dictation. It must never take focus: the field the user
 * is dictating into has to stay the key window, so the panel is non-focusable
 * and shown with showInactive(). It has no preload and no IPC surface; the
 * main process pushes a view model in and buttons navigate to a private scheme
 * that will-navigate intercepts, so the page can never reach keys or settings.
 */
export class DictationOverlay {
  private window: BrowserWindow | null = null
  private loaded = false
  private lastView: OverlayView | null = null

  constructor(private readonly onAction: (action: OverlayAction, gen: number | null) => void) {}

  render(view: OverlayView): void {
    this.lastView = view
    if (!view.visible) {
      this.hide()
      return
    }
    const window = this.ensureWindow()
    this.position(window)
    this.push(window, view)
    if (!window.isVisible()) window.showInactive()
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
  }

  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      ...(process.platform === 'darwin' ? { type: 'panel' as const, acceptFirstMouse: true } : {}),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      const match = /^doodle-dictation:\/\/(stop|cancel|copy|dismiss)$/.exec(url)
      if (match) this.onAction(match[1] as OverlayAction, this.lastView?.gen ?? null)
    })
    this.loaded = false
    window.webContents.once('did-finish-load', () => {
      this.loaded = true
      if (this.lastView?.visible) this.push(window, this.lastView)
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`)
    this.window = window
    return window
  }

  private push(window: BrowserWindow, view: OverlayView): void {
    if (!this.loaded) return
    void window.webContents
      .executeJavaScript(
        `window.render(${JSON.stringify(view)}, ${nativeTheme.shouldUseDarkColors})`
      )
      .catch(() => {})
  }

  private position(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    window.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height - HEIGHT - BOTTOM_MARGIN),
      width: WIDTH,
      height: HEIGHT
    })
  }
}

function overlayHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root{--bg:rgba(250,248,242,.96);--fg:#25271f;--mute:#6c6f62;--line:rgba(0,0,0,.1);--btn:#e9e6da;--accent:#4f7a4a;--warn:#a8741a;--err:#b3412f}
  .dark{--bg:rgba(36,38,31,.96);--fg:#efede3;--mute:#a4a79a;--line:rgba(255,255,255,.12);--btn:#3a3d33;--accent:#8fbf86;--warn:#e0b45a;--err:#e8806d}
  html,body{margin:0;background:transparent;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--fg);-webkit-user-select:none;user-select:none;overflow:hidden}
  .card{box-sizing:border-box;margin:6px;height:calc(100vh - 12px);padding:12px 14px;border-radius:14px;background:var(--bg);border:1px solid var(--line);box-shadow:0 8px 28px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:6px}
  .row{display:flex;align-items:center;gap:8px;min-height:20px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--mute);flex:none}
  .active .dot{background:var(--accent);animation:pulse 1.1s ease-in-out infinite}
  .busy .dot{background:var(--mute);animation:pulse 1.4s ease-in-out infinite}
  .ok .dot{background:var(--accent)} .warn .dot{background:var(--warn)} .error .dot{background:var(--err)}
  @keyframes pulse{50%{opacity:.35;transform:scale(.8)}}
  .title{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .meter{height:3px;border-radius:2px;background:var(--line);overflow:hidden;flex:none}
  .meter>i{display:block;height:100%;width:0;background:var(--accent);transition:width .08s linear}
  .detail{flex:1;min-height:0;color:var(--mute);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;-webkit-user-select:text;user-select:text;white-space:pre-wrap;word-break:break-word}
  .warn .detail{-webkit-line-clamp:2}
  .btns{display:flex;gap:6px;justify-content:flex-end;flex:none}
  a{font:inherit;font-size:12px;color:var(--fg);background:var(--btn);padding:3px 10px;border-radius:7px;text-decoration:none;cursor:default}
  a.primary{background:var(--accent);color:#fff}
  [hidden]{display:none!important}
</style></head><body>
<div class="card" id="card">
  <div class="row"><span class="dot"></span><span class="title" id="title"></span></div>
  <div class="meter" id="meter" hidden><i id="level"></i></div>
  <div class="detail" id="detail"></div>
  <div class="btns">
    <a id="copy" class="primary" href="doodle-dictation://copy" hidden>Copy text</a>
    <a id="stop" class="primary" href="doodle-dictation://stop" hidden>Stop</a>
    <a id="cancel" href="doodle-dictation://cancel" hidden>Cancel</a>
    <a id="dismiss" href="doodle-dictation://dismiss" hidden>Dismiss</a>
  </div>
</div>
<script>
  const $ = (id) => document.getElementById(id)
  window.render = (view, dark) => {
    document.documentElement.className = dark ? 'dark' : ''
    $('card').className = 'card ' + view.tone
    $('title').textContent = view.title
    $('detail').textContent = view.detail
    $('detail').hidden = !view.detail
    $('meter').hidden = view.level === null
    if (view.level !== null) $('level').style.width = Math.round(Math.min(1, view.level) * 100) + '%'
    for (const name of ['stop','cancel','copy','dismiss']) $(name).hidden = !view.controls[name]
  }
</script></body></html>`
}
