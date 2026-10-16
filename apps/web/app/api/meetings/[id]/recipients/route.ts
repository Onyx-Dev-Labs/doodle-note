import { headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";
import {
  handleMeetingRecipientsRequest,
  type RecipientManagerAccess,
} from "@/lib/meeting-recipients-http";
import { sendMeetingShareEmails } from "@/lib/meeting-share-email";

export const dynamic = "force-dynamic";

/**
 * Share with people: GET lists recipients, POST { emails }
 * adds them, DELETE ?recipientId= revokes one. Only workspace members who
 * pass getMeetingAccess may manage; recipients and strangers get 404.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await getMeetingAccess(await headers(), (await params).id);
  const manager: RecipientManagerAccess | null = access
    ? {
        meetingId: access.meeting.id,
        meetingTitle: access.meeting.title,
        userId: access.session.user.id,
        userEmail: access.session.user.email,
        userName: access.session.user.name,
      }
    : null;
  return handleMeetingRecipientsRequest(request, {
    db: getDb(),
    access: manager,
    // Email never blocks or fails the share; it runs after the response.
    onRecipientsAdded: (event) => after(() => sendMeetingShareEmails(event)),
  });
}

export { handle as GET, handle as POST, handle as DELETE };
