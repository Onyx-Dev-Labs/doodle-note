import { NextResponse } from "next/server";
import {
  and,
  eq,
  folders,
  getDb,
  inArray,
  meetings,
  notes,
  transcriptSegments,
  writeLegacy,
  syncNotes,
} from "@repo/db";

import { syncV2Enabled, readBoundedJSON } from "@/lib/sync-v2";
import { authenticateEntitledSyncRequest } from "@/lib/sync-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PushSegment {
  channel: "mic" | "system";
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  /** Wall-clock epoch ms — the audio-playback seek anchor. */
  absoluteStartMs?: number;
  confidence?: number;
}

interface PushMeeting {
  id: string;
  title: string;
  kind?: "meeting" | "note";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  calendarEventId?: string;
  folderId?: string;
  rawNotesMarkdown?: string;
  enhancedMarkdown?: string;
  segments: PushSegment[];
}

interface PushFolder {
  id: string;
  name: string;
  createdAt?: string;
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
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const device = authed.device;

  let body: { meetings?: unknown; folders?: unknown };
  try {
    body = await readBoundedJSON(request) as typeof body;
    if (!body || typeof body !== "object") throw new Error("invalid_body");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray(body.meetings)
    ? (body.meetings as PushMeeting[])
    : [];
  const folderItems = Array.isArray(body.folders)
    ? (body.folders as PushFolder[])
    : [];
  if (items.length + folderItems.length === 0 || items.length > 20 || folderItems.length > 100) {
    return NextResponse.json(
      { error: "Expected 1-20 meetings per push" },
      { status: 400 },
    );
  }

  const db = getDb();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  const folderResults: Array<{id:string;ok:boolean;error?:string}>=[];
  // Folders first — meetings in this batch may point at them.
  for (const item of folderItems) {
    const id = String(item?.id ?? "");
    if (!UUID_RE.test(id) || typeof item.name !== "string" || !item.name.trim()) {
      folderResults.push({id,ok:false,error:"invalid_folder"});continue;
    }
    try {
    const existing = await db
      .select({ organizationId: folders.organizationId })
      .from(folders)
      .where(eq(folders.id, id))
      .limit(1);
    if (existing[0] && existing[0].organizationId !== device.organizationId) {
      folderResults.push({id,ok:false,error:"write_rejected"});continue;
    }
    const row = {
      organizationId: device.organizationId,
      name: item.name.trim().slice(0, 80),
      createdAt: toDate(item.createdAt) ?? new Date(),
      updatedAt: new Date(),
    };
    await db
      .insert(folders)
      .values({ id, ...row })
      .onConflictDoUpdate({
        target: folders.id,
        set: { name: row.name, updatedAt: row.updatedAt },
        setWhere: eq(folders.organizationId, device.organizationId),
      });
    folderResults.push({id,ok:true});
    } catch {folderResults.push({id,ok:false,error:"write_rejected"});}
  }

  // Folder assignments must reference folders this workspace owns.
  const ownFolderIds = new Set(
    (
      await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.organizationId, device.organizationId))
    ).map((r) => r.id),
  );

  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!UUID_RE.test(id)) {
      results.push({ id, ok: false, error: "meeting id must be a UUID" });
      continue;
    }
    const createdAt = toDate(item.createdAt);
    if (!createdAt) {
      results.push({ id, ok: false, error: "createdAt must be ISO date" });
      continue;
    }

    if (!Array.isArray(item.segments) || item.segments.length > 20_000 || item.segments.some(s =>
      !s || (s.channel !== 'mic' && s.channel !== 'system') || typeof s.text !== 'string' || s.text.length > 10_000 ||
      !Number.isSafeInteger(s.startMs) || !Number.isSafeInteger(s.endMs) || s.startMs < 0 || s.endMs < s.startMs || s.endMs > 2147483647 ||
      (s.absoluteStartMs !== undefined && !Number.isSafeInteger(s.absoluteStartMs)) ||
      (s.confidence !== undefined && (!Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1)))) {
      results.push({id,ok:false,error:'invalid_or_oversized_segments'}); continue;
    }

      const segments = (Array.isArray(item.segments) ? item.segments : [])
        .filter(
          (s) =>
            (s.channel === "mic" || s.channel === "system") &&
            typeof s.text === "string" &&
            Number.isFinite(s.startMs) &&
            Number.isFinite(s.endMs),
        )
        .map((s) => ({
          meetingId: id,
          channel: s.channel,
          speaker:
            String(s.speaker ?? "").slice(0, 40) || (s.channel === "mic" ? "You" : "Them"),
          text: s.text.slice(0, 10_000),
          startMs: Math.round(s.startMs),
          endMs: Math.round(s.endMs),
          absoluteStartMs:
            typeof s.absoluteStartMs === "number" &&
            Number.isFinite(s.absoluteStartMs)
              ? Math.round(s.absoluteStartMs)
              : null,
          confidence: Number.isFinite(s.confidence) ? s.confidence : null,
        }));

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
        kind: item.kind === "note" ? ("note" as const) : ("meeting" as const),
        status: "complete" as const,
        calendarEventId:
          typeof item.calendarEventId === "string"
            ? item.calendarEventId.slice(0, 512)
            : null,
        startedAt: toDate(item.startedAt),
        endedAt: toDate(item.endedAt),
        folderId:
          typeof item.folderId === "string" && ownFolderIds.has(item.folderId)
            ? item.folderId
            : null,
        createdAt,
        updatedAt: new Date(),
      };
      if (syncV2Enabled()) {
        await writeLegacy(db, device.organizationId, {id,...row,
          rawContent:markdownEnvelope(item.rawNotesMarkdown), enhancedContent:markdownEnvelope(item.enhancedMarkdown),
          segments:segments.map(s=>({channel:s.channel,speaker:s.speaker,text:s.text,startMs:s.startMs,endMs:s.endMs,absoluteStartMs:s.absoluteStartMs,confidence:s.confidence}))});
        results.push({id,ok:true});continue;
      }
      const written = await db
        .insert(meetings)
        .values({ id, ...row })
        .onConflictDoUpdate({ target: meetings.id, set: row, setWhere:eq(meetings.organizationId,device.organizationId) }).returning();
      if (!written.length) {results.push({id,ok:false,error:"write_rejected"});continue;}

      // All validation precedes the atomic replacement when v2 rollout is enabled.
      await db.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, id));
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
    } catch {
      results.push({
        id,
        ok: false,
        error: "write_rejected",
      });
    }
  }

  return NextResponse.json({ results,folderResults });
}

/** Meeting deletions propagate too: ids the desktop trashed or removed. */
export async function DELETE(request: Request) {
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const device = authed.device;
  let body: { ids?: unknown; folderIds?: unknown };
  try {
    body = await readBoundedJSON(request) as typeof body;
    if (!body || typeof body !== "object") throw new Error("invalid_body");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .map(String)
    .filter((id) => UUID_RE.test(id))
;
  const folderIds = (Array.isArray(body.folderIds) ? body.folderIds : [])
    .map(String)
    .filter((id) => UUID_RE.test(id))
;

  if ((Array.isArray(body.ids) && body.ids.length > 100) || (Array.isArray(body.folderIds) && body.folderIds.length > 100)) return NextResponse.json({error:'delete_batch_limit'},{status:400});
  const db = getDb();
  const failures: string[]=[];
  for (const id of ids) {
    try {
      if(syncV2Enabled()) { const protectedRows=await db.select().from(syncNotes).where(and(eq(syncNotes.id,id),eq(syncNotes.organizationId,device.organizationId)));
        if(protectedRows.some(r=>r.state!=="purged")){failures.push(id);continue;} }
      await db
      .delete(meetings)
      .where(
        and(eq(meetings.id, id), eq(meetings.organizationId, device.organizationId)),
      );
    } catch { failures.push(id); }
  }
  if (folderIds.length > 0) {
    try {
    // FK is ON DELETE SET NULL — meetings inside fall back to unfiled.
    await db
      .delete(folders)
      .where(
        and(
          inArray(folders.id, folderIds),
          eq(folders.organizationId, device.organizationId),
        ),
      );
    } catch {failures.push(...folderIds);}
  }
  return NextResponse.json({ ok: failures.length===0, deleted: ids.length-failures.length + folderIds.length, failures }, {status:failures.length?409:200});
}
