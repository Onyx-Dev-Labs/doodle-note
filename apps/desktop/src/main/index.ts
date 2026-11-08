import { createBeforeQuitHandler, finishRecordingBeforeQuit } from './engine-quit'
import { APP_CHANNEL } from '../shared/app-channel'
import { APP_IDENTITY, identityMismatch } from './app-identity'
import { planProfile } from './profile-identity'
import { createDictationHost } from './dictation-host'
import { WinDictationCapture } from './win-dictation-capture'
import { onlyDictationWindowsRemain } from './dictation-windows'
import { windowsInputStateUid, winDictationEngine } from './win-dictation-engine'
import type { DictationService } from './dictation-service'
import { SourceIndexService } from './source-index-service'
import { RecipeRunner } from './recipe-runner'
import { registerRecipes } from './recipe-service'
import { beginRecordableMeeting } from './capture-eligibility'
import { transcribeWithWhisper } from './whisper-transcriber'
import { transcribeFileToSegments } from './import-logic'
import { persistCaptureTranscript } from './capture-transcript-checkpoint'
import { captureEventForSession } from './capture-event'
import { libraryActivity } from './library-activity'
import {
  app,
  dialog,
  shell,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeTheme,
  Notification,
  protocol,
  screen,
  session as electronSession
} from 'electron'
import { RecordingStartCoordinator } from './recording-start-coordinator'
import { RecordingTray } from './recording-tray'
import {
  RECORDING_JOIN_RETRY_CHANNEL,
  RECORDING_JOIN_DISMISS_CHANNEL,
  RECORDING_REQUEST_CHANNEL,
  RECORDING_READY_CHANNEL,
  RECORDING_DELIVER_CHANNEL,
  RECORDING_ATTACH_CHANNEL,
  RECORDING_CANCEL_CHANNEL,
  RECORDING_STATE_CHANNEL,
  type RecordingStartRequest
} from '../shared/recording-api'
import type { CalendarStartMeetingEvent } from '../shared/calendar-api'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { prepareLibrary, registerStorageIpc } from './storage-service'
import { AudioService } from './audio-service'
import { ImportService } from './import-service'
import { TextImportService } from './text-import-service'
import { WizardService } from './wizard-service'
import { ExportService } from './export-service'
import { CalendarService } from './calendar-service'
import { registerContextMenu } from './context-menu'
import { EngineProcess } from './engine-process'
import { WinEngineHost } from './engine-host-win'
import { WinBatchTranscriber } from './win-batch-transcriber'
import { FoldersService } from './folders-service'
import { initAutoUpdater, isQuittingForUpdate } from './updater'
import { isInsideFolder, runWindowsInstallMigration } from './windows-install-migration'
import { clearInstallRecord, installStateKey, readInstallRecord } from './windows-install-record'
import { MediaService } from './media-service'
import { AgentAccessService } from './agent-access-service'
import type { McpServerSpec } from '../shared/integrations-api'
import { MeetingsService } from './meetings-service'
import { MicWatcher } from './mic-watcher'
import { NotesService } from './notes-service'
import { PromptPanel } from './prompt-panel'
import { SyncService } from './sync-service'
import { fitIntoWorkArea, MAIN_WINDOW_SIZE, mainWindowBoundsFor } from './window-sizing'
import {
  SESSION_END_CANCEL_RESET_MS,
  SESSION_END_FINISH_TIMEOUT_MS,
  backgroundQuitDue,
  hasThemedTitleBarOverlay,
  hidesToTrayOnClose,
  quitsAfterBackgroundRecording,
  titleBarOverlayFor,
  windowChromeOptions
} from './window-chrome'
import { supportsLibraryLocation } from '../shared/storage-api'
import {
  DETECT_GET_STATE_CHANNEL,
  DETECT_MEETING_ENDED_CHANNEL,
  DETECT_SET_PREFS_CHANNEL,
  type DetectPrefsUpdate,
  type DetectState
} from '../shared/detect-api'
import { THEME_SET_SOURCE_CHANNEL } from '../shared/theme-api'
import { NOTES_ENHANCE_PROGRESS_CHANNEL, NOTES_ENHANCE_TOKEN_CHANNEL } from '../shared/notes-api'
import { TranscriptSession } from './transcript-session'
import {
  ENGINE_AUDIO_CHANNEL,
  ENGINE_CAPTURE_STATUS_CHANNEL,
  ENGINE_EVENT_CHANNEL,
  ENGINE_LIST_DEVICES_CHANNEL,
  ENGINE_SET_INPUT_CHANNEL,
  ENGINE_TAP_SELFTEST_CHANNEL,
  ENGINE_START_CHANNEL,
  ENGINE_STOP_CHANNEL,
  ENGINE_SNAPSHOT_CHANNEL,
  type EngineEvent,
  type EngineInputDevice,
  type EngineCaptureStatus,
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

/** The native dictation helper: beside the engine in the packaged app. */
function resolveDictationHelperBinary(): string {
  if (process.platform === 'win32') {
    // Bark's Windows helper (engine/windows/dictation-helper, built with the .NET
    // Framework 4.8 compiler): Resources/engine in the packaged app.
    return app.isPackaged
      ? join(process.resourcesPath, 'engine', 'dictation-helper.exe')
      : path.resolve(
          app.getAppPath(),
          '..',
          '..',
          'engine',
          '.build',
          'windows',
          'dictation-helper.exe'
        )
  }
  if (app.isPackaged) {
    return join(process.resourcesPath, 'engine', 'dictation-helper')
  }
  return path.resolve(
    app.getAppPath(),
    '..',
    '..',
    'engine',
    '.build',
    'release',
    'dictation-helper'
  )
}

/**
 * How MCP clients launch the bundled doodle-note-mcp server: the DoodleNote
 * binary itself doubles as the Node runtime via ELECTRON_RUN_AS_NODE, so
 * users need no Node install and no repo checkout. Bundled under
 * Resources/mcp in the packaged app; the workspace build output in dev.
 */
function resolveMcpServerSpec(): McpServerSpec {
  const script = app.isPackaged
    ? join(process.resourcesPath, 'mcp', 'cli.js')
    : path.resolve(app.getAppPath(), '..', '..', 'packages', 'doodle-note-mcp', 'dist', 'cli.js')
  return { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/**
 * One-time migration: dev runs stored everything under the app name
 * "desktop" (~/Library/Application Support/desktop). The packaged app is
 * "DoodleNote" — adopt the dev data (meetings, folders, settings and chat)
 * on first launch. Models are discovered in place by NotesService.
 */
function migrateDevUserData(): void {
  // A development build never adopts another profile's meetings or settings.
  if (!app.isPackaged || !profile.adoptLegacyData) return
  try {
    const newDir = app.getPath('userData')
    const oldDir = join(newDir, '..', 'desktop')
    if (existsSync(join(newDir, 'meetings')) || !existsSync(join(oldDir, 'meetings'))) return
    console.log('[migrate] adopting dev data from', oldDir)
    cpSync(join(oldDir, 'meetings'), join(newDir, 'meetings'), { recursive: true })
    for (const name of ['folders.json', 'settings.json', 'global-chat.json']) {
      if (existsSync(join(oldDir, name))) cpSync(join(oldDir, name), join(newDir, name))
    }
  } catch (err) {
    console.error('[migrate] failed (continuing with fresh data):', err)
  }
}

// Debugging affordance: DOODLE_DEBUG_PORT=9333 opens the Chrome DevTools
// Protocol so playback/UI issues can be inspected in the running app.
if (process.env.DOODLE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.DOODLE_DEBUG_PORT)
}
// A Windows package must carry the identity its code was built for (production or
// QA, src/main/app-identity.ts); a mismatch would write the other one's login item
// and MCP entries. The packaged app name is the package name in app.asar.
if (process.platform === 'win32' && app.isPackaged && APP_CHANNEL === 'release') {
  const mismatch = identityMismatch(app.getName())
  if (mismatch) {
    dialog.showErrorBox(APP_IDENTITY.productName, mismatch)
    process.exit(1)
  }
}

// Where this build keeps its state. The production lineage keeps the existing
// rule (DOODLE_USER_DATA relocates unpackaged runs only). A development build
// owns a distinct, explicitly named profile, because that variable cannot
// isolate a packaged app. Must run before anything resolves a path or locks.
const profile = planProfile({
  channel: APP_CHANNEL,
  isPackaged: app.isPackaged,
  appData: app.getPath('appData'),
  home: app.getPath('home'),
  env: { DOODLE_USER_DATA: process.env.DOODLE_USER_DATA }
})
if (profile.appName) app.setName(profile.appName)
if (profile.userData) app.setPath('userData', profile.userData)
if (profile.logs) app.setAppLogsPath(profile.logs)

// One owner per desktop profile. Mac library transfers must finish before any
// other app instance can write; Windows also shares the updater cache.
if (process.platform === 'win32' || process.platform === 'darwin') {
  if (!app.requestSingleInstanceLock()) app.exit(0)
  app.on('second-instance', () => {
    // Do not recreate a window while the installer is waiting for us to quit.
    void app.whenReady().then(() => {
      if (libraryReady && !isQuittingForUpdate()) focusMainWindow()
    })
  })
}

// Must run before app ready: lets <img src="doodle-media://…"> load without
// mixed-content blocking (the dev renderer is served over http). doodle-audio
// additionally needs stream support so <audio> can range-request recordings.
protocol.registerSchemesAsPrivileged([
  { scheme: 'doodle-media', privileges: { secure: true, supportFetchAPI: true } },
  { scheme: 'doodle-audio', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
let recordingTray: RecordingTray | null = null
let quitting = false
let libraryReady = false
/** Windows: the window was closed during a recording and has not been reopened. */
let closedWhileRecording = false
/** Windows: shutdown or log-off is ending this session. */
let sessionEnding = false
let sessionEndingReset: ReturnType<typeof setTimeout> | null = null
/** Windows: last automatic-notes progress and library write, for the deferred quit. */
let lastNotesActivityAt = 0
let lastLibraryWriteAt = 0
let backgroundFinish: { endedAt: number; timer: ReturnType<typeof setInterval> } | null = null

/**
 * Windows: the recording that outlived its window has ended. Quit once the
 * automatic notes and their saves have finished (bounded), as the close the
 * person asked for. Reopening the window or a new recording cancels this.
 */
function startBackgroundFinish(): void {
  if (backgroundFinish) return
  const endedAt = Date.now()
  recordingTray?.showFinishingNotes(true)
  const timer = setInterval(() => {
    if (quitting) return cancelBackgroundFinish()
    if (backgroundQuitDue(Date.now(), { endedAt, lastNotesActivityAt, lastLibraryWriteAt })) {
      cancelBackgroundFinish()
      app.quit()
    }
  }, 1_000)
  backgroundFinish = { endedAt, timer }
}

function cancelBackgroundFinish(): void {
  if (!backgroundFinish) return
  clearInterval(backgroundFinish.timer)
  backgroundFinish = null
  recordingTray?.showFinishingNotes(false)
}

function resetSessionEnding(): void {
  sessionEnding = false
  if (sessionEndingReset) clearTimeout(sessionEndingReset)
  sessionEndingReset = null
}
const recording = new RecordingStartCoordinator(
  (request: RecordingStartRequest) =>
    mainWindow?.webContents.send(RECORDING_DELIVER_CHANNEL, request),
  (state) => {
    recordingTray?.update(state)
    mainWindow?.webContents.send(RECORDING_STATE_CHANNEL, state)
    calendarService?.setRecordingActive(state.phase !== 'idle')
    // Windows: the close the person asked for during the recording happens once
    // its automatic notes have finished; a new recording puts that on hold.
    if (quitsAfterBackgroundRecording(process.platform, closedWhileRecording, state.phase))
      startBackgroundFinish()
    else if (state.phase !== 'idle') cancelBackgroundFinish()
  },
  (url) => shell.openExternal(url)
)

function requestRecordingStart(event?: CalendarStartMeetingEvent): boolean {
  if (libraryActivity.moving) return false
  if (dictation?.ownsCapture) {
    // One microphone owner at a time: never start a meeting over dictation.
    new Notification({
      title: 'Dictation is using the microphone',
      body: 'Finish or cancel dictation, then start recording.'
    }).show()
    return false
  }
  if (event) {
    const resolved = calendarService?.resolveStart(event)
    if (!resolved) return false
    event = resolved
  }
  const accepted = recording.request(
    event ?? {
      action: 'start',
      eventId: '',
      subject: 'Meeting',
      startIso: new Date().toISOString(),
      adHoc: true
    }
  )
  focusMainWindow()
  return accepted
}

let notesService: NotesService | null = null
let dictation: DictationService | null = null
let winDictationCapture: WinDictationCapture | null = null
let recipeRunner: RecipeRunner | null = null
let calendarService: CalendarService | null = null
let winBatchTranscriber: WinBatchTranscriber | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

/** Per-platform transcription engine host — identical event surface. */
const engine =
  process.platform === 'win32'
    ? new WinEngineHost(broadcast)
    : new EngineProcess(resolveEngineBinary())

function broadcastEngineEvent(event: EngineEvent): void {
  broadcast(ENGINE_EVENT_CHANNEL, event)
}

/**
 * Windows: keep the main window within the work area of the display it is on
 * when it moves to another display or scaling changes (mixed-DPI setups, a
 * laptop undocked from a monitor). See mainWindowBoundsFor.
 */
function keepMainWindowOnScreen(window: BrowserWindow): void {
  const refit = (): void => {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
    if (window.isMinimized()) return
    const area = screen.getDisplayMatching(window.getBounds()).workArea
    const limits = mainWindowBoundsFor(area)
    window.setMinimumSize(limits.minWidth, limits.minHeight)
    const next = fitIntoWorkArea(window.getBounds(), area)
    if (next) window.setBounds(next)
  }
  screen.on('display-metrics-changed', refit)
  screen.on('display-removed', refit)
  window.on('moved', refit)
  window.on('closed', () => {
    screen.off('display-metrics-changed', refit)
    screen.off('display-removed', refit)
  })
}

function createWindow(): void {
  // Windows opens on the display under the pointer, sized to fit its work area at
  // any scale; macOS keeps its fixed default.
  const bounds =
    process.platform === 'win32'
      ? mainWindowBoundsFor(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea)
      : {
          width: MAIN_WINDOW_SIZE.defaultWidth,
          height: MAIN_WINDOW_SIZE.defaultHeight,
          minWidth: MAIN_WINDOW_SIZE.minWidth,
          minHeight: MAIN_WINDOW_SIZE.minHeight
        }
  const window = new BrowserWindow({
    ...bounds,
    // Matches the active palette so launch never flashes the wrong color.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1f19' : '#f7f5ee',
    show: false,
    autoHideMenuBar: true,
    // macOS: content extends under a hidden title bar; the renderer provides a
    // drag strip and keeps clear of the traffic lights. Windows: hidden title bar
    // with themed caption buttons (see window-chrome.ts).
    ...windowChromeOptions(process.platform, nativeTheme.shouldUseDarkColors),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow = window
  if (process.platform === 'win32') keepMainWindowOnScreen(window)
  window.on('close', (event) => {
    if (libraryActivity.moving) {
      event.preventDefault()
      return
    }
    // Keep the document renderer alive while it owns a recording.
    if (hidesToTrayOnClose(process.platform, recording.busy, quitting || sessionEnding)) {
      event.preventDefault()
      window.hide()
      // Windows has no Dock: point at the notification-area icon once.
      if (process.platform === 'win32') {
        closedWhileRecording = true
        recordingTray?.showBackgroundHint()
      }
    }
  })
  if (process.platform === 'win32') {
    // Reopened from the tray (or a second launch): the person wants the app again.
    window.on('show', () => {
      closedWhileRecording = false
      cancelBackgroundFinish()
      resetSessionEnding()
    })
    // A cancelled shutdown fires no event: back to normal on focus or after a while.
    window.on('focus', resetSessionEnding)
    // Shutdown / log-off: do not hold the session open; stop and save, then quit.
    window.on('query-session-end', () => {
      resetSessionEnding()
      sessionEnding = true
      sessionEndingReset = setTimeout(resetSessionEnding, SESSION_END_CANCEL_RESET_MS)
    })
    window.on('session-end', () => {
      if (sessionEndingReset) clearTimeout(sessionEndingReset)
      sessionEndingReset = null
      sessionEnding = true
      app.quit()
    })
  }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    recording.rendererGone()
    // Windows: the pill and the hidden capture window outlive the main window, so
    // window-all-closed never fires on its own. When a real close (not hide-to-tray)
    // leaves only those, quit — preserving step 3's "close quits unless recording".
    if (process.platform === 'win32' && !quitting && !recording.busy) {
      const remaining = BrowserWindow.getAllWindows().filter(
        (other) => other !== window && !other.isDestroyed()
      )
      // The pill and hidden capture window are tagged, so they never keep the app alive.
      if (onlyDictationWindowsRemain(remaining, null)) app.quit()
    }
  })
  window.webContents.on('did-start-loading', () => {
    if (recording.busy && engine.running) engine.stop()
    recording.rendererGone()
  })
  window.webContents.on('render-process-gone', () => {
    engine.stop()
    recording.rendererGone()
  })
  window.on('ready-to-show', () => {
    window.show()
  })

  // Spell-check suggestions + edit ops on right-click (Electron has none).
  registerContextMenu(window)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In-page link clicks (e.g. the transcript footer in generated notes) go
  // to the system browser — the app itself never navigates away.
  window.webContents.on('will-navigate', (event, url) => {
    if (/^https?:/i.test(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  migrateDevUserData()
  const storage = supportsLibraryLocation(process.platform)
    ? await prepareLibrary(app.getPath('userData'))
    : null
  if (supportsLibraryLocation(process.platform) && !storage) {
    app.quit()
    return
  }
  const libraryRoot = (): string => storage?.root ?? app.getPath('userData')
  // Block the main event loop at the recovery dialog rather than letting stores
  // mistake an unplugged volume for a new, empty library. Stop capture first.
  const assertLibrary = (): void => {
    if (!storage) return
    for (;;) {
      try {
        storage.assertAvailable()
        return
      } catch {
        if (engine.running) engine.stop()
        const response = dialog.showMessageBoxSync({
          type: 'error',
          title: 'Library disconnected',
          message: 'Reconnect your library folder to continue.',
          detail:
            'Recording has been stopped. Reconnect the drive or restore folder access, then retry. A recording interrupted by a disconnected drive may be incomplete. DoodleNote will not create an empty replacement library.',
          buttons: ['Retry', 'Quit'],
          defaultId: 0,
          cancelId: 1
        })
        if (response !== 0) {
          app.exit(0)
          throw new Error('Library unavailable')
        }
      }
    }
  }
  if (storage) setInterval(assertLibrary, 2000).unref()

  // Warm the engine once per launch. macOS: Swift preflight primes the
  // CoreML cache only. Permission setup belongs to the visible first-run wizard.
  // Windows: the sherpa engine forks immediately (downloads its model on
  // first run) and the renderer handles capture permissions per session.
  if (process.platform === 'darwin') {
    try {
      const preflight = spawn(resolveEngineBinary(), ['preflight', '--models-only'], {
        stdio: ['ignore', 'ignore', 'pipe']
      })
      preflight.stderr?.setEncoding('utf8')
      preflight.stderr?.on('data', (chunk: string) => {
        const line = chunk.trim()
        if (line.length > 0) console.error(`[engine preflight] ${line}`)
      })
      preflight.on('error', (err) => console.error('[engine preflight] spawn failed:', err.message))
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
  } else {
    engine.startServe()
    // System-audio "Them" channel: answer getDisplayMedia with WASAPI
    // loopback (the renderer drops the mandatory video track on arrival).
    electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const first = sources[0]
          if (first) {
            callback({ video: first, audio: 'loopback' })
          } else {
            callback({})
          }
        })
        .catch(() => callback({}))
    })
  }

  // Windows capture bridge: PCM frames + failure reports from the renderer.
  ipcMain.on(
    ENGINE_AUDIO_CHANNEL,
    (_event, payload: { sessionId?: unknown; channel?: string; samples?: unknown }) => {
      if (engine instanceof WinEngineHost && payload.samples instanceof Float32Array) {
        engine.pushAudio(Number(payload.sessionId), String(payload.channel ?? ''), payload.samples)
      }
    }
  )
  ipcMain.on(ENGINE_CAPTURE_STATUS_CHANNEL, (_event, payload: unknown) => {
    if (engine instanceof WinEngineHost && payload && typeof payload === 'object') {
      engine.captureStatus(payload as EngineCaptureStatus)
    }
  })

  // Also names the Windows login item (Electron reads the Run value by this id).
  electronApp.setAppUserModelId(APP_IDENTITY.appUserModelId)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Ad-hoc meeting detection: engine micmon watches for meeting apps holding
  // the mic open (Zoom/Teams/Meet) and prompts even without a calendar event.
  // Audio output alone is intentionally ignored: it cannot distinguish an
  // incoming call from ordinary playback, notifications, or phone tones.
  const micWatcher = new MicWatcher(
    resolveEngineBinary(),
    app.getPath('userData'),
    (appLabel, detectionId) => {
      calendarService?.deliverPrompt({
        action: 'prompt',
        eventId: '',
        // Pre-title from the detected app ("Zoom meeting"); generic otherwise.
        subject: appLabel && appLabel !== 'browser' ? `${appLabel} meeting` : 'Meeting',
        startIso: new Date().toISOString(),
        adHoc: true,
        ...(detectionId ? { detectionId } : {})
      })
    },
    () => {
      // Meeting app hung up mid-recording — the editor stops its capture.
      broadcast(DETECT_MEETING_ENDED_CHANNEL, {})
    }
  )

  // Saved meeting audio: session dirs for the engine's checkpoint recording,
  // playback serving, crash recovery, deletion. Local-only — never synced.
  const audioService = new AudioService(
    () => join(libraryRoot(), 'audio'),
    resolveEngineBinary(),
    assertLibrary,
    broadcast
  )
  audioService.registerIpc()
  audioService.registerProtocol()
  // Recover audio from sessions a crash cut short — after launch settles.
  setTimeout(() => {
    void libraryActivity
      .run(() => audioService.recoverOrphans())
      .catch((err) => {
        console.error('[audio] orphan recovery failed:', err)
      })
  }, 10_000).unref()

  const meetingsService = new MeetingsService(() => join(libraryRoot(), 'meetings'), assertLibrary)
  meetingsService.registerIpc()
  let captureMeetingId: string | undefined
  let pendingCaptureMeetingId: string | undefined
  let captureBase: import('@repo/meetings-store/types').MeetingTranscriptSegment[] = []
  let captureBaseEcho = 0
  let captureId: string | undefined
  const session = new TranscriptSession(
    broadcastEngineEvent,
    () => join(libraryRoot(), 'sessions'),
    assertLibrary,
    (segments, ended, savedAudioFailures) => {
      if (!captureMeetingId) return
      persistCaptureTranscript(
        meetingsService,
        captureMeetingId,
        captureBase,
        captureBaseEcho,
        segments,
        ended,
        savedAudioFailures
      )
    },
    // Windows commits per utterance: checkpoint open text, save in time order.
    process.platform === 'win32' ? { checkpointOpenText: true, sortOnFinish: true } : {}
  )

  ipcMain.handle(ENGINE_SNAPSHOT_CHANNEL, (event, meetingId: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof meetingId !== 'string') return null
    const snapshot = session.snapshot(meetingId)
    // A later authoritative re-transcription supersedes a completed live capture.
    if (snapshot?.phase === 'ended') {
      const saved = meetingsService.get(meetingId)?.segments ?? []
      if (
        !snapshot.segments
          .filter((s) => !s.echo)
          .every((s) => saved.some((current) => current.id === s.id && current.text === s.text))
      )
        return null
    }
    return snapshot
  })

  // Persistent event log: every engine event, timestamped, so failed sessions
  // can be diagnosed from disk instead of reproduced. Token arrays collapse to
  // a count and spoken text to a length — transcript bodies are sensitive and
  // never belong in logs; timings/counts are enough to debug a session.
  // Rotated when it grows past ~5MB.
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
      const compact = JSON.stringify(event, (key, value) => {
        if (key === 'tokens' && Array.isArray(value)) return `[${value.length} tokens]`
        if (key === 'text' && typeof value === 'string') return `[${value.length} chars]`
        return value
      })
      appendFileSync(engineLogPath, `${new Date().toISOString()} ${compact}\n`)
    } catch {
      // Never let logging interfere with the session.
    }
  }

  engine.onEvent((rawEvent) => {
    // Dictation owns the sidecar for its session: its events must never reach
    // the meeting transcript, the renderer, saved audio or the event log.
    if (dictation?.handleEngineEvent(rawEvent)) return
    // Bind terminal transcript persistence to the exact capture the renderer saw start.
    if (rawEvent.event === 'started') {
      captureId = randomUUID()
      // Preparing a start must not reroute the previous capture's checkpoints.
      // Commit the destination/base together with the session's new ownership.
      captureMeetingId = rawEvent.command === 'live' ? pendingCaptureMeetingId : undefined
      const captureMeeting = captureMeetingId ? meetingsService.get(captureMeetingId) : null
      captureBase = captureMeeting?.segments ?? []
      captureBaseEcho = captureMeeting?.echoSuppressed ?? 0
    }
    // The host rejects callbacks from superseded processes. Stamp accepted events
    // for snapshot/renderer ownership, and never send filesystem diagnostics to UI.
    const event = captureEventForSession(rawEvent, captureId)
    if (!event) return
    broadcastEngineEvent(event)
    session.handle(event)
    if (event.event === 'audio') audioService.onAudioSaved(event)
    logEngineEvent(event)
    recording.handle(event)
    if (!recording.busy) micWatcher.setSuppressed(false)
  })

  ipcMain.on(ENGINE_START_CHANNEL, (event, request: EngineStartRequest) => {
    if (event.sender !== mainWindow?.webContents) return
    if (dictation?.ownsCapture) {
      broadcastEngineEvent({
        event: 'spawn-error',
        message: 'Dictation is using the microphone. Finish or cancel it, then start recording.'
      })
      return
    }
    if (libraryActivity.moving) {
      broadcastEngineEvent({
        event: 'spawn-error',
        message: 'Wait for the library transfer to finish before recording.'
      })
      return
    }
    if (request.opts?.meetingId && importService.isWorkingOn(request.opts.meetingId)) {
      broadcastEngineEvent({
        event: 'spawn-error',
        message: 'Wait for re-transcription to finish or cancel it before resuming this recording.'
      })
      return
    }
    if (
      !beginRecordableMeeting(
        request.command === 'live' && request.opts?.meetingId
          ? meetingsService.get(request.opts.meetingId)
          : null,
        () => recording.beginEngine(request.opts?.meetingId),
        (message) => broadcastEngineEvent({ event: 'spawn-error', message })
      )
    )
      return

    assertLibrary()
    // Our own capture holds the mic — the ad-hoc meeting detector must not
    // mistake it for a Zoom call. Suppress BEFORE the engine opens the mic.
    if (request.command === 'live') calendarService?.setRecordingActive(true)
    micWatcher.setSuppressed(true)
    const opts = { ...request.opts }
    // Audio persistence: give the session a directory keyed by meeting; the
    // capture host checkpoints into it and merges on stop (Swift engine on
    // macOS, the main-process PCM tee on Windows). Renderer-set audioDir is
    // ignored — main owns the location.
    delete opts.audioDir
    if (request.command === 'live' && opts.meetingId && opts.persistAudio !== false) {
      opts.audioDir = audioService.beginSession(opts.meetingId) ?? undefined
    }
    pendingCaptureMeetingId = request.command === 'live' ? opts.meetingId : undefined
    session.bindMeeting(pendingCaptureMeetingId)
    engine.start(request.command, request.filePath, opts)
  })

  ipcMain.on(ENGINE_STOP_CHANNEL, () => {
    // A meeting's stop must not end someone's dictation.
    if (dictation?.ownsCapture) return
    recording.stop()
    engine.stop()
  })

  // Mic input picker: device list + (mid-session) switching. macOS engine
  // only — Windows captures in the renderer, which owns device choice there.
  ipcMain.handle(ENGINE_LIST_DEVICES_CHANNEL, (): Promise<EngineInputDevice[]> => {
    return engine instanceof EngineProcess ? engine.listInputDevices() : Promise.resolve([])
  })
  ipcMain.handle(ENGINE_TAP_SELFTEST_CHANNEL, () =>
    engine instanceof EngineProcess
      ? engine.tapSelfTest()
      : { ok: false, reason: 'not available on this platform' }
  )
  ipcMain.on(ENGINE_SET_INPUT_CHANNEL, (_event, uid: unknown) => {
    if (engine instanceof EngineProcess) {
      engine.setInputDevice(typeof uid === 'string' && uid.length > 0 ? uid : null)
    } else if (engine instanceof WinEngineHost) {
      engine.setInputDevice(typeof uid === 'string' && uid.length > 0 ? uid : null)
    }
  })

  // NotesService reads the main-owned meetings store for cross-meeting context.

  notesService = new NotesService(
    app.getPath('userData'),
    (channel, payload) => {
      // The deferred Windows quit waits while automatic notes make progress.
      if (channel === NOTES_ENHANCE_PROGRESS_CHANNEL || channel === NOTES_ENHANCE_TOKEN_CHANNEL)
        lastNotesActivityAt = Date.now()
      broadcast(channel, payload)
    },
    meetingsService,
    libraryRoot,
    assertLibrary
  )
  notesService.registerIpc()

  // System-wide dictation (macOS and Windows). Created once the notes service
  // exists so optional cleanup shares its model ownership. Disabled until the user
  // turns it on in Settings; nothing here opens the microphone by itself.
  const barkWindows = process.platform === 'win32' && engine instanceof WinEngineHost
  const winEngineHost = barkWindows ? (engine as WinEngineHost) : null
  // Windows: the microphone is recorded raw in a hidden window of Bark's own, and the
  // shared Parakeet worker transcribes it; the C# helper hears the hold key and types.
  winDictationCapture = winEngineHost
    ? new WinDictationCapture({
        preload: join(__dirname, '../preload/dictation-capture.js'),
        load: (window) =>
          is.dev && process.env['ELECTRON_RENDERER_URL']
            ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/dictation-capture.html`)
            : window.loadFile(join(__dirname, '../renderer/dictation-capture.html')),
        testHooks: !app.isPackaged && process.env.DOODLENOTE_BARK_TEST_HOOKS === '1',
        onCaptureLost: (status) => winEngineHost.captureStatus(status)
      })
    : null
  if (winEngineHost && winDictationCapture) {
    const capture = winDictationCapture
    winEngineHost.setDictationCaptureSink((control) => capture.control(control))
  }
  const winBark =
    winEngineHost && winDictationCapture
      ? winDictationEngine(winEngineHost, winDictationCapture)
      : null
  dictation = createDictationHost({
    channel: APP_CHANNEL,
    userData: app.getPath('userData'),
    logsDir: app.getPath('logs'),
    helperPath: resolveDictationHelperBinary(),
    packaged: app.isPackaged,
    // Bark needs a speech engine and a helper for typing: the Swift engine and helper
    // on macOS, the Parakeet worker and the C# helper on Windows. It is off until the
    // person turns it on in Settings.
    engine:
      process.platform === 'darwin' && engine instanceof EngineProcess ? engine : (winBark ?? null),
    ...(winBark && winEngineHost
      ? {
          inputStateUid: (uid: string | null) =>
            windowsInputStateUid(uid, (id) => winBark.deviceName(id)),
          // While Bark is on, the speech model stays loaded so a press starts at once.
          onEnabled: (enabled: boolean) => winEngineHost.setKeepWarm(enabled),
          // The speech worker holds and verifies the helper before each spawn (no PowerShell).
          helperHolder: (path: string) => winEngineHost.holdHelper(path)
        }
      : {}),
    notes: () => notesService,
    meetingBusy: () => recording.busy || libraryActivity.moving,
    setMicHeld: (held) => {
      // Our own capture must not look like a Zoom call to the meeting detector.
      if (held) micWatcher.setSuppressed(true)
      else if (!recording.busy) micWatcher.setSuppressed(false)
    },
    showMainWindow: focusMainWindow,
    isTrustedSender: (sender) => sender === mainWindow?.webContents,
    broadcast
  }).service
  void dictation.start()

  recipeRunner = new RecipeRunner(
    libraryRoot,
    assertLibrary,
    (policy, system, prompt, signal) => notesService!.runRecipe(policy, system, prompt, signal),
    (work) => libraryActivity.run(work)
  )
  registerRecipes(recipeRunner)

  if (engine instanceof WinEngineHost) {
    winBatchTranscriber = new WinBatchTranscriber()
    winBatchTranscriber.registerIpc()
  }

  // Audio import + re-transcription: batch engine runs in its own process,
  // so a live recording session is never disturbed.
  const importService = new ImportService(
    resolveEngineBinary(),
    meetingsService,
    audioService,
    broadcast,
    winBatchTranscriber
      ? (filePath, onProgress, options) =>
          winBatchTranscriber!.transcribe(filePath, onProgress, options)
      : (filePath, onProgress, options) =>
          options?.settings?.backend === 'whisper'
            ? transcribeWithWhisper(
                resolveEngineBinary(),
                app.isPackaged
                  ? join(process.resourcesPath, 'engine', 'whisper-cli')
                  : join(__dirname, '../../../../engine/.build/whisper/whisper-cli'),
                join(app.getPath('userData'), 'models', 'whisper'),
                filePath,
                onProgress,
                options
              )
            : transcribeFileToSegments(resolveEngineBinary(), filePath, onProgress, options),
    () => {
      const settings = notesService?.batchTranscriptionSettings() ?? {
        backend: 'parakeet',
        parakeetModel: 'v2',
        language: 'auto'
      }
      // Windows batch transcription is Parakeet only; Whisper is a Mac backend.
      return winBatchTranscriber ? { ...settings, backend: 'parakeet' } : settings
    }
  )
  importService.setCaptureGuard(
    (meetingId) => recording.busy && recording.snapshot().meetingId === meetingId
  )
  importService.registerIpc()
  new TextImportService(meetingsService).registerIpc()

  // First-run setup wizard: visible preflight + permission status.
  const wizardService = new WizardService(
    resolveEngineBinary(),
    broadcast,
    engine instanceof WinEngineHost ? (onEvent) => engine.preflight(onEvent) : undefined
  )
  wizardService.registerIpc()

  // Meeting export (Markdown / PDF).
  const exportService = new ExportService(meetingsService)
  exportService.registerIpc()

  const foldersService = new FoldersService(
    () => join(libraryRoot(), 'folders.json'),
    meetingsService,
    assertLibrary
  )
  foldersService.registerIpc()

  // Microsoft 365 calendar: auth + Graph polling + the meeting-start watcher.
  // The floating panel catches prompts when the main window can't be seen.
  calendarService = new CalendarService(
    app.getPath('userData'),
    broadcast,
    focusMainWindow,
    new PromptPanel(),
    requestRecordingStart,
    (state) => recordingTray?.updateCalendar(state)
  )
  calendarService.registerIpc()

  // Only the main document renderer may participate in the start handshake.
  ipcMain.handle(
    RECORDING_REQUEST_CHANNEL,
    (event, prompt?: CalendarStartMeetingEvent) =>
      event.sender === mainWindow?.webContents && requestRecordingStart(prompt)
  )
  ipcMain.handle(RECORDING_JOIN_RETRY_CHANNEL, (event, requestId: unknown) => {
    if (event.sender === mainWindow?.webContents && typeof requestId === 'string')
      return recording.retryJoin(requestId)
    return undefined
  })
  ipcMain.handle(RECORDING_JOIN_DISMISS_CHANNEL, (event, requestId: unknown) => {
    if (event.sender === mainWindow?.webContents && typeof requestId === 'string')
      recording.dismissJoin(requestId)
  })
  ipcMain.handle(RECORDING_READY_CHANNEL, (event, eligible: boolean) => {
    if (event.sender !== mainWindow?.webContents) return recording.snapshot()
    return recording.ready(eligible === true)
  })
  ipcMain.handle(
    RECORDING_ATTACH_CHANNEL,
    (event, requestId: string, meetingId: string) =>
      event.sender === mainWindow?.webContents && recording.attach(requestId, meetingId)
  )
  ipcMain.handle(RECORDING_CANCEL_CHANNEL, (event, requestId: string) => {
    if (event.sender === mainWindow?.webContents) recording.cancel(requestId)
  })
  recordingTray = new RecordingTray(
    app.isPackaged
      ? join(process.resourcesPath, 'tray')
      : join(app.getAppPath(), 'resources', 'tray'),
    () => {
      requestRecordingStart()
    },
    focusMainWindow,
    (fullIsland) => calendarService?.setMenuBarMode(fullIsland)
  )

  // Meeting-detection settings: login item (OS-owned) + the mic watcher.
  const detectState = (): DetectState => ({
    loginItem: app.getLoginItemSettings().openAtLogin,
    micDetect: micWatcher.enabled,
    autoStop: micWatcher.autoStop,
    micMonitorAlive: micWatcher.monitorAlive,
    micDetectSupported: process.platform === 'darwin' || process.platform === 'win32',
    platform: process.platform,
    appVersion: app.getVersion()
  })
  ipcMain.handle(DETECT_GET_STATE_CHANNEL, (): DetectState => detectState())
  ipcMain.handle(DETECT_SET_PREFS_CHANNEL, (_event, update: DetectPrefsUpdate): DetectState => {
    if (typeof update?.loginItem === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: update.loginItem, name: APP_IDENTITY.loginItemName })
    }
    if (typeof update?.micDetect === 'boolean') {
      micWatcher.setEnabled(update.micDetect)
    }
    if (typeof update?.autoStop === 'boolean') {
      micWatcher.setAutoStop(update.autoStop)
    }
    return detectState()
  })
  // macOS: engine micmon (CoreAudio). Windows: ConsentStore registry poll.
  if (process.platform === 'darwin' || process.platform === 'win32') micWatcher.start()
  initAutoUpdater(
    broadcast,
    async () => {
      await recipeRunner?.stop()
      await notesService?.dispose()
    },
    { enabled: profile.updatesEnabled && APP_IDENTITY.updatesAllowed }
  )
  // Make a development build unmistakable in the Dock and Cmd-Tab.
  if (APP_CHANNEL === 'dev') app.dock?.setBadge('DEV')

  // Keep the host alive while the engine exits. Only then bypass llama addon
  // teardown on ordinary quit; updater quits must resume Electron's hand-off.
  app.on(
    'before-quit',
    createBeforeQuitHandler({
      acquire: () => libraryActivity.tryBeginShutdown(),
      cleanup: async () => {
        quitting = true
        // Windows keeps the tray (showing "Saving recording…") until the wait below.
        if (process.platform !== 'win32') recordingTray?.dispose()
        calendarService?.dispose()
        // Windows: stop and save an active recording first, as the macOS engine
        // does inside dispose(). The hidden renderer still owns the capture.
        if (process.platform === 'win32') {
          if (engine.running) recordingTray?.showSavingBeforeQuit()
          await finishRecordingBeforeQuit(
            engine,
            sessionEnding ? SESSION_END_FINISH_TIMEOUT_MS : undefined
          )
          recordingTray?.dispose()
        }
        const results = await Promise.allSettled([engine.dispose(), micWatcher.dispose()])
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length)
          throw new AggregateError(
            failures.map((result) => result.reason),
            'Recorder shutdown failed'
          )
      },
      isUpdate: isQuittingForUpdate,
      quit: () => app.quit(),
      hardExit: () => process.exit(0),
      failed: (error) => {
        quitting = false
        console.error('[quit] Recorder shutdown failed; host retained:', error)
      }
    })
  )

  // The renderer mirrors its theme pref here so nativeTheme (and with it the
  // floating prompt panel + native chrome) matches the in-app appearance.
  ipcMain.on(THEME_SET_SOURCE_CHANNEL, (_event, source: unknown) => {
    nativeTheme.themeSource = source === 'light' || source === 'dark' ? source : 'system'
    applyTitleBarOverlay()
  })
  // Windows caption buttons follow the app theme, and the system theme in 'system'.
  if (hasThemedTitleBarOverlay(process.platform)) nativeTheme.on('updated', applyTitleBarOverlay)

  // Cloud sync: opt-in one-way push of meetings/notes to the web dashboard.
  const syncService = new SyncService(
    app.getPath('userData'),
    meetingsService,
    foldersService,
    broadcast,
    libraryRoot,
    // A development build must not reach the production dashboard by accident.
    // Port 9 is the discard service: a connection fails immediately and locally.
    APP_CHANNEL === 'dev' ? 'http://127.0.0.1:9' : undefined
  )
  syncService.registerIpc()

  // Integrations: local MCP access remains off until enabled in Settings.
  const agentAccessService = new AgentAccessService(
    () => join(libraryRoot(), 'meetings'),
    resolveMcpServerSpec(),
    // The opt-in file and client configs normally live in the real home
    // directory and are shared by every DoodleNote. A development or QA identity
    // build gets a sandboxed home inside its own profile so it can never rewrite them.
    APP_CHANNEL === 'dev' || APP_IDENTITY.isolatesAgentAccess
      ? join(app.getPath('userData'), 'agent-access-home')
      : undefined
  )
  const previousLibrary = storage?.status().recoveryPath
  if (previousLibrary) {
    try {
      agentAccessService.refreshLibraryPath(join(previousLibrary, 'meetings'))
    } catch {
      dialog.showErrorBox(
        'Update agent access',
        'Your library moved, but the local agent configuration could not be updated. Restore access to that configuration file, then reopen DoodleNote before using connected agents. They may still show the original copy.'
      )
    }
  }
  agentAccessService.registerIpc()
  // Windows: when the installer recorded that it moved Programs\desktop to
  // Programs\DoodleNote for this exe, repoint what still launches the old exe
  // (login item, MCP clients); see the module. No record, nothing changes.
  if (process.platform === 'win32') {
    const markerPath = join(app.getPath('userData'), 'install-migration.json')
    const recordKey = installStateKey(APP_IDENTITY.appId)
    void runWindowsInstallMigration({
      platform: process.platform,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      readRecord: () => readInstallRecord(recordKey),
      clearRecord: () => clearInstallRecord(recordKey),
      exists: existsSync,
      readMarker: () => (existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null),
      writeMarker: (contents) => writeFileSync(markerPath, contents),
      loginItem: {
        stateFor: (exe) => {
          const settings = app.getLoginItemSettings({ path: exe })
          const item = settings.launchItems?.find((entry) => isInsideFolder(entry.path, exe))
          return { registered: settings.openAtLogin, enabled: item?.enabled ?? true }
        },
        registerCurrent: (enabled) =>
          app.setLoginItemSettings({ openAtLogin: true, enabled, name: APP_IDENTITY.loginItemName })
      },
      repointMcpClients: (isStale, only) => agentAccessService.repointStaleClients(isStale, only),
      log: (message) => console.log(message)
    }).catch((error) => console.log(`[install-migration] ${(error as Error).message}`))
  }

  const sourceIndex = new SourceIndexService(
    () => join(libraryRoot(), 'meetings'),
    join(app.getPath('userData'), 'derived-source-index'),
    assertLibrary
  )
  sourceIndex.registerIpc()
  app.on('will-quit', () => {
    void sourceIndex.dispose()
  })

  // Store writes fan out to cloud sync and local recording cleanup.
  meetingsService.onDidWrite = (change) => {
    lastLibraryWriteAt = Date.now()
    sourceIndex.invalidate()
    syncService.onMeetingsChanged(change.deletedId)
    // A deleted meeting takes its recordings with it.
    if (change.deletedId) audioService.deleteFor(change.deletedId)
  }
  foldersService.onDidWrite = (change) => syncService.onFoldersChanged(change.deletedId)

  // Image attachments for the notes editor (doodle-media:// protocol).
  const mediaService = new MediaService(() => join(libraryRoot(), 'attachments'), assertLibrary)
  mediaService.registerIpc()
  mediaService.registerProtocol()
  if (storage)
    registerStorageIpc(
      storage,
      () => recording.busy || importService.isBusy,
      (previous) => {
        sourceIndex.refreshLibraryPath()
        agentAccessService.refreshLibraryPath(join(previous, 'meetings'))
      }
    )

  // A fresh look at the app deserves fresh events (throttled inside).
  app.on('browser-window-focus', (_event, window) => calendarService?.onWindowFocus(window))

  libraryReady = true
  createWindow()

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked
    // and there are no other windows open.
    focusMainWindow()
  })
})

/** Recolor the Windows caption-button overlay for the current light/dark theme. */
function applyTitleBarOverlay(): void {
  if (!hasThemedTitleBarOverlay(process.platform)) return
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  window.setTitleBarOverlay(titleBarOverlayFor(nativeTheme.shouldUseDarkColors))
  window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1d1f19' : '#f7f5ee')
}

/** Bring the app forward for a notification click or sign-in, recreating the window if
 *  the user closed it (macOS keeps the app alive without windows). */
function focusMainWindow(): void {
  // Activate from the background (e.g. the browser after calendar sign-in).
  if (process.platform === 'darwin') app.focus({ steal: true })
  const window = mainWindow
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } else {
    createWindow()
  }
}

// Engine shutdown is awaited by before-quit; release remaining services here.
app.on('will-quit', () => {
  // Cancels any dictation session and releases the shortcuts and the helper.
  void dictation?.dispose()
  winDictationCapture?.dispose()
  void recipeRunner?.stop().then(() => notesService?.dispose())
  calendarService?.dispose()
  winBatchTranscriber?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
