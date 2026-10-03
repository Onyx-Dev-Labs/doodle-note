import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { libraryActivity } from './library-activity'
import { LibraryStorage } from './library-storage'
import {
  STORAGE_CANCEL_CHANNEL,
  STORAGE_RETRY_CHANNEL,
  STORAGE_PROGRESS_CHANNEL,
  type StorageProgress,
  STORAGE_CHOOSE_CHANNEL,
  STORAGE_OPEN_CHANNEL,
  STORAGE_STATUS_CHANNEL,
  type StorageResult
} from '../shared/storage-api'

/** No renderer, engine, sync, protocol or library store exists during transfer. */
export async function prepareLibrary(userData: string): Promise<LibraryStorage | null> {
  mkdirSync(userData, { recursive: true })
  let storage: LibraryStorage
  try {
    storage = new LibraryStorage(userData)
  } catch {
    dialog.showErrorBox(
      'Cannot open library',
      'The library location setting could not be read. Restore library-location.json in DoodleNote application support before reopening. No library files were changed.'
    )
    return null
  }
  for (;;) {
    let progress: BrowserWindow | undefined
    try {
      if (storage.status().pendingPath) {
        progress = new BrowserWindow({
          width: 460,
          height: 190,
          closable: false,
          minimizable: false,
          maximizable: false,
          resizable: false,
          title: 'Moving DoodleNote library',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        })
        await progress.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              '<body style="font:16px system-ui;padding:24px"><h3>Moving your library</h3><p>Copying and verifying your files. Keep both drives connected. Your original files are kept as a recovery copy.</p></body>'
            )
        )
      }
      await storage.finishPending()
      return storage
    } catch (error) {
      progress?.destroy()
      progress = undefined
      const pending = Boolean(storage.status().pendingPath)
      const result = await dialog.showMessageBox({
        type: 'error',
        title: 'Library unavailable',
        message: 'DoodleNote could not open your library.',
        detail: `${error instanceof Error ? error.message : 'Check the folder and reconnect its drive.'}\n\nYour original files have been kept. No empty replacement library will be created.`,
        buttons: pending ? ['Retry', 'Cancel transfer', 'Quit'] : ['Retry', 'Quit'],
        defaultId: 0,
        cancelId: pending ? 2 : 1
      })
      if (pending && result.response === 1) {
        try {
          storage.cancel()
        } catch {
          return null
        }
      } else if (result.response !== 0) return null
    } finally {
      progress?.destroy()
    }
  }
}

export function registerStorageIpc(
  storage: LibraryStorage,
  busy: () => boolean,
  moved: (previousRoot: string) => void
): void {
  const result = async (action: () => void | Promise<void>): Promise<StorageResult> => {
    try {
      await action()
      return { status: storage.status() }
    } catch (error) {
      return {
        status: storage.status(),
        error:
          error instanceof Error ? error.message : 'The storage change failed. Please try again.'
      }
    }
  }
  let choosing = false
  const transfer = async (event: Electron.IpcMainInvokeEvent, parent?: string): Promise<void> => {
    const progress = (value: StorageProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(STORAGE_PROGRESS_CHANNEL, value)
    }
    progress({ phase: 'waiting' })
    await libraryActivity.exclusive(async () => {
      if (busy()) throw new Error('Finish recording or importing before moving the library.')
      if (parent) storage.schedule(parent)
      const previous = storage.root
      await storage.finishPending(progress)
      if (storage.root !== previous) {
        try {
          moved(previous)
        } catch {
          throw new Error(
            'Your library moved, but agent access could not be updated. Restore access to its configuration and reopen DoodleNote before using connected agents.'
          )
        }
      }
    })
  }
  ipcMain.handle(STORAGE_STATUS_CHANNEL, () => storage.status())
  ipcMain.handle(STORAGE_OPEN_CHANNEL, () =>
    result(async () => {
      storage.assertAvailable()
      if (await shell.openPath(storage.root))
        throw new Error(
          'Finder could not open the library folder. Check its permissions and try again.'
        )
    })
  )
  ipcMain.handle(STORAGE_CANCEL_CHANNEL, () =>
    result(() => {
      if (libraryActivity.moving || choosing)
        throw new Error('Wait for the current transfer to finish.')
      storage.cancel()
    })
  )
  ipcMain.handle(STORAGE_RETRY_CHANNEL, (event) =>
    result(async () => {
      if (choosing || busy())
        throw new Error('Finish recording or importing before moving the library.')
      await transfer(event)
    })
  )
  ipcMain.handle(STORAGE_CHOOSE_CHANNEL, (event) =>
    result(async () => {
      if (choosing || libraryActivity.moving || busy())
        throw new Error('Finish recording or importing before moving the library.')
      choosing = true
      try {
        const selection = await dialog.showOpenDialog({
          title: 'Choose a library location',
          buttonLabel: 'Move library here',
          message:
            'DoodleNote will create a DoodleNote Library folder here and move your library now. Your original files will be kept as a recovery copy.',
          properties: ['openDirectory', 'createDirectory']
        })
        if (selection.canceled || !selection.filePaths[0]) return
        if (busy()) throw new Error('Finish recording or importing before moving the library.')
        await transfer(event, selection.filePaths[0])
      } finally {
        choosing = false
      }
    })
  )
}
