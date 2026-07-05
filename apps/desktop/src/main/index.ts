import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { EngineProcess } from './engine-process'
import { MeetingsService } from './meetings-service'
import { NotesService } from './notes-service'
import { TranscriptSession } from './transcript-session'
import {
  ENGINE_EVENT_CHANNEL,
  ENGINE_START_CHANNEL,
  ENGINE_STOP_CHANNEL,
  type EngineEvent,
  type EngineStartRequest
} from '../shared/engine-events'

/**
 * The Swift transcription sidecar lives at <repo root>/engine/.build/release/engine.
 * In dev, app root (app.getAppPath()) is apps/desktop, so the binary is two
 * levels up. Packaging is not wired yet; when it is, this should switch to a
 * bundled binary under process.resourcesPath.
 */
function resolveEngineBinary(): string {
  return path.resolve(app.getAppPath(), '..', '..', 'engine', '.build', 'release', 'engine')
}

const engine = new EngineProcess(resolveEngineBinary())
let notesService: NotesService | null = null

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
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F5EE',
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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
  } catch (err) {
    console.error('[engine preflight] failed:', err)
  }

  electronApp.setAppUserModelId('com.doodlenote.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

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
    engine.start(request.command, request.filePath, request.opts)
  })

  ipcMain.on(ENGINE_STOP_CHANNEL, () => {
    engine.stop()
  })

  notesService = new NotesService(app.getPath('userData'), broadcast)
  notesService.registerIpc()

  const meetingsService = new MeetingsService(join(app.getPath('userData'), 'meetings'))
  meetingsService.registerIpc()

  createWindow()

  app.on('activate', function () {
    // On macOS re-create a window when the dock icon is clicked
    // and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Make sure the sidecar never outlives the app.
app.on('will-quit', () => {
  engine.dispose()
  void notesService?.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
