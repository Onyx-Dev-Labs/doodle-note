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
import { join } from 'node:path'
import { writeUpdateDiagnostic } from './update-diagnostics'
import type { UpdateState } from '../shared/update-api'

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
  let readyNotification: Notification | null = null
  let previousStatus: UpdateState['status'] | undefined
  const logFile = join(app.getPath('userData'), 'updates.log')
  const log = (event: Parameters<typeof writeUpdateDiagnostic>[1], targetVersion?: string): void =>
    writeUpdateDiagnostic(logFile, event, app.getVersion(), targetVersion)
  log('launch')
  app.on('before-quit', () => log('before-quit'))
  app.on('quit', () => log('quit'))
  const coordinator = new UpdateCoordinator(
    autoUpdater,
    app.getVersion(),
    app.isPackaged,
    (state) => {
      if (state.status !== previousStatus) log(state.status, state.latestVersion)
      previousStatus = state.status
      broadcast(UPDATE_STATE_EVENT_CHANNEL, state)
      if (state.status === 'installing') {
        try {
          readyNotification?.close()
        } catch {
          // A dismissed notification must not block installation.
        }
        readyNotification = null
      }
      if (state.status !== 'downloaded' || state.error) return
      try {
        if (!Notification.isSupported()) return
        readyNotification?.close()
        const notification = new Notification({
          title: `DoodleNote ${state.latestVersion} is ready`,
          body: 'Click to restart and update now.'
        })
        notification.on('click', () => void installNow())
        readyNotification = notification
        notification.show()
      } catch {
        // Settings still offers Restart to update.
      }
    }
  )

  const installNow = async (): Promise<void> => {
    if (quittingForUpdate || !coordinator.beginInstall()) return
    quittingForUpdate = true
    // The update quit must be a NORMAL quit (the installer takes over after
    // it), so the hard-exit workaround doesn't protect this path — unload
    // the model first, bounded so a hung dispose can't block the update.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        beforeInstall?.(),
        new Promise<void>((resolve) => {
          cleanupTimer = setTimeout(() => {
            log('cleanup-timeout')
            resolve()
          }, 3_000)
        })
      ])
    } catch {
      // install regardless
    } finally {
      clearTimeout(cleanupTimer)
    }
    try {
      autoUpdater.quitAndInstall()
    } catch {
      log('installer-error')
      quittingForUpdate = false
      coordinator.installFailed()
    }
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
    if (coordinator.state.status === 'installing') {
      log('installer-error')
      quittingForUpdate = false
      coordinator.installFailed()
    }
  })

  void coordinator.check()
  setInterval(() => {
    void coordinator.check()
  }, CHECK_INTERVAL_MS).unref()
}
