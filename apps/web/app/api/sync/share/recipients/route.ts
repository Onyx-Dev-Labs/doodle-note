import { after } from "next/server";
import { getDb } from "@repo/db";

import { sendMeetingShareEmails } from "@/lib/meeting-share-email";
import { handleSyncRecipientsRequest } from "@/lib/sync-meeting-share";

export const dynamic = "force-dynamic";

/**
 * Share with people from the desktop app (DEV-486), bearer-authenticated by
 * the desktop sync token; the sharer is the token's user. Query
 * ?meetingId=<uuid> on every method. GET lists recipients, POST
 * { emails, includeTranscript } adds them, DELETE &recipientId= revokes one —
 * the same bodies and responses as /api/meetings/[id]/recipients.
 */
function handle(request: Request): Promise<Response> {
  return handleSyncRecipientsRequest(request, {
    db: getDb(),
    // Email never blocks or fails the share; it runs after the response.
    onRecipientsAdded: (event) => after(() => sendMeetingShareEmails(event)),
  });
}

export { handle as GET, handle as POST, handle as DELETE };
