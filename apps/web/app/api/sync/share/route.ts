import { getDb } from "@repo/db";

import { handleSyncShareRequest } from "@/lib/sync-meeting-share";

export const dynamic = "force-dynamic";

/**
 * The meeting's share state and settings, bearer-authenticated (desktop sync
 * token); the meeting must already be synced into the token's workspace.
 * GET ?meetingId= reads the state; POST { meetingId, includeTranscript?,
 * link?, expiresInDays? } changes it. Older desktop builds' { meetingId,
 * enable } still works. See lib/sync-meeting-share.ts.
 */
function handle(request: Request): Promise<Response> {
  return handleSyncShareRequest(request, { db: getDb() });
}

export { handle as GET, handle as POST };
