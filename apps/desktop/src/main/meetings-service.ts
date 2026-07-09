import { ipcMain } from 'electron'
import { MeetingFileStore } from '@repo/meetings-store'
import type { MeetingUpsert } from '@repo/meetings-store'
import {
  MEETINGS_DELETE_CHANNEL,
  MEETINGS_GET_CHANNEL,
  MEETINGS_LIST_CHANNEL,
  MEETINGS_SEARCH_CHANNEL,
  MEETINGS_UPSERT_CHANNEL
} from '../shared/meetings-api'

/**
 * The Electron face of the meetings store: IPC registration on top of the
 * shared MeetingFileStore (one JSON document per meeting under
 * userData/meetings/). The renderer drives all writes (debounced upserts of
 * the active meeting); the store validates, merges and persists. All store
 * logic lives in @repo/meetings-store so the standalone MCP server reads
 * the exact same data the app writes.
 */
export class MeetingsService extends MeetingFileStore {
  registerIpc(): void {
    ipcMain.handle(MEETINGS_LIST_CHANNEL, () => this.list())
    ipcMain.handle(MEETINGS_GET_CHANNEL, (_event, id: unknown) => this.get(String(id)))
    ipcMain.handle(MEETINGS_UPSERT_CHANNEL, (_event, patch: unknown) =>
      this.upsert((patch ?? {}) as MeetingUpsert)
    )
    ipcMain.handle(MEETINGS_DELETE_CHANNEL, (_event, id: unknown) => this.delete(String(id)))
    ipcMain.handle(MEETINGS_SEARCH_CHANNEL, (_event, query: unknown) =>
      this.search(String(query ?? ''))
    )
  }
}
