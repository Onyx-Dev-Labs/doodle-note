/**
 * Shared meetings-store IPC contract, used by main + preload + renderer.
 *
 * The main process owns the on-disk store (userData/meetings/<id>.json);
 * the renderer owns the *active* meeting document and upserts it as the
 * user types / records / enhances. TranscriptSession's sessions/*.json
 * backups are unrelated and stay as-is.
 *
 * The data model itself lives in @repo/meetings-store (shared with the
 * standalone MCP server and connector exports); the type re-exports below
 * keep existing imports working and are erased at build time.
 */

import type {
  MeetingRecord,
  MeetingSearchHit,
  MeetingSummary,
  MeetingUpsert
} from '@repo/meetings-store/types'

export type {
  MeetingChatEntry,
  MeetingRecord,
  MeetingSummary,
  MeetingUpsert,
  MeetingSearchHit
} from '@repo/meetings-store/types'

export const MEETINGS_LIST_CHANNEL = 'meetings:list'
export const MEETINGS_GET_CHANNEL = 'meetings:get'
export const MEETINGS_UPSERT_CHANNEL = 'meetings:upsert'
export const MEETINGS_SEARCH_CHANNEL = 'meetings:search'
export const MEETINGS_DELETE_CHANNEL = 'meetings:delete'
/** main → renderer: the store changed outside the renderer (cloud pull). */
export const MEETINGS_CHANGED_EVENT_CHANNEL = 'meetings:changed-event'

/** API surface exposed on `window.meetings` by the preload script. */
export interface MeetingsApi {
  /** Case-insensitive search across titles, notes, and transcripts. */
  search(query: string): Promise<MeetingSearchHit[]>
  list(): Promise<MeetingSummary[]>
  get(id: string): Promise<MeetingRecord | null>
  upsert(meeting: MeetingUpsert): Promise<MeetingRecord>
  /** Fires when cloud sync imports/updates/trashes meetings — refetch lists. */
  onChanged(cb: () => void): () => void
  delete(id: string): Promise<void>
}
