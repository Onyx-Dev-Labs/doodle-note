/**
 * The meeting data model shared by every process that touches the store:
 * the Electron app (main + preload + renderer), cloud sync, the standalone
 * MCP server, and connector exports. Extracted from the desktop app so
 * non-Electron consumers never import Electron code.
 */

/** Which capture channel a segment came from. */
export type MeetingChannel = "mic" | "system";

export interface TranscriptSegment {
  id: string;
  channel: MeetingChannel;
  /**
   * Display label for whoever spoke: a real name once known, otherwise the
   * channel default ("You" / "Them"). `speakerId` is the stable identity —
   * renaming a speaker rewrites every label sharing that id.
   */
  speaker: string;
  /** Stable speaker key; absent on segments recorded before speaker ids. */
  speakerId?: string;
  text: string;
  /** Milliseconds relative to this channel's stream start. */
  startMs: number;
  endMs: number;
  /** Mean token confidence 0..1. */
  confidence: number;
  /** Wall-clock ms (channel epoch + startMs); present once channel_start arrived. */
  absoluteStartMs?: number;
  /** True when the segment was judged to be far-side audio bleeding into the mic. */
  echo?: boolean;
}

/** How a participant's name was established (weakest to strongest). */
export type ParticipantSource =
  | "self"
  | "calendar"
  | "context"
  | "dictionary"
  | "manual";

/** One identified person in a meeting; `id` matches `TranscriptSegment.speakerId`. */
export interface MeetingParticipant {
  id: string;
  name: string;
  email?: string;
  source: ParticipantSource;
  /** 0..1 confidence in the name; manual assignments are 1. */
  confidence: number;
}

/** One persisted "ask anything" exchange. */
export interface MeetingChatEntry {
  question: string;
  answer: string;
  /** ISO timestamp of when the question was asked. */
  askedAt: string;
}

/** Full meeting document as stored on disk. */
export interface MeetingRecord {
  id: string;
  /**
   * What this document is: a meeting (default when absent) or a standalone
   * quick note ("+ New note" — same editor and optional recording, but
   * created without a meeting context and never auto-recorded).
   */
  kind?: "meeting" | "note";
  title: string;
  /** ISO timestamp of creation ("+ New meeting"). */
  createdAt: string;
  /** ISO timestamp of the first live-capture start, if any. */
  startedAt?: string;
  /** ISO timestamp of the last live-capture end, if any. */
  endedAt?: string;
  /** The user's rough notes (TipTap doc serialized to markdown). */
  rawNotesMarkdown: string;
  /** AI-merged notes, present after a successful Enhance run. */
  enhancedMarkdown?: string;
  /** Which notes engine produced enhancedMarkdown (e.g. "local:…"). */
  engine?: string;
  /** Note template used for Generate notes; absent = "general". */
  templateId?: string;
  /** Interleaved You/Them transcript segments (echo-flagged ones excluded). */
  segments: TranscriptSegment[];
  /** Known speakers, keyed by the ids segments carry; absent = nobody named. */
  participants?: MeetingParticipant[];
  /** How many echo segments were suppressed across the session(s). */
  echoSuppressed: number;
  /** "Ask anything" conversation for this meeting, oldest first. */
  chat?: MeetingChatEntry[];
  /** Folder assignment; null/absent = unfiled ("My notes"). */
  folderId?: string | null;
  /** ISO timestamp of the move to trash; null/absent = not trashed. */
  trashedAt?: string | null;
  /** Microsoft 365 event id when created from a calendar prompt (dedupe key). */
  calendarEventId?: string;
}

/** Lightweight row for the Home list, sorted newest-first. */
export interface MeetingSummary {
  id: string;
  /** "note" marks standalone quick notes; absent = meeting. */
  kind?: "meeting" | "note";
  title: string;
  createdAt: string;
  startedAt?: string;
  /** Recorded length in whole minutes, when derivable. */
  durationMin?: number;
  /** Folder assignment; null/absent = unfiled ("My notes"). */
  folderId?: string | null;
  /** ISO timestamp of the move to trash; null/absent = not trashed. */
  trashedAt?: string | null;
  /** Microsoft 365 event id when created from a calendar prompt (dedupe key). */
  calendarEventId?: string;
}

/** Partial update; `id` is required, omitted fields keep their stored value. */
export type MeetingUpsert = Partial<Omit<MeetingRecord, "id">> & { id: string };

/** Where a full-text search query matched (strongest field reported). */
export interface MeetingSearchHit {
  id: string;
  field: "title" | "notes" | "transcript";
}
