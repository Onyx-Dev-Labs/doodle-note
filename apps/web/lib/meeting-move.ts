import { NextResponse } from "next/server";
import { and, eq, folders, meetings, type Db } from "@repo/db";

export const CROSS_WORKSPACE_MOVE_ERROR =
  "Meetings can't be moved to another workspace. Share it with people instead.";

export interface MeetingMoveAccess {
  organizations: Array<{ id: string; name: string }>;
  meeting: { id: string; organizationId: string };
}

/**
 * Files a meeting into a space (folder) inside its own workspace.
 *
 * A meeting's workspace is fixed once it exists: the `sync_guard_legacy`
 * trigger rejects any change to meetings.organization_id, and collaboration
 * goes through sharing instead. Requests naming a different workspace are
 * refused before anything is written, so tags and links are never lost.
 */
export async function handleMeetingMove(
  request: Request,
  access: MeetingMoveAccess | null,
  db: Db,
) {
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: { organizationId?: unknown; folderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const organizationId = access.meeting.organizationId;
  if (
    body.organizationId !== undefined &&
    body.organizationId !== null &&
    String(body.organizationId) !== organizationId
  ) {
    return NextResponse.json(
      { error: CROSS_WORKSPACE_MOVE_ERROR },
      { status: 409 },
    );
  }
  const workspace = access.organizations.find(
    (organization) => organization.id === organizationId,
  );

  const requestedFolderId = body.folderId ? String(body.folderId) : null;
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
  }

  await db
    .update(meetings)
    .set({ folderId: requestedFolderId, updatedAt: new Date() })
    .where(
      and(
        eq(meetings.id, access.meeting.id),
        eq(meetings.organizationId, organizationId),
      ),
    );

  return NextResponse.json({ ok: true, workspaceName: workspace?.name ?? null });
}
