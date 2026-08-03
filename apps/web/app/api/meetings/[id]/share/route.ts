import { randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, getDb, meetings } from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";

function shareOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: {
    enable?: unknown;
    includeTranscript?: unknown;
    expiresInDays?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  if (body.enable === false) {
    await db
      .update(meetings)
      .set({
        shareToken: null,
        shareExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, access.meeting.id));
    return NextResponse.json({ ok: true, url: null });
  }

  const expiresInDays = Number(body.expiresInDays ?? 0);
  if (![0, 1, 7, 30].includes(expiresInDays)) {
    return NextResponse.json(
      { error: "expiresInDays must be 0, 1, 7, or 30" },
      { status: 400 },
    );
  }
  const token = access.meeting.shareToken ?? randomBytes(16).toString("hex");
  const shareExpiresAt =
    expiresInDays === 0
      ? null
      : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const shareIncludeTranscript = body.includeTranscript === true;

  await db
    .update(meetings)
    .set({
      shareToken: token,
      shareExpiresAt,
      shareIncludeTranscript,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, access.meeting.id));

  return NextResponse.json({
    ok: true,
    url: `${shareOrigin(request)}/share/${token}`,
    expiresAt: shareExpiresAt?.toISOString() ?? null,
  });
}
