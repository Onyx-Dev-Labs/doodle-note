import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  MeetingChatEntry,
  MeetingRecord,
  MeetingSearchHit,
  MeetingSummary,
  MeetingUpsert,
  TranscriptSegment,
} from "./types";

/** Meeting ids are renderer-minted UUIDs; anything else never touches disk. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/**
 * The meetings store: one JSON document per meeting under a directory the
 * caller owns (the Electron app passes userData/meetings). Pure Node — no
 * Electron imports — so the standalone MCP server and tests can read the
 * same store the app writes.
 */
export class MeetingFileStore {
  /**
   * Post-write hook (cloud sync, connector dispatch): fires after any
   * persisted change. `deletedId` is set when a meeting was hard-deleted or
   * moved to trash — both mean its cloud copy (if any) should go away.
   */
  onDidWrite: ((change: { deletedId?: string }) => void) | null = null;

  constructor(readonly dir: string) {}

  /* ---- queries ---- */

  list(): MeetingSummary[] {
    const summaries: MeetingSummary[] = [];
    for (const file of this.listFiles()) {
      const record = this.readFile(file);
      if (!record) continue;
      summaries.push({
        id: record.id,
        ...(record.kind === "note" ? { kind: "note" as const } : {}),
        title: record.title,
        createdAt: record.createdAt,
        ...(record.startedAt ? { startedAt: record.startedAt } : {}),
        ...(durationMinOf(record) !== undefined
          ? { durationMin: durationMinOf(record) }
          : {}),
        ...(record.folderId ? { folderId: record.folderId } : {}),
        ...(record.trashedAt ? { trashedAt: record.trashedAt } : {}),
        ...(record.calendarEventId
          ? { calendarEventId: record.calendarEventId }
          : {}),
      });
    }
    // Newest first; createdAt is ISO so string compare sorts chronologically.
    summaries.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    return summaries;
  }

  get(id: string): MeetingRecord | null {
    if (!SAFE_ID.test(id)) return null;
    return this.readFile(`${id}.json`);
  }

  /**
   * Every stored meeting document, trashed ones included (callers filter).
   * Powers cross-meeting features in other services — e.g. NotesService
   * gathering context for the Home-level "ask anything".
   */
  readAll(): MeetingRecord[] {
    const records: MeetingRecord[] = [];
    for (const file of this.listFiles()) {
      const record = this.readFile(file);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Case-insensitive substring search across every stored document. A few
   * hundred JSON files scan in single-digit milliseconds — no index needed
   * at this scale. Reports the strongest matching field per meeting
   * (title > notes > transcript) so the UI can hint where the hit was.
   */
  search(query: string): MeetingSearchHit[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const hits: MeetingSearchHit[] = [];
    for (const record of this.readAll()) {
      if ((record.title || "").toLowerCase().includes(q)) {
        hits.push({ id: record.id, field: "title" });
      } else if (
        record.rawNotesMarkdown.toLowerCase().includes(q) ||
        (record.enhancedMarkdown ?? "").toLowerCase().includes(q)
      ) {
        hits.push({ id: record.id, field: "notes" });
      } else if (
        record.segments.some((s) => s.text.toLowerCase().includes(q))
      ) {
        hits.push({ id: record.id, field: "transcript" });
      }
    }
    return hits;
  }

  /* ---- writes ---- */

  upsert(patch: MeetingUpsert): MeetingRecord {
    const id = typeof patch.id === "string" ? patch.id : "";
    if (!SAFE_ID.test(id)) {
      throw new Error(`Invalid meeting id: ${JSON.stringify(patch.id)}`);
    }
    const existing = this.get(id);
    const merged = normalizeRecord({ ...(existing ?? {}), ...patch, id });
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${id}.json`),
      JSON.stringify(merged, null, 2),
    );
    this.onDidWrite?.(merged.trashedAt ? { deletedId: id } : {});
    return merged;
  }

  delete(id: string): void {
    if (!SAFE_ID.test(id)) return;
    rmSync(join(this.dir, `${id}.json`), { force: true });
    this.onDidWrite?.({ deletedId: id });
  }

  /* ---- disk ---- */

  private listFiles(): string[] {
    try {
      return readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    } catch {
      return []; // dir doesn't exist yet — no meetings
    }
  }

  private readFile(name: string): MeetingRecord | null {
    try {
      const raw = JSON.parse(
        readFileSync(join(this.dir, name), "utf8"),
      ) as Partial<MeetingRecord>;
      if (typeof raw.id !== "string" || !SAFE_ID.test(raw.id)) return null;
      return normalizeRecord(raw as MeetingUpsert);
    } catch {
      return null; // unreadable/corrupt file — skip rather than crash the list
    }
  }
}

/** Fill defaults so every stored/returned record has the full shape. */
export function normalizeRecord(raw: MeetingUpsert): MeetingRecord {
  return {
    id: raw.id,
    // Only "note" is stored; anything else normalizes to the meeting default.
    ...(raw.kind === "note" ? { kind: "note" as const } : {}),
    title: typeof raw.title === "string" ? raw.title : "",
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
    ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.endedAt === "string" ? { endedAt: raw.endedAt } : {}),
    rawNotesMarkdown:
      typeof raw.rawNotesMarkdown === "string" ? raw.rawNotesMarkdown : "",
    ...(typeof raw.enhancedMarkdown === "string"
      ? { enhancedMarkdown: raw.enhancedMarkdown }
      : {}),
    ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}),
    ...(typeof raw.templateId === "string" && raw.templateId.length > 0
      ? { templateId: raw.templateId }
      : {}),
    segments: Array.isArray(raw.segments)
      ? (raw.segments as TranscriptSegment[])
      : [],
    echoSuppressed:
      typeof raw.echoSuppressed === "number" ? raw.echoSuppressed : 0,
    ...(Array.isArray(raw.chat) ? { chat: raw.chat.filter(isChatEntry) } : {}),
    // A null (or invalid) value drops the field — that's how "move back to
    // My notes" (folderId: null) and "restore from trash" (trashedAt: null)
    // clear state through the { ...existing, ...patch } merge above.
    ...(typeof raw.folderId === "string" && raw.folderId.length > 0
      ? { folderId: raw.folderId }
      : {}),
    ...(isIsoString(raw.trashedAt) ? { trashedAt: raw.trashedAt } : {}),
    // Graph event ids are opaque and can be long — validate shape, cap length.
    ...(typeof raw.calendarEventId === "string" &&
    raw.calendarEventId.length > 0 &&
    raw.calendarEventId.length <= 512
      ? { calendarEventId: raw.calendarEventId }
      : {}),
  };
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isChatEntry(entry: unknown): entry is MeetingChatEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Partial<MeetingChatEntry>;
  return (
    typeof e.question === "string" &&
    typeof e.answer === "string" &&
    typeof e.askedAt === "string"
  );
}

/**
 * Segments as anything outside the app should see them: echo-flagged ones
 * dropped (the store already excludes them on write, but every reader
 * filters defensively — the app's display layer does the same), ordered by
 * wall clock across the two channels.
 */
export function spokenSegments(record: MeetingRecord): TranscriptSegment[] {
  return record.segments
    .filter((s) => !s.echo)
    .slice()
    .sort(
      (a, b) =>
        (a.absoluteStartMs ?? a.startMs) - (b.absoluteStartMs ?? b.startMs),
    );
}

export function durationMinOf(record: MeetingRecord): number | undefined {
  if (record.startedAt && record.endedAt) {
    const ms = Date.parse(record.endedAt) - Date.parse(record.startedAt);
    if (Number.isFinite(ms) && ms > 0)
      return Math.max(1, Math.round(ms / 60_000));
  }
  if (record.segments.length > 0) {
    const ms = Math.max(...record.segments.map((s) => s.endMs));
    if (Number.isFinite(ms) && ms > 0)
      return Math.max(1, Math.round(ms / 60_000));
  }
  return undefined;
}
