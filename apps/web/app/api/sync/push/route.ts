import { NextResponse } from "next/server";
import { and, eq, getDb, meetings, notes, transcriptSegments } from "@repo/db";

import { authenticateSyncRequest } from "@/lib/sync-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PushSegment {
  channel: "mic" | "system";
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

interface PushMeeting {
  id: string;
  title: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  calendarEventId?: string;
  rawNotesMarkdown?: string;
  enhancedMarkdown?: string;
  segments: PushSegment[];
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function markdownEnvelope(markdown: unknown): { format: string; markdown: string } | null {
  return typeof markdown === "string" && markdown.length > 0
    ? { format: "markdown", markdown }
    : null;
}

/**
 * Desktop → cloud push. Bearer-token authenticated (see sync_devices).
 * Upserts one meeting per request item: meeting row, full segment replace,
 * notes upsert. A meeting id owned by a different workspace is rejected.
 */
export async function POST(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }

  let body: { meetings?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray(body.meetings)
    ? (body.meetings as PushMeeting[])
    : [];
  if (items.length === 0 || items.length > 20) {
    return NextResponse.json(
      { error: "Expected 1-20 meetings per push" },
      { status: 400 },
    );
  }

  const db = getDb();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const item of items) {
    const id = String(item.id ?? "");
    if (!UUID_RE.test(id)) {
      results.push({ id, ok: false, error: "meeting id must be a UUID" });
      continue;
    }
    const createdAt = toDate(item.createdAt);
    if (!createdAt) {
      results.push({ id, ok: false, error: "createdAt must be ISO date" });
      continue;
    }

    try {
      // Ownership guard: an id that exists under another workspace is not ours.
      const existing = await db
        .select({ organizationId: meetings.organizationId })
        .from(meetings)
        .where(eq(meetings.id, id))
        .limit(1);
      if (existing[0] && existing[0].organizationId !== device.organizationId) {
        results.push({ id, ok: false, error: "id belongs to another workspace" });
        continue;
      }

      const row = {
        organizationId: device.organizationId,
        title: String(item.title ?? "").slice(0, 500) || "Untitled meeting",
        status: "complete" as const,
        calendarEventId:
          typeof item.calendarEventId === "string"
            ? item.calendarEventId.slice(0, 512)
            : null,
        startedAt: toDate(item.startedAt),
        endedAt: toDate(item.endedAt),
        createdAt,
        updatedAt: new Date(),
      };
      await db
        .insert(meetings)
        .values({ id, ...row })
        .onConflictDoUpdate({ target: meetings.id, set: row });

      // Segments: full replace keeps the cloud copy exactly mirroring local.
      await db
        .delete(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, id));
      const segments = (Array.isArray(item.segments) ? item.segments : [])
        .filter(
          (s) =>
            (s.channel === "mic" || s.channel === "system") &&
            typeof s.text === "string" &&
            Number.isFinite(s.startMs) &&
            Number.isFinite(s.endMs),
        )
        .slice(0, 5000)
        .map((s) => ({
          meetingId: id,
          channel: s.channel,
          speaker: String(s.speaker ?? "").slice(0, 40) || "You",
          text: s.text.slice(0, 10_000),
          startMs: Math.round(s.startMs),
          endMs: Math.round(s.endMs),
          confidence: Number.isFinite(s.confidence) ? s.confidence : null,
        }));
      if (segments.length > 0) {
        await db.insert(transcriptSegments).values(segments);
      }

      const rawContent = markdownEnvelope(item.rawNotesMarkdown);
      const enhancedContent = markdownEnvelope(item.enhancedMarkdown);
      await db
        .insert(notes)
        .values({ meetingId: id, rawContent, enhancedContent, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: notes.meetingId,
          set: { rawContent, enhancedContent, updatedAt: new Date() },
        });

      results.push({ id, ok: true });
    } catch (error) {
      results.push({
        id,
        ok: false,
        error: error instanceof Error ? error.message : "write failed",
      });
    }
  }

  return NextResponse.json({ results });
}

/** Meeting deletions propagate too: ids the desktop trashed or removed. */
export async function DELETE(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .map(String)
    .filter((id) => UUID_RE.test(id))
    .slice(0, 100);

  const db = getDb();
  for (const id of ids) {
    await db
      .delete(meetings)
      .where(
        and(eq(meetings.id, id), eq(meetings.organizationId, device.organizationId)),
      );
  }
  return NextResponse.json({ ok: true, deleted: ids.length });
}
