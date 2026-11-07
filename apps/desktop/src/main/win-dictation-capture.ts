import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import {
  DICTATION_CAPTURE_CONTROL_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL,
  DICTATION_CAPTURE_READY_CHANNEL,
  DICTATION_CAPTURE_TEST_HOOKS_ARG
} from '../shared/dictation-capture-api'
import type {
  EngineCaptureControl,
  EngineCaptureStatus,
  EngineInputDevice
} from '../shared/engine-events'

/** A device list that does not come back in this long is reported as empty. */
const DEVICE_LIST_TIMEOUT_MS = 1_500

export interface WinDictationCaptureOptions {
  preload: string
  /** Loads the capture page into the window (dev server URL or the built file). */
  load: (window: BrowserWindow) => Promise<void>
  /** Unpackaged test runs only: the page may play a fixture instead of the microphone. */
  testHooks: boolean
  /** The page went away mid-session: tell the engine host its capture failed. */
  onCaptureLost: (status: EngineCaptureStatus) => void
}

/**
 * Windows: the hidden window Bark records the microphone in. Created on the first
 * dictation and kept (it holds no microphone between sessions), so a start never
 * waits for a page load twice. It cannot take focus and never appears on screen or
 * in the taskbar; meetings keep capturing in the main window, untouched.
 */
export class WinDictationCapture {
  private window: BrowserWindow | null = null
  private loaded = false
  private waiting: Array<() => void> = []
  private readonly requests = new Map<string, (devices: EngineInputDevice[]) => void>()
  private activeSession: number | null = null
  private disposed = false

  private readonly onReady = (event: IpcMainEvent): void => {
    if (event.sender !== this.window?.webContents) return
    this.loaded = true
    const waiting = this.waiting
    this.waiting = []
    for (const run of waiting) run()
  }

  private readonly onDevices = (event: IpcMainEvent, payload: unknown): void => {
    if (event.sender !== this.window?.webContents) return
    const value = (payload ?? {}) as { requestId?: unknown; devices?: unknown }
    if (typeof value.requestId !== 'string') return
    const resolve = this.requests.get(value.requestId)
    if (!resolve) return
    this.requests.delete(value.requestId)
    resolve(Array.isArray(value.devices) ? (value.devices as EngineInputDevice[]) : [])
  }

  constructor(private readonly options: WinDictationCaptureOptions) {
    ipcMain.on(DICTATION_CAPTURE_READY_CHANNEL, this.onReady)
    ipcMain.on(DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL, this.onDevices)
  }

  /** The engine host's capture control for a dictation session. */
  control(control: EngineCaptureControl): void {
    if (this.disposed) return
    if (control.action === 'start') this.activeSession = control.sessionId
    else if (control.action === 'stop' && this.activeSession === control.sessionId)
      this.activeSession = null
    this.whenLoaded(() => this.window?.webContents.send(DICTATION_CAPTURE_CONTROL_CHANNEL, control))
  }

  /** Microphones as the capture page sees them (the ids it records with). */
  listInputDevices(): Promise<EngineInputDevice[]> {
    if (this.disposed) return Promise.resolve([])
    return new Promise((resolve) => {
      const requestId = randomUUID()
      const timer = setTimeout(() => {
        this.requests.delete(requestId)
        resolve([])
      }, DEVICE_LIST_TIMEOUT_MS)
      timer.unref?.()
      this.requests.set(requestId, (devices) => {
        clearTimeout(timer)
        resolve(devices)
      })
      this.whenLoaded(() =>
        this.window?.webContents.send(DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL, { requestId })
      )
    })
  }

  dispose(): void {
    this.disposed = true
    ipcMain.removeListener(DICTATION_CAPTURE_READY_CHANNEL, this.onReady)
    ipcMain.removeListener(DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL, this.onDevices)
    for (const resolve of this.requests.values()) resolve([])
    this.requests.clear()
    this.waiting = []
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private whenLoaded(run: () => void): void {
    this.ensureWindow()
    if (this.loaded) run()
    else this.waiting.push(run)
  }

  private ensureWindow(): void {
    if (this.window && !this.window.isDestroyed()) return
    this.loaded = false
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      focusable: false,
      frame: false,
      webPreferences: {
        preload: this.options.preload,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        // Capture must keep running while every window is hidden or minimized.
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        additionalArguments: this.options.testHooks ? [DICTATION_CAPTURE_TEST_HOOKS_ARG] : []
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    const lost = (): void => {
      if (this.window !== window) return
      this.window = null
      this.loaded = false
      const session = this.activeSession
      this.activeSession = null
      if (session !== null && !this.disposed) {
        this.options.onCaptureLost({
          type: 'error',
          sessionId: session,
          message: 'The dictation microphone stopped unexpectedly.'
        })
      }
    }
    window.webContents.on('render-process-gone', () => {
      lost()
      if (!window.isDestroyed()) window.destroy()
    })
    window.on('closed', lost)
    this.window = window
    void this.options.load(window).catch((error: unknown) => {
      console.error('[bark] capture page failed to load:', error)
      lost()
    })
  }
}
