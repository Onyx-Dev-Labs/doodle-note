import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, getDb, meetings } from "@repo/db";

import { authenticateSyncRequest } from "@/lib/sync-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical public origin for share URLs. */
function shareOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/**
 * Enable/disable the public share link for a meeting. Bearer-authenticated
 * (desktop sync token); the meeting must belong to the token's workspace.
 */
export async function POST(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }

  let body: { meetingId?: unknown; enable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const meetingId = String(body.meetingId ?? "");
  if (!UUID_RE.test(meetingId)) {
    return NextResponse.json({ error: "meetingId must be a UUID" }, { status: 400 });
  }
  const enable = body.enable !== false;

  const db = getDb();
  const rows = await db
    .select({ id: meetings.id, shareToken: meetings.shareToken })
    .from(meetings)
    .where(
      and(eq(meetings.id, meetingId), eq(meetings.organizationId, device.organizationId)),
    )
    .limit(1);
  const meeting = rows[0];
  if (!meeting) {
    return NextResponse.json(
      { error: "Meeting not synced yet — sync it first" },
      { status: 404 },
    );
  }

  if (!enable) {
    await db
      .update(meetings)
      .set({ shareToken: null })
      .where(eq(meetings.id, meetingId));
    return NextResponse.json({ ok: true, url: null });
  }

  const token = meeting.shareToken ?? randomBytes(16).toString("hex");
  if (!meeting.shareToken) {
    await db
      .update(meetings)
      .set({ shareToken: token })
      .where(eq(meetings.id, meetingId));
  }
  return NextResponse.json({ ok: true, url: `${shareOrigin(request)}/share/${token}` });
}
