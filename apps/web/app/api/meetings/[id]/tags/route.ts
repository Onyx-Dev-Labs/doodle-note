import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  and,
  eq,
  getDb,
  inArray,
  meetingTagLinks,
  meetingTags,
} from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: { tags?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.tags)) {
    return NextResponse.json({ error: "tags must be an array" }, { status: 400 });
  }
  const names = [
    ...new Set(
      body.tags
        .map((value) => String(value).trim().replace(/\s+/g, " ").slice(0, 32))
        .filter(Boolean),
    ),
  ].slice(0, 10);

  const db = getDb();
  if (names.length > 0) {
    await db
      .insert(meetingTags)
      .values(
        names.map((name) => ({
          organizationId: access.meeting.organizationId,
          name,
        })),
      )
      .onConflictDoNothing();
  }
  const tagRows =
    names.length > 0
      ? await db
          .select({ id: meetingTags.id, name: meetingTags.name })
          .from(meetingTags)
          .where(
            and(
              eq(meetingTags.organizationId, access.meeting.organizationId),
              inArray(meetingTags.name, names),
            ),
          )
      : [];

  await db
    .delete(meetingTagLinks)
    .where(eq(meetingTagLinks.meetingId, access.meeting.id));
  if (tagRows.length > 0) {
    await db
      .insert(meetingTagLinks)
      .values(
        tagRows.map((tag) => ({
          meetingId: access.meeting.id,
          tagId: tag.id,
        })),
      )
      .onConflictDoNothing();
  }

  return NextResponse.json({ ok: true, tags: names });
}
