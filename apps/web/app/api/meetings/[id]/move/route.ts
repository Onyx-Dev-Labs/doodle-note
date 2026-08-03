import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  and,
  eq,
  folders,
  getDb,
  meetings,
  meetingTagLinks,
} from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: { organizationId?: unknown; folderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const organizationId = String(body.organizationId ?? "");
  const target = access.organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (!target) {
    return NextResponse.json(
      { error: "You are not a member of that workspace" },
      { status: 403 },
    );
  }

  const db = getDb();
  const requestedFolderId = body.folderId ? String(body.folderId) : null;
  let folderId: string | null = null;
  if (requestedFolderId) {
    const folderRows = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.id, requestedFolderId),
          eq(folders.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!folderRows[0]) {
      return NextResponse.json(
        { error: "Folder does not belong to that workspace" },
        { status: 400 },
      );
    }
    folderId = requestedFolderId;
  }

  if (organizationId !== access.meeting.organizationId) {
    await db
      .delete(meetingTagLinks)
      .where(eq(meetingTagLinks.meetingId, access.meeting.id));
  }
  await db
    .update(meetings)
    .set({
      organizationId,
      folderId,
      shareToken:
        organizationId === access.meeting.organizationId
          ? access.meeting.shareToken
          : null,
      shareExpiresAt:
        organizationId === access.meeting.organizationId
          ? access.meeting.shareExpiresAt
          : null,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, access.meeting.id));

  return NextResponse.json({ ok: true, workspaceName: target.name });
}
