import { createHash } from "node:crypto";
import { durationMinOf, spokenSegments } from "@repo/meetings-store";
import type { MeetingRecord } from "@repo/meetings-store";
import type { FinalizedMeetingEvent } from "./types";

/** A meeting is finalized once AI notes exist and it isn't trashed. */
export function isFinalized(record: MeetingRecord): boolean {
  return !record.trashedAt && Boolean(record.enhancedMarkdown?.trim());
}

/**
 * Hash of the content a destination would store. Field order is fixed and
 * volatile fields (chat, folder, engine) are excluded, so the hash is stable
 * across retries and only changes when exported content actually changes.
 */
export function contentHashOf(record: MeetingRecord): string {
  const segments = spokenSegments(record).map((s) => [
    s.speaker,
    s.text,
    s.startMs,
    s.endMs,
  ]);
  const material = JSON.stringify([
    record.id,
    record.kind === "note" ? "note" : "meeting",
    record.title,
    record.createdAt,
    record.startedAt ?? "",
    record.endedAt ?? "",
    record.calendarEventId ?? "",
    record.rawNotesMarkdown,
    record.enhancedMarkdown ?? "",
    segments,
  ]);
  return createHash("sha256").update(material).digest("hex");
}

export function buildFinalizedEvent(
  record: MeetingRecord,
  opts: { folderName?: string; finalizedAt?: string } = {},
): FinalizedMeetingEvent {
  if (!isFinalized(record)) {
    throw new Error(
      `Meeting ${record.id} is not finalized (no generated notes or trashed).`,
    );
  }
  const segments = spokenSegments(record);
  return {
    schema_version: 1,
    meeting: {
      id: record.id,
      kind: record.kind === "note" ? "note" : "meeting",
      title: record.title,
      created_at: record.createdAt,
      ...(record.startedAt ? { started_at: record.startedAt } : {}),
      ...(record.endedAt ? { ended_at: record.endedAt } : {}),
      ...(durationMinOf(record) !== undefined
        ? { duration_min: durationMinOf(record) }
        : {}),
      ...(record.calendarEventId
        ? { calendar_event_id: record.calendarEventId }
        : {}),
      ...(opts.folderName ? { folder: opts.folderName } : {}),
    },
    notes: {
      raw_markdown: record.rawNotesMarkdown,
      enhanced_markdown: record.enhancedMarkdown ?? "",
    },
    transcript: {
      segments: segments.map((s) => ({
        speaker: s.speaker,
        text: s.text,
        start_ms: s.startMs,
        end_ms: s.endMs,
      })),
      text: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
    },
    content_hash: contentHashOf(record),
    finalized_at: opts.finalizedAt ?? new Date().toISOString(),
  };
}
