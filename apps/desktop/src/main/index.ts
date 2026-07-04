import { app, shell, BrowserWindow, ipcMain } from 'electron'
import path, { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { EngineProcess } from './engine-process'
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

function broadcastEngineEvent(event: EngineEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(ENGINE_EVENT_CHANNEL, event)
    }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101014',
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
  engine.onEvent((event) => {
    broadcastEngineEvent(event)
    session.handle(event)
  })

  ipcMain.on(ENGINE_START_CHANNEL, (_event, request: EngineStartRequest) => {
    engine.start(request.command, request.filePath, request.opts)
  })

  ipcMain.on(ENGINE_STOP_CHANNEL, () => {
    engine.stop()
  })

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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
