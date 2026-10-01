import { beginRecordableMeeting } from './capture-eligibility'
import { transcribeWithWhisper } from './whisper-transcriber'
import { transcribeFileToSegments } from './import-logic'
import { libraryActivity } from './library-activity'
import {
  app,
  dialog,
  shell,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeTheme,
  protocol,
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
import { appendFileSync, cpSync, existsSync, statSync, writeFileSync } from 'node:fs'
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
import { MediaService } from './media-service'
import { AgentAccessService } from './agent-access-service'
import type { McpServerSpec } from '../shared/integrations-api'
import { MeetingsService } from './meetings-service'
import { MicWatcher } from './mic-watcher'
import { NotesService } from './notes-service'
import { PromptPanel } from './prompt-panel'
import { SyncService } from './sync-service'
import { MAIN_WINDOW_SIZE } from './window-sizing'
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
  } catch (err) {
    console.error('[migrate] failed (continuing with fresh data):', err)
  }
}

// Debugging affordance: DOODLE_DEBUG_PORT=9333 opens the Chrome DevTools
// Protocol so playback/UI issues can be inspected in the running app.
if (process.env.DOODLE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.DOODLE_DEBUG_PORT)
}
// Dev affordance: point userData somewhere else to exercise fresh-install
// flows (the setup wizard) without touching the real profile.
if (process.env.DOODLE_USER_DATA && !app.isPackaged) {
  app.setPath('userData', process.env.DOODLE_USER_DATA)
}

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
const recording = new RecordingStartCoordinator(
  (request: RecordingStartRequest) =>
    mainWindow?.webContents.send(RECORDING_DELIVER_CHANNEL, request),
  (state) => {
    recordingTray?.update(state)
    mainWindow?.webContents.send(RECORDING_STATE_CHANNEL, state)
    calendarService?.setRecordingActive(state.phase !== 'idle')
  },
  (url) => shell.openExternal(url)
)

function requestRecordingStart(event?: CalendarStartMeetingEvent): boolean {
  if (libraryActivity.moving) return false
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

function createWindow(): void {
  const window = new BrowserWindow({
    width: MAIN_WINDOW_SIZE.defaultWidth,
    height: MAIN_WINDOW_SIZE.defaultHeight,
    minWidth: MAIN_WINDOW_SIZE.minWidth,
    minHeight: MAIN_WINDOW_SIZE.minHeight,
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
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow = window
  window.on('close', (event) => {
    if (libraryActivity.moving) {
      event.preventDefault()
      return
    }
    // Keep the document renderer alive while it owns a recording.
    if (process.platform === 'darwin' && recording.busy && !quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    recording.rendererGone()
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
  const storage =
    process.platform === 'darwin' ? await prepareLibrary(app.getPath('userData')) : null
  if (process.platform === 'darwin' && !storage) {
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

  electronApp.setAppUserModelId('com.doodlenote.desktop')

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
    assertLibrary
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
  let captureBase: import('@repo/meetings-store/types').MeetingTranscriptSegment[] = []
  let captureBaseEcho = 0
  const session = new TranscriptSession(
    broadcastEngineEvent,
    () => join(libraryRoot(), 'sessions'),
    assertLibrary,
    (segments, ended) => {
      if (!captureMeetingId) return
      meetingsService.upsert({
        id: captureMeetingId,
        segments: [...captureBase, ...segments.filter((segment) => !segment.echo)],
        echoSuppressed: captureBaseEcho + segments.filter((segment) => segment.echo).length,
        ...(ended ? { endedAt: new Date().toISOString() } : {})
      })
    }
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
    // Bind terminal transcript persistence to the exact capture the renderer saw start.
    const event = rawEvent.event === 'started' ? { ...rawEvent, captureId: randomUUID() } : rawEvent
    broadcastEngineEvent(event)
    session.handle(event)
    if (event.event === 'audio') audioService.onAudioSaved(event)
    logEngineEvent(event)
    recording.handle(event)
    if (!recording.busy) micWatcher.setSuppressed(false)
  })

  ipcMain.on(ENGINE_START_CHANNEL, (event, request: EngineStartRequest) => {
    if (event.sender !== mainWindow?.webContents) return
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
    captureMeetingId = request.command === 'live' ? opts.meetingId : undefined
    const captureMeeting = captureMeetingId ? meetingsService.get(captureMeetingId) : null
    captureBase = captureMeeting?.segments ?? []
    captureBaseEcho = captureMeeting?.echoSuppressed ?? 0
    session.bindMeeting(captureMeetingId)
    engine.start(request.command, request.filePath, opts)
  })

  ipcMain.on(ENGINE_STOP_CHANNEL, () => {
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
    broadcast,
    meetingsService,
    libraryRoot,
    assertLibrary
  )
  notesService.registerIpc()

  if (engine instanceof WinEngineHost) {
    winBatchTranscriber = new WinBatchTranscriber((onEvent) => engine.preflight(onEvent))
    winBatchTranscriber.registerIpc()
    engine.setFinalRefiner((filePath, onProgress) =>
      winBatchTranscriber!.transcribe(filePath, onProgress)
    )
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
    () =>
      notesService?.batchTranscriptionSettings() ?? {
        backend: 'parakeet',
        parakeetModel: 'v2',
        language: 'auto'
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
  // macOS: engine micmon (CoreAudio). Windows: ConsentStore registry poll.
  if (process.platform === 'darwin' || process.platform === 'win32') micWatcher.start()
  initAutoUpdater(broadcast, () => notesService?.dispose() ?? Promise.resolve())

  // node-llama-cpp's async workers SIGABRT if they complete during Electron's
  // teardown (ThrowAsJavaScriptException on a dead env → ggml terminate) —
  // macOS then shows "DoodleNote quit unexpectedly" on the next launch. All
  // app state is written synchronously as it changes, and child processes
  // (transcription engine, micmon) exit on their own via stdin-close
  // watchdogs, so skipping native teardown loses nothing.
  app.on('before-quit', (event) => {
    if (libraryActivity.moving) {
      event.preventDefault()
      return
    }
    quitting = true
    recordingTray?.dispose()
    calendarService?.dispose()
    engine.dispose()
    micWatcher.stop()
    // A quit driven by Restart-to-update must proceed normally so Squirrel
    // can hand off to the installer; the hard exit is only for regular quits
    // (the llama-addon teardown SIGABRT workaround).
    if (!isQuittingForUpdate()) process.exit(0)
  })

  // The renderer mirrors its theme pref here so nativeTheme (and with it the
  // floating prompt panel + native chrome) matches the in-app appearance.
  ipcMain.on(THEME_SET_SOURCE_CHANNEL, (_event, source: unknown) => {
    nativeTheme.themeSource = source === 'light' || source === 'dark' ? source : 'system'
  })

  // Cloud sync: opt-in one-way push of meetings/notes to the web dashboard.
  const syncService = new SyncService(
    app.getPath('userData'),
    meetingsService,
    foldersService,
    broadcast,
    libraryRoot
  )
  syncService.registerIpc()

  // Integrations: local MCP access remains off until enabled in Settings.
  const agentAccessService = new AgentAccessService(
    () => join(libraryRoot(), 'meetings'),
    resolveMcpServerSpec()
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

  // Store writes fan out to cloud sync and local recording cleanup.
  meetingsService.onDidWrite = (change) => {
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
      (previous) => agentAccessService.refreshLibraryPath(join(previous, 'meetings'))
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

/** Bring the app forward for a notification click, recreating the window if
 *  the user closed it (macOS keeps the app alive without windows). */
function focusMainWindow(): void {
  const window = mainWindow
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
  winBatchTranscriber?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
