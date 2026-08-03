import "server-only";

import { eq, getDb, meetings } from "@repo/db";

import { getAppWorkspace } from "./app-workspace";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getMeetingAccess(requestHeaders: Headers, id: string) {
  if (!UUID_RE.test(id)) return null;
  const context = await getAppWorkspace(requestHeaders);
  if (!context) return null;

  const rows = await getDb()
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);
  const meeting = rows[0];
  if (
    !meeting ||
    !context.organizations.some(
      (organization) => organization.id === meeting.organizationId,
    )
  ) {
    return null;
  }
  return { ...context, meeting };
}
