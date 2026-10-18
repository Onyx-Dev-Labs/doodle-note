import {
  localSourceScope,
  sameScope,
  searchOriginalSources,
  resolveOriginalSource,
} from "@repo/meetings-store/sources";
import type {
  SourceAnchor,
  SourceContext,
  SourceResolution,
  SourceSearchResult,
} from "@repo/meetings-store/source-contract";
import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentMeetingNotes,
  AgentMeetingSummary,
  AgentSearchResult,
  AgentTranscript,
  MeetingSource,
} from "@repo/agent-contract";
import {
  MeetingFileStore,
  durationMinOf,
  spokenSegments,
} from "@repo/meetings-store";
import type { MeetingRecord } from "@repo/meetings-store";

/**
 * MeetingSource backed by the local on-disk store the DoodleNote app writes.
 * Read-only by construction (only query methods are called), trashed
 * meetings are invisible, and echo-flagged segments are filtered the same
 * way the app's display layer filters them.
 */
export class LocalMeetingSource implements MeetingSource {
  constructor(private readonly meetingsDir: string | (() => string)) {}

  private get store(): MeetingFileStore {
    const dir =
      typeof this.meetingsDir === "function"
        ? this.meetingsDir()
        : this.meetingsDir;
    // Reload consent/path for each request. A running client must not continue
    // serving a stale recovery copy after the desktop library moves.
    return new MeetingFileStore(dir, () =>
      accessSync(dirname(dir), constants.R_OK),
    );
  }

  private sourceContext(): SourceContext {
    const dir = this.store.dir;
    return { meetingsDir: dir, scope: localSourceScope(dir), authorized: true };
  }

  /** Complete original-file scan: no SQLite writer, cache requirement or Node ABI dependency. */
  async retrieveSources(
    query: string,
    limit = 50,
  ): Promise<SourceSearchResult> {
    const context = this.sourceContext();
    const result = searchOriginalSources(context, query, limit);
    this.assertCurrentContext(context);
    return result;
  }

  async resolveSource(anchor: SourceAnchor): Promise<SourceResolution> {
    const context = this.sourceContext();
    const result = resolveOriginalSource(context, anchor);
    this.assertCurrentContext(context);
    return result;
  }

  private assertCurrentContext(context: SourceContext): void {
    if (JSON.stringify(context) !== JSON.stringify(this.sourceContext()))
      throw new Error("Local source scope changed during retrieval");
  }

  async listRecent(limit: number): Promise<AgentMeetingSummary[]> {
    return this.visibleRecords()
      .slice(0, limit)
      .map((r) => toSummary(r));
  }

  async search(query: string, limit: number): Promise<AgentSearchResult[]> {
    const hits = this.store.search(query);
    const results: AgentSearchResult[] = [];
    for (const hit of hits) {
      const record = this.getVisible(hit.id);
      if (!record) continue;
      results.push({ ...toSummary(record), matched_field: hit.field });
      if (results.length >= limit) break;
    }
    return results;
  }

  async getMeeting(meetingId: string): Promise<AgentMeetingSummary | null> {
    const record = this.getVisible(meetingId);
    return record ? toSummary(record) : null;
  }

  async getNotes(meetingId: string): Promise<AgentMeetingNotes | null> {
    const record = this.getVisible(meetingId);
    if (!record) return null;
    return {
      meeting_id: record.id,
      title: record.title,
      raw_notes_markdown: record.rawNotesMarkdown,
      ...(record.enhancedMarkdown
        ? { enhanced_markdown: record.enhancedMarkdown }
        : {}),
      ...(record.engine ? { generated_with: record.engine } : {}),
    };
  }

  async getTranscript(meetingId: string): Promise<AgentTranscript | null> {
    const record = this.getVisible(meetingId);
    if (!record) return null;
    const segments = spokenSegments(record);
    return {
      meeting_id: record.id,
      title: record.title,
      segments: segments.map((s) => ({
        segment_id: s.id,
        speaker: s.speaker,
        text: s.text,
        start_ms: s.startMs,
        end_ms: s.endMs,
      })),
      text: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      ...(durationMinOf(record) !== undefined
        ? { duration_min: durationMinOf(record) }
        : {}),
    };
  }

  /** All non-trashed records, newest first (createdAt is ISO — string sort works). */
  private visibleRecords(): MeetingRecord[] {
    const store = this.store;
    const scope = localSourceScope(store.dir);
    return store
      .readAll()
      .filter((r) => visibleInScope(r, scope))
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
  }

  private getVisible(id: string): MeetingRecord | null {
    const store = this.store;
    const record = store.get(id);
    return record && visibleInScope(record, localSourceScope(store.dir))
      ? record
      : null;
  }
}

function toSummary(record: MeetingRecord): AgentMeetingSummary {
  return {
    meeting_id: record.id,
    kind: record.kind === "note" ? "note" : "meeting",
    title: record.title,
    created_at: record.createdAt,
    ...(record.startedAt ? { started_at: record.startedAt } : {}),
    ...(record.endedAt ? { ended_at: record.endedAt } : {}),
    ...(durationMinOf(record) !== undefined
      ? { duration_min: durationMinOf(record) }
      : {}),
    has_notes: Boolean(
      record.rawNotesMarkdown.trim() || record.enhancedMarkdown?.trim(),
    ),
    has_transcript: record.segments.some((s) => !s.echo),
    ...(record.calendarEventId
      ? { calendar_event_id: record.calendarEventId }
      : {}),
  };
}

function visibleInScope(
  record: MeetingRecord,
  scope: SourceContext["scope"],
): boolean {
  return (
    !record.trashedAt &&
    (record.sourceScope === undefined ||
      Boolean(
        record.sourceScope &&
        typeof record.sourceScope === "object" &&
        sameScope(record.sourceScope, scope),
      ))
  );
}
