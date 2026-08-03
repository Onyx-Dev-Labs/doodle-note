import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, getDb, meetingStars } from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  await getDb()
    .insert(meetingStars)
    .values({ meetingId: access.meeting.id, userId: access.session.user.id })
    .onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  await getDb()
    .delete(meetingStars)
    .where(
      and(
        eq(meetingStars.meetingId, access.meeting.id),
        eq(meetingStars.userId, access.session.user.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
