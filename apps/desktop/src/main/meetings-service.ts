import { libraryIpc } from './library-ipc'
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
  // Main owns a captured meeting's transcript, including delayed renderer writes after Stop.
  // Notes, title and speaker edits remain renderer-owned. Retranscription writes directly.
  private capturedMeetings = new Set<string>()
  ownCapture(id: string): void {
    this.capturedMeetings.add(id)
  }
  rendererUpsert(patch: MeetingUpsert): ReturnType<MeetingFileStore['upsert']> {
    if (patch.id && this.capturedMeetings.has(patch.id)) {
      const notes = { ...patch }
      delete notes.segments
      delete notes.echoSuppressed
      return this.upsert(notes)
    }
    return this.upsert(patch)
  }
  registerIpc(): void {
    libraryIpc.handle(MEETINGS_LIST_CHANNEL, () => this.list())
    libraryIpc.handle(MEETINGS_GET_CHANNEL, (_event, id: unknown) => this.get(String(id)))
    libraryIpc.handle(MEETINGS_UPSERT_CHANNEL, (_event, patch: unknown) =>
      this.rendererUpsert((patch ?? {}) as MeetingUpsert)
    )
    libraryIpc.handle(MEETINGS_DELETE_CHANNEL, (_event, id: unknown) => this.delete(String(id)))
    libraryIpc.handle(MEETINGS_SEARCH_CHANNEL, (_event, query: unknown) =>
      this.search(String(query ?? ''))
    )
  }
}
