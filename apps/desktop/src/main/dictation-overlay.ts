import { BrowserWindow, Menu, nativeTheme, screen, type Display } from 'electron'
import {
  dockedBounds,
  snapEdge,
  soundTones,
  toMenuTemplate,
  type PillEdge,
  type PillMenuCommand,
  type PillMenuItem,
  type Rect,
  type SoundKind
} from '../shared/dictation-pill'
import { overlaySize, type OverlayView } from './dictation-overlay-view'
import { overlayHtml } from './dictation-overlay-page'
import { tagDictationWindow } from './dictation-windows'

export type OverlayAction =
  | 'stop'
  | 'cancel'
  | 'copy'
  | 'dismiss'
  | 'pill'
  | 'menu'
  | 'view'
  | 'undo'
  | 'offer-restore'
  | 'offer-dismiss'
  | 'offer-delete'
  | 'offer-keep'

const DRAG_TICK_MS = 16
/** A drag whose release never arrived (pointer lost) ends by itself. */
const DRAG_MAX_MS = 20_000
const FOLLOW_DISPLAY_MS = 1_000

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * Status overlay and resting pill for dictation. It must never take focus: the
 * field the user is dictating into has to stay the key window, so the panel is
 * non-focusable and shown with showInactive(). The window is cut to the pill's
 * own size, so clicks anywhere else on screen reach the apps underneath. It has
 * no preload and no IPC surface; the main process pushes a view model in and
 * the page navigates to a private scheme that will-navigate intercepts, so the
 * page can never reach keys or settings.
 */
export class DictationOverlay {
  private window: BrowserWindow | null = null
  private loaded = false
  private lastView: OverlayView | null = null
  private lastBounds: Rect | null = null
  /** The icon image the page currently holds, so it is sent once per change. */
  private sentIcon: string | null = null
  /** The display a live session stays on, so it does not hop with the cursor. */
  private pinned: Display | null = null
  private follow: NodeJS.Timeout | null = null
  private drag: {
    cursor: { x: number; y: number }
    origin: { x: number; y: number }
    tick: NodeJS.Timeout
    guard: NodeJS.Timeout
  } | null = null

  constructor(
    private readonly onAction: (action: OverlayAction, gen: number | null) => void,
    /** The pill was dropped near this edge. */
    private readonly onEdge: (edge: PillEdge) => void
  ) {}

  render(view: OverlayView): void {
    this.lastView = view
    if (!view.visible) {
      this.pinned = null
      this.stopFollowing()
      this.hide()
      return
    }
    const window = this.ensureWindow()
    if (!this.drag) this.position(window, view)
    this.push(window, view)
    if (!window.isVisible()) window.showInactive()
    if (view.mode === 'rest') this.startFollowing()
    else this.stopFollowing()
  }

  hide(): void {
    this.endDrag(false)
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
  }

  dispose(): void {
    this.endDrag(false)
    this.stopFollowing()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  /** A short tone, synthesized by the page. A hidden or unloaded window stays silent. */
  playSound(kind: SoundKind): void {
    const window = this.window
    if (!window || window.isDestroyed() || !this.loaded) return
    void window.webContents
      .executeJavaScript(`window.playTones(${JSON.stringify(soundTones(kind))})`)
      .catch(() => {})
  }

  /** Pop the right-click menu at the pointer. The chosen command comes back through onPick. */
  popupMenu(items: PillMenuItem[], onPick: (command: PillMenuCommand) => void): void {
    const window = this.window && !this.window.isDestroyed() ? this.window : undefined
    Menu.buildFromTemplate(toMenuTemplate(items, onPick)).popup(window ? { window } : undefined)
  }

  /* ---- placement ---- */

  private displayFor(view: OverlayView): Display {
    const underCursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    if (view.mode === 'rest') {
      this.pinned = null
      return underCursor
    }
    if (!this.pinned) this.pinned = underCursor
    const id = this.pinned.id
    return screen.getAllDisplays().find((display) => display.id === id) ?? underCursor
  }

  private position(window: BrowserWindow, view: OverlayView): void {
    const bounds = dockedBounds(view.edge, overlaySize(view), this.displayFor(view).workArea)
    if (this.lastBounds && sameRect(this.lastBounds, bounds)) return
    this.lastBounds = bounds
    window.setBounds(bounds)
  }

  /** The resting pill goes to whichever screen the pointer is on. */
  private startFollowing(): void {
    if (this.follow) return
    this.follow = setInterval(() => {
      const window = this.window
      const view = this.lastView
      if (this.drag || !window || window.isDestroyed() || !view || view.mode !== 'rest') return
      this.position(window, view)
    }, FOLLOW_DISPLAY_MS)
    this.follow.unref?.()
  }

  private stopFollowing(): void {
    if (this.follow) clearInterval(this.follow)
    this.follow = null
  }

  /* ---- dragging ---- */

  private beginDrag(): void {
    const window = this.window
    if (this.drag || !window || window.isDestroyed() || this.lastView?.mode !== 'rest') return
    const [x, y] = window.getPosition()
    const cursor = screen.getCursorScreenPoint()
    const tick = setInterval(() => {
      if (!this.drag || !this.window || this.window.isDestroyed()) return
      const now = screen.getCursorScreenPoint()
      const next = {
        x: Math.round(this.drag.origin.x + now.x - this.drag.cursor.x),
        y: Math.round(this.drag.origin.y + now.y - this.drag.cursor.y)
      }
      this.window.setPosition(next.x, next.y)
    }, DRAG_TICK_MS)
    const guard = setTimeout(() => this.endDrag(true), DRAG_MAX_MS)
    tick.unref?.()
    guard.unref?.()
    this.drag = { cursor, origin: { x, y }, tick, guard }
  }

  /** Stop following the pointer; when dropped, dock to the nearest edge of that display. */
  private endDrag(drop: boolean): void {
    const drag = this.drag
    if (!drag) return
    clearInterval(drag.tick)
    clearTimeout(drag.guard)
    this.drag = null
    this.lastBounds = null
    if (!drop) return
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    this.onEdge(snapEdge(point, display.workArea))
    // The edge may be unchanged, in which case no render follows; settle anyway.
    if (this.window && !this.window.isDestroyed() && this.lastView?.visible) {
      this.position(this.window, this.lastView)
    }
  }

  /* ---- window ---- */

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      width: 92,
      height: 40,
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
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // The start and stop tones play without a click in this window.
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    tagDictationWindow(window)
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      const match = /^doodle-dictation:\/\/([a-z-]+)$/.exec(url)
      if (match) this.handle(match[1] as string)
    })
    this.loaded = false
    this.sentIcon = null
    this.lastBounds = null
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

  private handle(name: string): void {
    switch (name) {
      case 'drag-start':
        this.beginDrag()
        break
      case 'drag-end':
        this.endDrag(true)
        break
      case 'stop':
      case 'cancel':
      case 'copy':
      case 'dismiss':
      case 'pill':
      case 'menu':
      case 'view':
      case 'undo':
      case 'offer-restore':
      case 'offer-dismiss':
      case 'offer-delete':
      case 'offer-keep':
        this.onAction(name, this.lastView?.gen ?? null)
        break
    }
  }

  private push(window: BrowserWindow, view: OverlayView): void {
    if (!this.loaded) return
    // The level changes many times a second; the icon image does not. Send the
    // image only when it changes and leave it out of the frames.
    const icon = view.target?.icon ?? null
    const frame = view.target ? { ...view, target: { name: view.target.name, icon: null } } : view
    const script = [
      icon !== this.sentIcon ? `window.setTargetIcon(${JSON.stringify(icon)})` : '',
      `window.render(${JSON.stringify(frame)}, ${nativeTheme.shouldUseDarkColors})`
    ]
      .filter(Boolean)
      .join(';')
    this.sentIcon = icon
    void window.webContents.executeJavaScript(script).catch(() => {})
  }
}
