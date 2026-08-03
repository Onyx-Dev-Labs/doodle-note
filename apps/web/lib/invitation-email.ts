import "server-only";

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function invitationEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.INVITATION_FROM_EMAIL);
}

export async function sendWorkspaceInvitationEmail(data: {
  id: string;
  email: string;
  organization: { name: string };
  inviter: { user: { name: string; email: string } };
}): Promise<void> {
  if (!invitationEmailConfigured()) {
    console.warn(
      "[auth] Workspace invitation created without email delivery. Set RESEND_API_KEY and INVITATION_FROM_EMAIL to enable it.",
    );
    return;
  }

  const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:4040";
  const inviteUrl = new URL(`/invite/${data.id}`, origin).toString();
  const organizationName = html(data.organization.name);
  const inviterName = html(data.inviter.user.name || data.inviter.user.email);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.INVITATION_FROM_EMAIL,
      to: [data.email],
      subject: `Join ${data.organization.name} in DoodleNote`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#26281f"><h2>${inviterName} invited you to ${organizationName}</h2><p>Join the shared DoodleNote workspace to see the meetings and notes your team chooses to move there.</p><p><a href="${html(inviteUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#26281f;color:#f7f5ee;text-decoration:none">Accept invitation</a></p><p style="color:#6f7367;font-size:13px">This invitation was sent to ${html(data.email)}.</p></div>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Invitation email delivery failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}
