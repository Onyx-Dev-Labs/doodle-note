import type {
  AgentMeetingNotes,
  AgentMeetingSummary,
  AgentSearchResult,
  AgentTranscript,
  MeetingSource,
} from "@repo/agent-contract";
import {
  and,
  asc,
  desc,
  eq,
  meetings,
  notes,
  or,
  sql,
  transcriptSegments,
  type Db,
} from "@repo/db";

/**
 * MeetingSource backed by the cloud database — the hosted twin of the local
 * MCP server's file-store source. Every query is scoped to ONE workspace
 * (organizationId from the agent token), which is the tenant-isolation
 * boundary: an agent can never see another workspace's meetings. Cloud rows
 * only exist for non-trashed meetings (deletion removes the row), and
 * pushed segments already exclude echo-flagged ones, so both invariants of
 * the contract hold by construction.
 */
export class CloudMeetingSource implements MeetingSource {
  constructor(
    private readonly db: Db,
    private readonly organizationId: string,
  ) {}

  async listRecent(limit: number): Promise<AgentMeetingSummary[]> {
    const rows = await this.baseSelect()
      .where(eq(meetings.organizationId, this.organizationId))
      .orderBy(desc(meetings.createdAt))
      .limit(limit);
    return rows.map((r) => toSummary(r));
  }

  async search(query: string, limit: number): Promise<AgentSearchResult[]> {
    const pattern = `%${escapeLike(query)}%`;
    const titleMatch = sql`${meetings.title} ilike ${pattern}`;
    const notesMatch = sql`(coalesce(${notes.rawContent}->>'markdown', '') ilike ${pattern} or coalesce(${notes.enhancedContent}->>'markdown', '') ilike ${pattern})`;
    const transcriptMatch = sql`exists (select 1 from ${transcriptSegments} ts where ts.meeting_id = ${meetings.id} and ts.text ilike ${pattern})`;
    const rows = await this.baseSelect({
      matchedField: sql<string>`case when ${titleMatch} then 'title' when ${notesMatch} then 'notes' else 'transcript' end`,
    })
      .where(
        and(
          eq(meetings.organizationId, this.organizationId),
          or(titleMatch, notesMatch, transcriptMatch),
        ),
      )
      .orderBy(desc(meetings.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...toSummary(r),
      matched_field: normalizeField(
        (r as { matchedField?: unknown }).matchedField,
      ),
    }));
  }

  async getMeeting(meetingId: string): Promise<AgentMeetingSummary | null> {
    const row = await this.getOwnRow(meetingId);
    return row ? toSummary(row) : null;
  }

  async getNotes(meetingId: string): Promise<AgentMeetingNotes | null> {
    const row = await this.getOwnRow(meetingId);
    if (!row) return null;
    const enhanced = markdownOf(row.enhancedContent);
    return {
      meeting_id: row.id,
      title: row.title,
      raw_notes_markdown: markdownOf(row.rawContent) ?? "",
      ...(enhanced ? { enhanced_markdown: enhanced } : {}),
    };
  }

  async getTranscript(meetingId: string): Promise<AgentTranscript | null> {
    const row = await this.getOwnRow(meetingId);
    if (!row) return null;
    const segmentRows = await this.db
      .select({
        speaker: transcriptSegments.speaker,
        text: transcriptSegments.text,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(asc(transcriptSegments.startMs));
    const segments = segmentRows.map((s) => ({
      speaker: s.speaker === "Them" ? ("Them" as const) : ("You" as const),
      text: s.text,
      start_ms: s.startMs,
      end_ms: s.endMs,
    }));
    const duration = durationMin(row, segments.at(-1)?.end_ms);
    return {
      meeting_id: row.id,
      title: row.title,
      segments,
      text: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      ...(duration !== undefined ? { duration_min: duration } : {}),
    };
  }

  /* ---- shared query shapes ---- */

  /** Meeting row + notes envelopes + a has-transcript flag in one select. */
  private baseSelect(extra: Record<string, ReturnType<typeof sql>> = {}) {
    return this.db
      .select({
        id: meetings.id,
        kind: meetings.kind,
        title: meetings.title,
        createdAt: meetings.createdAt,
        startedAt: meetings.startedAt,
        endedAt: meetings.endedAt,
        calendarEventId: meetings.calendarEventId,
        rawContent: notes.rawContent,
        enhancedContent: notes.enhancedContent,
        hasTranscript: sql<boolean>`exists (select 1 from ${transcriptSegments} ts where ts.meeting_id = ${meetings.id})`,
        ...extra,
      })
      .from(meetings)
      .leftJoin(notes, eq(notes.meetingId, meetings.id));
  }

  private async getOwnRow(meetingId: string): Promise<MeetingRow | null> {
    if (!UUID_RE.test(meetingId)) return null;
    const rows = await this.baseSelect()
      .where(
        and(
          eq(meetings.id, meetingId),
          eq(meetings.organizationId, this.organizationId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MeetingRow {
  id: string;
  kind: "meeting" | "note";
  title: string;
  createdAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  calendarEventId: string | null;
  rawContent: unknown;
  enhancedContent: unknown;
  hasTranscript: boolean;
}

/** Escape LIKE wildcards so a query of "100%" matches literally. */
function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function markdownOf(envelope: unknown): string | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const md = (envelope as { markdown?: unknown }).markdown;
  return typeof md === "string" && md.length > 0 ? md : null;
}

function normalizeField(value: unknown): "title" | "notes" | "transcript" {
  return value === "title" || value === "notes" ? value : "transcript";
}

function durationMin(row: MeetingRow, lastEndMs?: number): number | undefined {
  if (row.startedAt && row.endedAt) {
    const ms = row.endedAt.getTime() - row.startedAt.getTime();
    if (Number.isFinite(ms) && ms > 0) return Math.max(1, Math.round(ms / 60_000));
  }
  if (typeof lastEndMs === "number" && lastEndMs > 0) {
    return Math.max(1, Math.round(lastEndMs / 60_000));
  }
  return undefined;
}

function toSummary(row: MeetingRow): AgentMeetingSummary {
  const raw = markdownOf(row.rawContent);
  const enhanced = markdownOf(row.enhancedContent);
  const duration = durationMin(row);
  return {
    meeting_id: row.id,
    kind: row.kind === "note" ? "note" : "meeting",
    title: row.title,
    created_at: (row.createdAt ?? new Date()).toISOString(),
    ...(row.startedAt ? { started_at: row.startedAt.toISOString() } : {}),
    ...(row.endedAt ? { ended_at: row.endedAt.toISOString() } : {}),
    ...(duration !== undefined ? { duration_min: duration } : {}),
    has_notes: Boolean(raw?.trim() || enhanced?.trim()),
    has_transcript: Boolean(row.hasTranscript),
    ...(row.calendarEventId ? { calendar_event_id: row.calendarEventId } : {}),
  };
}
