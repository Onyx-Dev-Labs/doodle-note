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

export type OverlayAction =
  'stop' | 'cancel' | 'copy' | 'dismiss' | 'pill' | 'menu' | 'view' | 'undo'

const DRAG_TICK_MS = 16
/** A drag whose release never arrived (pointer lost) ends by itself. */
const DRAG_MAX_MS = 20_000
const FOLLOW_DISPLAY_MS = 150

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
  /** Fence late clicks, copy replies and countdowns to the card that created them. */
  private messageId = 0
  private messageKey = ''
  private measuredMessageHeight: number | null = null
  /** The icon image the page currently holds, so it is sent once per change. */
  private sentIcon: string | null = null
  /** Message controls stay on their opening display while the pointer moves away. */
  private pinned: Display | null = null
  private follow: NodeJS.Timeout | null = null
  private drag: {
    cursor: { x: number; y: number }
    origin: { x: number; y: number }
    tick: NodeJS.Timeout
    guard: NodeJS.Timeout
  } | null = null

  constructor(
    private readonly onAction: (
      action: OverlayAction,
      gen: number | null
    ) => void | boolean | Promise<boolean>,
    /** The pill was dropped near this edge. */
    private readonly onEdge: (edge: PillEdge) => void
  ) {}

  render(view: OverlayView): void {
    const key = JSON.stringify([
      view.visible,
      view.mode,
      view.gen,
      view.title,
      view.detail,
      view.tone,
      view.controls,
      view.diff
    ])
    if (key !== this.messageKey) {
      this.messageKey = key
      this.messageId += 1
      this.measuredMessageHeight = null
    }
    this.lastView = view
    if (!view.visible) {
      this.pinned = null
      this.stopFollowing()
      if (this.window && !this.window.isDestroyed()) this.push(this.window, view)
      this.hide()
      return
    }
    const window = this.ensureWindow()
    if (!this.drag) this.position(window, view)
    this.push(window, view)
    if (!window.isVisible()) window.showInactive()
    if (view.mode !== 'message') this.startFollowing()
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
    if (view.mode !== 'message') {
      this.pinned = null
      return underCursor
    }
    if (!this.pinned) this.pinned = underCursor
    const id = this.pinned.id
    return screen.getAllDisplays().find((display) => display.id === id) ?? underCursor
  }

  private position(window: BrowserWindow, view: OverlayView): void {
    const bounds = dockedBounds(
      view.edge,
      overlaySize(view, this.measuredMessageHeight),
      this.displayFor(view).workArea
    )
    if (this.lastBounds && sameRect(this.lastBounds, bounds)) return
    this.lastBounds = bounds
    window.setBounds(bounds)
  }

  /** Resting and live pills follow the pointer's monitor, including quiet/busy sessions. */
  private startFollowing(): void {
    if (this.follow) return
    this.follow = setInterval(() => {
      const window = this.window
      const view = this.lastView
      if (this.drag || !window || window.isDestroyed() || !view?.visible || view.mode === 'message')
        return
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
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      const match = /^doodle-dictation:\/\/([a-z-]+)(?:\?message=(\d+))?$/.exec(url)
      if (match) this.handle(match[1] as string, match[2] ? Number(match[2]) : null)
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

  private handle(name: string, messageId: number | null): void {
    if (
      messageId !== null &&
      (messageId !== this.messageId || !this.lastView?.visible || this.lastView.mode !== 'message')
    )
      return
    // Message actions must carry a card identity; a stale page cannot dismiss a new card.
    if (['copy', 'dismiss', 'view', 'undo'].includes(name) && messageId === null) return
    switch (name) {
      case 'drag-start':
        this.beginDrag()
        break
      case 'drag-end':
        this.endDrag(true)
        break
      case 'copy': {
        const id = this.messageId
        const gen = this.lastView?.gen ?? null
        if (!this.lastView?.controls.copy) break
        void Promise.resolve()
          .then(() => this.onAction('copy', gen))
          .then((copied) => {
            if (id !== this.messageId || !this.window || this.window.isDestroyed() || !this.loaded)
              return
            return this.window.webContents.executeJavaScript(
              `window.copyResult(${id}, ${copied === true})`
            )
          })
          .catch(() => {
            if (id === this.messageId && this.window && !this.window.isDestroyed() && this.loaded)
              void this.window.webContents
                .executeJavaScript(`window.copyResult(${id}, false)`)
                .catch(() => {})
          })
        break
      }
      case 'stop':
      case 'cancel':
      case 'dismiss':
      case 'pill':
      case 'menu':
      case 'view':
      case 'undo':
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
      `window.render(${JSON.stringify({ ...frame, messageId: this.messageId })}, ${nativeTheme.shouldUseDarkColors})`
    ]
      .filter(Boolean)
      .join(';')
    this.sentIcon = icon
    const id = this.messageId
    void window.webContents
      .executeJavaScript(script)
      .then((height: unknown) => {
        if (
          typeof height !== 'number' ||
          !Number.isFinite(height) ||
          id !== this.messageId ||
          window !== this.window ||
          window.isDestroyed() ||
          !this.lastView?.visible ||
          this.lastView.mode !== 'message' ||
          this.lastView.diff
        )
          return
        this.measuredMessageHeight = height
        this.position(window, this.lastView)
      })
      .catch(() => {})
  }
}
