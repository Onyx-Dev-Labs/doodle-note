/**
 * Shared meetings-store IPC contract, used by main + preload + renderer.
 *
 * The main process owns the on-disk store (userData/meetings/<id>.json);
 * the renderer owns the *active* meeting document and upserts it as the
 * user types / records / enhances. TranscriptSession's sessions/*.json
 * backups are unrelated and stay as-is.
 */

import type { TranscriptSegment } from './engine-events'

export const MEETINGS_LIST_CHANNEL = 'meetings:list'
export const MEETINGS_GET_CHANNEL = 'meetings:get'
export const MEETINGS_UPSERT_CHANNEL = 'meetings:upsert'
export const MEETINGS_DELETE_CHANNEL = 'meetings:delete'

/** One persisted "ask anything" exchange. */
export interface MeetingChatEntry {
  question: string
  answer: string
  /** ISO timestamp of when the question was asked. */
  askedAt: string
}

/** Full meeting document as stored on disk. */
export interface MeetingRecord {
  id: string
  /**
   * What this document is: a meeting (default when absent) or a standalone
   * quick note ("+ New note" — same editor and optional recording, but
   * created without a meeting context and never auto-recorded).
   */
  kind?: 'meeting' | 'note'
  title: string
  /** ISO timestamp of creation ("+ New meeting"). */
  createdAt: string
  /** ISO timestamp of the first live-capture start, if any. */
  startedAt?: string
  /** ISO timestamp of the last live-capture end, if any. */
  endedAt?: string
  /** The user's rough notes (TipTap doc serialized to markdown). */
  rawNotesMarkdown: string
  /** AI-merged notes, present after a successful Enhance run. */
  enhancedMarkdown?: string
  /** Which notes engine produced enhancedMarkdown (e.g. "local:…"). */
  engine?: string
  /** Note template used for Generate notes; absent = "general". */
  templateId?: string
  /** Interleaved You/Them transcript segments (echo-flagged ones excluded). */
  segments: TranscriptSegment[]
  /** How many echo segments were suppressed across the session(s). */
  echoSuppressed: number
  /** "Ask anything" conversation for this meeting, oldest first. */
  chat?: MeetingChatEntry[]
  /** Folder assignment; null/absent = unfiled ("My notes"). */
  folderId?: string | null
  /** ISO timestamp of the move to trash; null/absent = not trashed. */
  trashedAt?: string | null
  /** Microsoft 365 event id when created from a calendar prompt (dedupe key). */
  calendarEventId?: string
}

/** Lightweight row for the Home list, sorted newest-first. */
export interface MeetingSummary {
  id: string
  /** "note" marks standalone quick notes; absent = meeting. */
  kind?: 'meeting' | 'note'
  title: string
  createdAt: string
  startedAt?: string
  /** Recorded length in whole minutes, when derivable. */
  durationMin?: number
  /** Folder assignment; null/absent = unfiled ("My notes"). */
  folderId?: string | null
  /** ISO timestamp of the move to trash; null/absent = not trashed. */
  trashedAt?: string | null
  /** Microsoft 365 event id when created from a calendar prompt (dedupe key). */
  calendarEventId?: string
}

/** Partial update; `id` is required, omitted fields keep their stored value. */
export type MeetingUpsert = Partial<Omit<MeetingRecord, 'id'>> & { id: string }

/** API surface exposed on `window.meetings` by the preload script. */
export interface MeetingsApi {
  list(): Promise<MeetingSummary[]>
  get(id: string): Promise<MeetingRecord | null>
  upsert(meeting: MeetingUpsert): Promise<MeetingRecord>
  delete(id: string): Promise<void>
}
