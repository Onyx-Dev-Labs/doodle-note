import { NextResponse } from "next/server";
import {
  and,
  asc,
  eq,
  folders,
  getDb,
  gt,
  inArray,
  meetings,
  notes,
  transcriptSegments,
} from "@repo/db";

import { authenticateEntitledSyncRequest } from "@/lib/sync-auth";

/** Meetings per page; the desktop loops while hasMore. */
const PAGE_SIZE = 50;

function markdownOf(envelope: unknown): string | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const md = (envelope as { markdown?: unknown }).markdown;
  return typeof md === "string" && md.length > 0 ? md : null;
}

/**
 * Cloud → desktop pull, the other half of two-way sync. Bearer-token
 * authenticated like push. Returns the workspace's meetings changed since
 * the `since` cursor (updatedAt ascending, paged) plus the complete id
 * list — the id list is how deletions propagate without tombstones: a
 * previously-synced id that is no longer present was deleted somewhere.
 */
export async function GET(request: Request) {
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const device = authed.device;

  const url = new URL(request.url);
  const sinceMs = Date.parse(url.searchParams.get("since") ?? "");
  const since = Number.isNaN(sinceMs) ? new Date(0) : new Date(sinceMs);

  const db = getDb();

  const idRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.organizationId, device.organizationId));
  const allIds = idRows.map((r) => r.id);

  // Folders are few — the full list ships every pull (renames + deletions).
  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.organizationId, device.organizationId));
  const allFolders = folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    createdAt: (f.createdAt ?? new Date()).toISOString(),
  }));

  const changedRows = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.organizationId, device.organizationId),
        gt(meetings.updatedAt, since),
      ),
    )
    .orderBy(asc(meetings.updatedAt))
    .limit(PAGE_SIZE + 1);
  const page = changedRows.slice(0, PAGE_SIZE);
  const hasMore = changedRows.length > PAGE_SIZE;

  const pageIds = page.map((m) => m.id);
  const noteRows = pageIds.length
    ? await db.select().from(notes).where(inArray(notes.meetingId, pageIds))
    : [];
  const notesByMeeting = new Map(noteRows.map((n) => [n.meetingId, n]));
  const segmentRows = pageIds.length
    ? await db
        .select()
        .from(transcriptSegments)
        .where(inArray(transcriptSegments.meetingId, pageIds))
        .orderBy(asc(transcriptSegments.startMs))
    : [];
  const segmentsByMeeting = new Map<string, typeof segmentRows>();
  for (const seg of segmentRows) {
    const list = segmentsByMeeting.get(seg.meetingId) ?? [];
    list.push(seg);
    segmentsByMeeting.set(seg.meetingId, list);
  }

  const changed = page.map((m) => {
    const note = notesByMeeting.get(m.id);
    return {
      id: m.id,
      title: m.title,
      createdAt: (m.createdAt ?? new Date()).toISOString(),
      updatedAt: (m.updatedAt ?? new Date()).toISOString(),
      ...(m.startedAt ? { startedAt: m.startedAt.toISOString() } : {}),
      ...(m.endedAt ? { endedAt: m.endedAt.toISOString() } : {}),
      ...(m.calendarEventId ? { calendarEventId: m.calendarEventId } : {}),
      ...(m.folderId ? { folderId: m.folderId } : {}),
      rawNotesMarkdown: markdownOf(note?.rawContent) ?? "",
      ...(markdownOf(note?.enhancedContent)
        ? { enhancedMarkdown: markdownOf(note?.enhancedContent)! }
        : {}),
      segments: (segmentsByMeeting.get(m.id) ?? []).map((s) => ({
        channel: s.channel,
        speaker: s.speaker,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
        ...(s.confidence !== null ? { confidence: s.confidence } : {}),
      })),
    };
  });

  return NextResponse.json({ allIds, folders: allFolders, changed, hasMore });
}
