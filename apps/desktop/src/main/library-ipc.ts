import { ipcMain } from 'electron'
import { libraryActivity } from './library-activity'

/** Evaluate handlers after the barrier opens so their live paths cannot go stale. */
export const libraryIpc = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, (event, ...args) => libraryActivity.run(() => listener(event, ...args)))
  }
}
