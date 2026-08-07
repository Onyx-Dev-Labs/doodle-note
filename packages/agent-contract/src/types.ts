/**
 * The versioned wire contract for agent access to DoodleNote meetings.
 *
 * Every surface that exposes meetings to AI agents — the standalone local
 * MCP server (reads the on-disk store) and the hosted MCP/API (reads the
 * cloud database) — registers the SAME tools with the SAME argument and
 * response shapes, defined here. Wire fields are snake_case and decoupled
 * from internal model types so either backend can evolve independently.
 *
 * Source implementations MUST:
 *  - exclude trashed meetings entirely,
 *  - exclude echo-flagged transcript segments (consistent with the app),
 *  - be read-only.
 */

/** Bump when a response shape changes incompatibly. */
export const AGENT_SCHEMA_VERSION = 1;

export interface AgentMeetingSummary {
  meeting_id: string;
  /** "meeting" or standalone quick "note". */
  kind: "meeting" | "note";
  title: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  duration_min?: number;
  has_notes: boolean;
  has_transcript: boolean;
  calendar_event_id?: string;
}

export interface AgentSearchResult extends AgentMeetingSummary {
  /** Strongest matching field: title > notes > transcript. */
  matched_field: "title" | "notes" | "transcript";
}

export interface AgentMeetingNotes {
  meeting_id: string;
  title: string;
  /** The user's own rough notes (markdown). */
  raw_notes_markdown: string;
  /** AI-generated notes (markdown); absent if never generated. */
  enhanced_markdown?: string;
  /** Which engine generated enhanced_markdown, e.g. "local:qwen3-4b-instruct". */
  generated_with?: string;
}

export interface AgentTranscriptSegment {
  /** Display label: a real name when known, else "You" / "Them". */
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface AgentTranscript {
  meeting_id: string;
  title: string;
  segments: AgentTranscriptSegment[];
  /** The transcript rendered as "Speaker: text" lines, ready for prompting. */
  text: string;
  duration_min?: number;
}

/**
 * The data interface a backend implements to serve the agent tools.
 * Local: MeetingFileStore. Hosted: org-scoped SQL. Async throughout so
 * either fits. Return null for unknown/trashed meeting ids.
 */
export interface MeetingSource {
  listRecent(limit: number): Promise<AgentMeetingSummary[]>;
  search(query: string, limit: number): Promise<AgentSearchResult[]>;
  getMeeting(meetingId: string): Promise<AgentMeetingSummary | null>;
  getNotes(meetingId: string): Promise<AgentMeetingNotes | null>;
  getTranscript(meetingId: string): Promise<AgentTranscript | null>;
}
