import { app, ipcMain, Notification } from 'electron'
import updaterPkg from 'electron-updater'
import {
  UPDATE_CHECK_CHANNEL,
  UPDATE_CANCEL_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL
} from '../shared/update-api'
import { applyUpdatePolicy } from './update-policy'
import { UpdateCoordinator } from './update-coordinator'

const { autoUpdater } = updaterPkg

const CHECK_INTERVAL_MS = 6 * 60 * 60_000

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
export function initAutoUpdater(
  broadcast: (channel: string, payload: unknown) => void,
  /** Awaited before quitAndInstall — unload native addons that crash on a
   *  normal teardown (the llama addon SIGABRTs if a model is loaded). */
  beforeInstall?: () => Promise<void>
): void {
  const coordinator = new UpdateCoordinator(
    autoUpdater,
    app.getVersion(),
    app.isPackaged,
    (state) => {
      broadcast(UPDATE_STATE_EVENT_CHANNEL, state)
      if (state.status !== 'downloaded') return
      try {
        if (!Notification.isSupported()) return
        const notification = new Notification({
          title: `DoodleNote ${state.latestVersion} is ready`,
          body: 'Click to restart and update now.'
        })
        notification.on('click', () => void installNow())
        notification.show()
      } catch {
        // Settings still offers Restart to update.
      }
    }
  )

  const installNow = async (): Promise<void> => {
    if (coordinator.state.status !== 'downloaded' || quittingForUpdate) return
    quittingForUpdate = true
    // The update quit must be a NORMAL quit (the installer takes over after
    // it), so the hard-exit workaround doesn't protect this path — unload
    // the model first, bounded so a hung dispose can't block the update.
    try {
      await Promise.race([beforeInstall?.(), new Promise((resolve) => setTimeout(resolve, 3_000))])
    } catch {
      // install regardless
    }
    autoUpdater.quitAndInstall()
  }

  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, () => coordinator.state)
  ipcMain.handle(UPDATE_CHECK_CHANNEL, () => coordinator.check())
  ipcMain.handle(UPDATE_CANCEL_CHANNEL, () => coordinator.cancel())
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, () => {
    void installNow()
  })

  if (!app.isPackaged) return

  applyUpdatePolicy(autoUpdater)
  autoUpdater.autoDownload = false
  // Installation must use installNow so native models are unloaded first.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('download-progress', (progress) => coordinator.progress(progress))
  autoUpdater.on('error', (error) => {
    console.error('[updater]', error.message)
  })

  void coordinator.check()
  setInterval(() => {
    void coordinator.check()
  }, CHECK_INTERVAL_MS).unref()
}
