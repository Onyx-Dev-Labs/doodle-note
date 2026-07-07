import { app, Notification } from 'electron'
import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg

const CHECK_INTERVAL_MS = 6 * 60 * 60_000

/**
 * Over-the-air updates: checks the Blob-hosted feed on launch and every six
 * hours; downloads land silently and install on the next quit
 * (autoInstallOnAppQuit), with a nudge notification when one is ready.
 * No-ops in dev — the feed only exists for packaged, signed builds.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title: `DoodleNote ${info.version} is ready`,
        body: 'Quit and reopen DoodleNote to finish updating.'
      })
      notification.show()
    } catch {
      // The update still applies on next quit.
    }
  })
  autoUpdater.on('error', (error) => {
    // Feed unreachable (offline, first release not published yet) — harmless.
    console.error('[updater]', error.message)
  })

  void autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS).unref()
}
