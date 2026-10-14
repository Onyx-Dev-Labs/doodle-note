import { getDb } from "@repo/db";

import { handleSyncShareRequest } from "@/lib/sync-meeting-share";

export const dynamic = "force-dynamic";

/**
 * The public share link for a meeting, bearer-authenticated (desktop sync
 * token); the meeting must already be synced into the token's workspace.
 * GET ?meetingId= reads the settings; POST { meetingId, enable,
 * includeTranscript?, expiresInDays? } creates, updates or revokes it.
 * See lib/sync-meeting-share.ts for compatibility with older desktop builds.
 */
function handle(request: Request): Promise<Response> {
  return handleSyncShareRequest(request, { db: getDb() });
}

export { handle as GET, handle as POST };
