import type { FinalizedMeetingEvent } from "./types";

/**
 * Deterministic markdown rendering for the GBrain second-brain repo.
 * Same event → byte-identical files, so server-side upserts by path are
 * safe under retries. Paths are relative to the GBrain doodlenote source
 * root (brain/09-raw-sources/doodlenote/); `ingested_at` frontmatter is
 * added SERVER-side at commit time (see GBRAIN_ENDPOINT_SPEC.md).
 */

export interface GBrainFile {
  path: string;
  content: string;
}

export interface GBrainPayload {
  schema_version: 1;
  source: "DoodleNote";
  doodlenote_id: string;
  content_hash: string;
  files: GBrainFile[];
  /** Data the server needs to maintain meeting-index.md. */
  index: {
    doodlenote_id: string;
    title: string;
    date: string;
    meeting_path: string;
    summary_path: string;
    duration_min?: number;
  };
}

/** "Quarterly Budget: Review!" → "quarterly-budget-review" (max 50 chars). */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug || "untitled";
}

/** YYYYMMDD in UTC from the meeting's start (or creation) time. */
export function fileDate(event: FinalizedMeetingEvent): string {
  const iso = event.meeting.started_at ?? event.meeting.created_at;
  return iso.slice(0, 10).replaceAll("-", "");
}

export function buildGBrainPayload(
  event: FinalizedMeetingEvent,
): GBrainPayload {
  const base = `${fileDate(event)}-${slugify(event.meeting.title)}-${event.meeting.id}`;
  const meetingPath = `meetings/${base}.md`;
  const summaryPath = `meeting-summaries/${base}-summary.md`;
  return {
    schema_version: 1,
    source: "DoodleNote",
    doodlenote_id: event.meeting.id,
    content_hash: event.content_hash,
    files: [
      { path: meetingPath, content: renderMeetingDoc(event) },
      { path: summaryPath, content: renderSummaryDoc(event) },
    ],
    index: {
      doodlenote_id: event.meeting.id,
      title: event.meeting.title || "Untitled meeting",
      date: event.meeting.started_at ?? event.meeting.created_at,
      meeting_path: meetingPath,
      summary_path: summaryPath,
      ...(event.meeting.duration_min !== undefined
        ? { duration_min: event.meeting.duration_min }
        : {}),
    },
  };
}

function frontmatter(event: FinalizedMeetingEvent, sourceKind: string): string {
  const m = event.meeting;
  const lines = [
    "---",
    "source: DoodleNote",
    `source_kind: ${sourceKind}`,
    `doodlenote_id: ${m.id}`,
    `title: ${yamlString(m.title || "Untitled meeting")}`,
    `created_at: ${m.created_at}`,
    ...(m.started_at ? [`started_at: ${m.started_at}`] : []),
    ...(m.ended_at ? [`ended_at: ${m.ended_at}`] : []),
    ...(m.calendar_event_id
      ? [`calendar_event_id: ${yamlString(m.calendar_event_id)}`]
      : []),
    ...(m.folder ? [`folder: ${yamlString(m.folder)}`] : []),
    `content_hash: ${event.content_hash}`,
    "---",
  ];
  return lines.join("\n");
}

/** Quote a YAML scalar safely (titles can contain anything). */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderMeetingDoc(event: FinalizedMeetingEvent): string {
  const m = event.meeting;
  const kind =
    m.kind === "note" ? "doodlenote-quick-note" : "doodlenote-meeting";
  const parts = [
    frontmatter(event, kind),
    "",
    `# ${m.title || "Untitled meeting"}`,
    "",
  ];
  if (event.notes.raw_markdown.trim()) {
    parts.push("## My notes", "", event.notes.raw_markdown.trim(), "");
  }
  if (event.transcript.segments.length > 0) {
    parts.push("## Transcript", "", event.transcript.text, "");
  }
  return parts.join("\n");
}

function renderSummaryDoc(event: FinalizedMeetingEvent): string {
  const m = event.meeting;
  const kind =
    m.kind === "note"
      ? "doodlenote-quick-note-summary"
      : "doodlenote-meeting-summary";
  return [
    frontmatter(event, kind),
    "",
    `# ${m.title || "Untitled meeting"} — summary`,
    "",
    event.notes.enhanced_markdown.trim(),
    "",
  ].join("\n");
}
