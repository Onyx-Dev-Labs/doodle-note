import { app, ipcMain, Notification } from 'electron'
import updaterPkg from 'electron-updater'
import {
  UPDATE_CHECK_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  type UpdateState
} from '../shared/update-api'

const { autoUpdater } = updaterPkg

const CHECK_INTERVAL_MS = 6 * 60 * 60_000

let state: UpdateState = {
  currentVersion: app.getVersion(),
  supported: app.isPackaged,
  status: 'idle'
}
let quittingForUpdate = false

/**
 * True while quitAndInstall is driving the quit. The before-quit handler in
 * index.ts consults this: the usual hard process.exit(0) (the llama-addon
 * teardown workaround) skips the installer hand-off — which is why
 * install-on-quit alone was unreliable. The explicit Restart-to-update path
 * arms the installer first and must be allowed a normal quit.
 */
export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}

/**
 * Over-the-air updates: silent check on launch + every six hours, plus a
 * user-driven "Check for updates" in Settings with live status and a
 * Restart-to-update button.
 */
export function initAutoUpdater(broadcast: (channel: string, payload: unknown) => void): void {
  const setState = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch }
    broadcast(UPDATE_STATE_EVENT_CHANNEL, state)
  }

  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, () => state)
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (!app.isPackaged) return state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // the error event already updated state
    }
    return state
  })
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, () => {
    if (state.status !== 'downloaded') return
    quittingForUpdate = true
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => setState({ status: 'up-to-date' }))
  autoUpdater.on('update-available', (info) =>
    setState({ status: 'downloading', latestVersion: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', latestVersion: info.version, percent: 100 })
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title: `DoodleNote ${info.version} is ready`,
        body: 'Click to restart and update now.'
      })
      notification.on('click', () => {
        quittingForUpdate = true
        autoUpdater.quitAndInstall()
      })
      notification.show()
    } catch {
      // Settings still offers Restart to update.
    }
  })
  autoUpdater.on('error', (error) => {
    console.error('[updater]', error.message)
    setState({ status: 'error', error: error.message })
  })

  void autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS).unref()
}
