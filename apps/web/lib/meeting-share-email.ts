import "server-only";

import { getDb, type Db } from "@repo/db";

import { invitationEmailConfigured } from "./invitation-email";
import { planShareNotifications } from "./meeting-recipients";
import type { RecipientsAddedEvent } from "./meeting-recipients-http";

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appOrigin(): string {
  return process.env.BETTER_AUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4040");
}

/**
 * One email per new recipient, reusing the workspace-invitation Resend
 * configuration (RESEND_API_KEY + INVITATION_FROM_EMAIL). Existing accounts
 * get "<owner> shared <title> with you"; other addresses get a sign-up
 * invitation that lands on the meeting after sign-up. When email is not
 * configured (local development) the link is logged instead. Never throws.
 */
export async function sendMeetingShareEmails(
  event: RecipientsAddedEvent,
  db: Db = getDb(),
): Promise<void> {
  try {
    const plan = await planShareNotifications(db, event.emails);
    const meetingPath = `/app/meeting/${event.meetingId}`;
    const meetingUrl = new URL(meetingPath, appOrigin()).toString();
    const signUpUrl = new URL(`/login?next=${encodeURIComponent(meetingPath)}`, appOrigin()).toString();

    if (!invitationEmailConfigured()) {
      console.warn(
        `[share] Meeting shared with ${plan.length} ${plan.length === 1 ? "person" : "people"} without email delivery. Set RESEND_API_KEY and INVITATION_FROM_EMAIL to enable it. Recipients can open ${meetingUrl} after signing in.`,
      );
      return;
    }

    const owner = event.sharedBy.name || event.sharedBy.email;
    const title = event.meetingTitle || "Untitled meeting";
    await Promise.all(
      plan.map(async ({ email, hasAccount }) => {
        const url = hasAccount ? meetingUrl : signUpUrl;
        const subject = `${owner} shared ${title} with you`;
        const intro = hasAccount
          ? "Open it in DoodleNote to read the notes."
          : "Create a DoodleNote account with this email address to open it. Reading shared meetings requires a paid DoodleNote plan.";
        const button = hasAccount ? "Open meeting" : "Create account";
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.INVITATION_FROM_EMAIL,
              to: [email],
              subject,
              text: `${subject}.\n\n${intro}\n${url}\n\nThis was sent to ${email}.`,
              html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#26281f"><h2>${html(owner)} shared ${html(title)} with you</h2><p>${html(intro)}</p><p><a href="${html(url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#26281f;color:#f7f5ee;text-decoration:none">${button}</a></p><p style="color:#6f7367;font-size:13px">This was sent to ${html(email)}.</p></div>`,
            }),
          });
          if (!response.ok) {
            const detail = await response.text();
            console.error(`[share] Share email delivery failed (${response.status}): ${detail.slice(0, 300)}`);
          }
        } catch (error) {
          console.error("[share] Share email delivery failed", error);
        }
      }),
    );
  } catch (error) {
    console.error("[share] Could not send share notifications", error);
  }
}
