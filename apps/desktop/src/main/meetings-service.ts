import { rendererMeetingPatch } from './meeting-write-ownership'
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
 * the selected library's meetings directory). Main capture/import services own
 * transcripts; renderer upserts edit notes and metadata. All store
 * logic lives in @repo/meetings-store so the standalone MCP server reads
 * the exact same data the app writes.
 */
export class MeetingsService extends MeetingFileStore {
  rendererUpsert(patch: MeetingUpsert): ReturnType<MeetingFileStore['upsert']> {
    return this.upsert(rendererMeetingPatch(patch))
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
