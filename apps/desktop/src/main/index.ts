import { app, shell, BrowserWindow, ipcMain, nativeTheme, protocol } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, statSync, writeFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { CalendarService } from './calendar-service'
import { registerContextMenu } from './context-menu'
import { EngineProcess } from './engine-process'
import { FoldersService } from './folders-service'
import { MediaService } from './media-service'
import { MeetingsService } from './meetings-service'
import { MicWatcher } from './mic-watcher'
import { NotesService } from './notes-service'
import { PromptPanel } from './prompt-panel'
import { SyncService } from './sync-service'
import {
  DETECT_GET_STATE_CHANNEL,
  DETECT_MEETING_ENDED_CHANNEL,
  DETECT_SET_PREFS_CHANNEL,
  type DetectPrefsUpdate,
  type DetectState
} from '../shared/detect-api'
import { THEME_SET_SOURCE_CHANNEL } from '../shared/theme-api'
import { TranscriptSession } from './transcript-session'
import {
  ENGINE_EVENT_CHANNEL,
  ENGINE_START_CHANNEL,
  ENGINE_STOP_CHANNEL,
  type EngineEvent,
  type EngineStartRequest
} from '../shared/engine-events'

/**
 * The Swift transcription sidecar: bundled under Resources/engine in the
 * packaged app; two levels up from apps/desktop in dev.
 */
function resolveEngineBinary(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'engine', 'engine')
  }
  return path.resolve(app.getAppPath(), '..', '..', 'engine', '.build', 'release', 'engine')
}

/**
 * One-time migration: dev runs stored everything under the app name
 * "desktop" (~/Library/Application Support/desktop). The packaged app is
 * "DoodleNote" — adopt the dev data (meetings, folders, settings, chat,
 * downloaded models) on first launch so nothing is lost or re-downloaded.
 */
function migrateDevUserData(): void {
  if (!app.isPackaged) return
  try {
    const newDir = app.getPath('userData')
    const oldDir = join(newDir, '..', 'desktop')
    if (existsSync(join(newDir, 'meetings')) || !existsSync(join(oldDir, 'meetings'))) return
    console.log('[migrate] adopting dev data from', oldDir)
    cpSync(join(oldDir, 'meetings'), join(newDir, 'meetings'), { recursive: true })
    for (const name of ['folders.json', 'settings.json', 'global-chat.json']) {
      if (existsSync(join(oldDir, name))) cpSync(join(oldDir, name), join(newDir, name))
    }
    if (existsSync(join(oldDir, 'models'))) {
      cpSync(join(oldDir, 'models'), join(newDir, 'models'), { recursive: true })
    }
  } catch (err) {
    console.error('[migrate] failed (continuing with fresh data):', err)
  }
}

// Must run before app ready: lets <img src="doodle-media://…"> load without
// mixed-content blocking (the dev renderer is served over http).
protocol.registerSchemesAsPrivileged([
  { scheme: 'doodle-media', privileges: { secure: true, supportFetchAPI: true } }
])

const engine = new EngineProcess(resolveEngineBinary())
let notesService: NotesService | null = null
let calendarService: CalendarService | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function broadcastEngineEvent(event: EngineEvent): void {
  broadcast(ENGINE_EVENT_CHANNEL, event)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    // Matches the active palette so launch never flashes the wrong color.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1f19' : '#f7f5ee',
    show: false,
    autoHideMenuBar: true,
    // Mac-native feel: content extends under a hidden title bar; the renderer
    // provides a drag strip and keeps clear of the traffic lights.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Spell-check suggestions + edit ops on right-click (Electron has none).
  registerContextMenu(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In-page link clicks (e.g. the transcript footer in generated notes) go
  // to the system browser — the app itself never navigates away.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^https?:/i.test(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  migrateDevUserData()

  // Warm the engine once per launch: triggers the permission prompts up front
  // and primes the ASR model cache, so "+ New meeting" starts instantly.
  try {
    const preflight = spawn(resolveEngineBinary(), ['preflight'], {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    preflight.stderr?.setEncoding('utf8')
    preflight.stderr?.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (line.length > 0) console.error(`[engine preflight] ${line}`)
    })
    preflight.on('error', (err) => console.error('[engine preflight] spawn failed:', err.message))
    // Persistent engine: models load once here, so hitting record is instant.
    // Started after preflight so the two don't race the model download.
    let serveStarted = false
    const startServeOnce = (): void => {
      if (serveStarted) return
      serveStarted = true
      engine.startServe()
    }
    preflight.on('exit', startServeOnce)
    setTimeout(startServeOnce, 120_000).unref()
  } catch (err) {
    console.error('[engine preflight] failed:', err)
    engine.startServe()
  }

  electronApp.setAppUserModelId('com.doodlenote.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Ad-hoc meeting detection: engine micmon watches for other apps holding
  // the mic open (Zoom/Teams/Meet) and prompts even without a calendar event.
  const micWatcher = new MicWatcher(
    resolveEngineBinary(),
    app.getPath('userData'),
    (appLabel) => {
      calendarService?.deliverPrompt({
        action: 'prompt',
        eventId: '',
        // Pre-title from the detected app ("Zoom meeting"); generic otherwise.
        subject: appLabel && appLabel !== 'browser' ? `${appLabel} meeting` : 'Meeting',
        startIso: new Date().toISOString(),
        adHoc: true
      })
    },
    () => {
      // Meeting app hung up mid-recording — the editor stops its capture.
      broadcast(DETECT_MEETING_ENDED_CHANNEL, {})
    }
  )

  const session = new TranscriptSession(
    broadcastEngineEvent,
    join(app.getPath('userData'), 'sessions')
  )

  // Persistent event log: every engine event, timestamped, so failed sessions
  // can be diagnosed from disk instead of reproduced. Token arrays collapse to
  // a count to keep lines small; rotated when it grows past ~5MB.
  const engineLogPath = join(app.getPath('userData'), 'engine-events.log')
  try {
    if (existsSync(engineLogPath) && statSync(engineLogPath).size > 5 * 1024 * 1024) {
      writeFileSync(engineLogPath, '')
    }
  } catch {
    // Log rotation is best-effort.
  }
  const logEngineEvent = (event: EngineEvent): void => {
    try {
      const compact = JSON.stringify(event, (key, value) =>
        key === 'tokens' && Array.isArray(value) ? `[${value.length} tokens]` : value
      )
      appendFileSync(engineLogPath, `${new Date().toISOString()} ${compact}\n`)
    } catch {
      // Never let logging interfere with the session.
    }
  }

  engine.onEvent((event) => {
    broadcastEngineEvent(event)
    session.handle(event)
    logEngineEvent(event)
  })

  ipcMain.on(ENGINE_START_CHANNEL, (_event, request: EngineStartRequest) => {
    // Our own capture holds the mic — the ad-hoc meeting detector must not
    // mistake it for a Zoom call. Suppress BEFORE the engine opens the mic.
    micWatcher.setSuppressed(true)
    engine.start(request.command, request.filePath, request.opts)
  })

  ipcMain.on(ENGINE_STOP_CHANNEL, () => {
    engine.stop()
    micWatcher.setSuppressed(false)
  })

  // Meetings store first: NotesService reads it to gather cross-meeting
  // context for the Home-level "ask anything".
  const meetingsService = new MeetingsService(join(app.getPath('userData'), 'meetings'))
  meetingsService.registerIpc()

  notesService = new NotesService(app.getPath('userData'), broadcast, meetingsService)
  notesService.registerIpc()

  const foldersService = new FoldersService(
    join(app.getPath('userData'), 'folders.json'),
    meetingsService
  )
  foldersService.registerIpc()

  // Microsoft 365 calendar: auth + Graph polling + the meeting-start watcher.
  // The floating panel catches prompts when the main window can't be seen.
  calendarService = new CalendarService(
    app.getPath('userData'),
    broadcast,
    focusMainWindow,
    new PromptPanel()
  )
  calendarService.registerIpc()

  // Meeting-detection settings: login item (OS-owned) + the mic watcher.
  const detectState = (): DetectState => ({
    loginItem: app.getLoginItemSettings().openAtLogin,
    micDetect: micWatcher.enabled,
    autoStop: micWatcher.autoStop,
    micMonitorAlive: micWatcher.monitorAlive
  })
  ipcMain.handle(DETECT_GET_STATE_CHANNEL, (): DetectState => detectState())
  ipcMain.handle(DETECT_SET_PREFS_CHANNEL, (_event, update: DetectPrefsUpdate): DetectState => {
    if (typeof update?.loginItem === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: update.loginItem })
    }
    if (typeof update?.micDetect === 'boolean') {
      micWatcher.setEnabled(update.micDetect)
    }
    if (typeof update?.autoStop === 'boolean') {
      micWatcher.setAutoStop(update.autoStop)
    }
    return detectState()
  })
  micWatcher.start()

  // node-llama-cpp's async workers SIGABRT if they complete during Electron's
  // teardown (ThrowAsJavaScriptException on a dead env → ggml terminate) —
  // macOS then shows "DoodleNote quit unexpectedly" on the next launch. All
  // app state is written synchronously as it changes, and child processes
  // (transcription engine, micmon) exit on their own via stdin-close
  // watchdogs, so skipping native teardown loses nothing.
  app.on('before-quit', () => {
    micWatcher.stop()
    process.exit(0)
  })

  // The renderer mirrors its theme pref here so nativeTheme (and with it the
  // floating prompt panel + native chrome) matches the in-app appearance.
  ipcMain.on(THEME_SET_SOURCE_CHANNEL, (_event, source: unknown) => {
    nativeTheme.themeSource = source === 'light' || source === 'dark' ? source : 'system'
  })

  // Cloud sync: opt-in one-way push of meetings/notes to the web dashboard.
  const syncService = new SyncService(app.getPath('userData'), meetingsService, broadcast)
  syncService.registerIpc()
  meetingsService.onDidWrite = (change) => syncService.onMeetingsChanged(change.deletedId)

  // Image attachments for the notes editor (doodle-media:// protocol).
  const mediaService = new MediaService(join(app.getPath('userData'), 'attachments'))
  mediaService.registerIpc()
  mediaService.registerProtocol()

  // A fresh look at the app deserves fresh events (throttled inside).
  app.on('browser-window-focus', () => calendarService?.onWindowFocus())

  createWindow()

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked
    // and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** Bring the app forward for a notification click, recreating the window if
 *  the user closed it (macOS keeps the app alive without windows). */
function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } else {
    createWindow()
  }
}

// Make sure the sidecar never outlives the app.
app.on('will-quit', () => {
  engine.dispose()
  void notesService?.dispose()
  calendarService?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
