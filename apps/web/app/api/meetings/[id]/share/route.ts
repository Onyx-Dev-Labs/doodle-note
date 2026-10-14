import { headers } from "next/headers";
import { getDb } from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";
import { handleMeetingShareRequest } from "@/lib/meeting-share-state";

export const dynamic = "force-dynamic";

/**
 * The meeting Share panel. GET returns the share state
 * `{ includeTranscript, link, recipients, workspace, limits }`; POST applies
 * `{ includeTranscript?, link?: "on"|"off", expiresInDays?: 0|1|7|30 }` and
 * returns the new state. People are added/removed via ./recipients. Only
 * workspace members who pass getMeetingAccess may use it; recipients and
 * strangers get 404. See lib/meeting-share-state.ts.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await getMeetingAccess(await headers(), (await params).id);
  return handleMeetingShareRequest(request, {
    db: getDb(),
    meetingId: access?.meeting.id ?? null,
  });
}

export { handle as GET, handle as POST };
