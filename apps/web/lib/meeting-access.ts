import "server-only";

import { eq, getDb, meetings } from "@repo/db";

import { getAppWorkspace } from "./app-workspace";
import { entitlementFor } from "./billing";
import { readSharedMeeting } from "./meeting-recipients";
import { resolveAuthEmailEnabled } from "./runtime-config";

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

/**
 * Read-only access for a meeting someone shared with the signed-in user
 * (DEV-485). Use ONLY on read paths (the meeting page); mutating routes must
 * keep using getMeetingAccess so recipients get 404. Pass the workspace
 * context the caller already resolved. Returns null for strangers.
 */
export async function getSharedMeetingAccess(
  context: NonNullable<Awaited<ReturnType<typeof getAppWorkspace>>>,
  id: string,
) {
  const result = await readSharedMeeting(getDb(), {
    meetingId: id,
    identity: {
      id: context.session.user.id,
      email: context.session.user.email,
      emailVerified: context.session.user.emailVerified,
    },
    // Unverified emails may only match when verification is disabled (local dev).
    requireVerifiedEmail: resolveAuthEmailEnabled(),
    entitlement: entitlementFor,
  });
  return result.status === "not_found" ? null : result;
}
