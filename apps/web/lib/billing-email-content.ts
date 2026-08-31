interface BillingEmailInput {
  email: string;
  effectiveAt: Date;
  manageUrl: string;
  mascotUrl: string;
}

export interface BillingEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(value);
}

function brandedEmail(input: {
  preview: string;
  title: string;
  paragraphs: string[];
  actionLabel: string;
  actionUrl: string;
  mascotUrl: string;
}): string {
  const paragraphs = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:25px;color:#3a3d33;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const actionUrl = escapeHtml(input.actionUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f7f5ee;color:#26281f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f5ee;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e7e3d8;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;text-align:center;background:#e9efe0;border-bottom:1px solid #e7e3d8;">
                <img src="${escapeHtml(input.mascotUrl)}" width="88" height="88" alt="DoodleNote mascot" style="display:block;width:88px;height:88px;margin:0 auto 12px;border:0;">
                <div style="font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.3px;color:#26281f;">DoodleNote</div>
                <div style="margin-top:5px;font-size:13px;line-height:20px;color:#506941;">Local-first. Cloud only when you opt in.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 30px;">
                <h1 style="margin:0 0 16px;font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:#26281f;">${escapeHtml(input.title)}</h1>
                ${paragraphs}
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:10px;background:#506941;">
                      <a href="${actionUrl}" style="display:inline-block;padding:13px 22px;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(input.actionLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fdfcf8;border-top:1px solid #e7e3d8;font-size:12px;line-height:19px;color:#6f7367;">DoodleNote Cloud Sync is an optional hosted service. Your local DoodleNote data remains on your devices.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildCancellationScheduledEmail(
  input: BillingEmailInput,
): BillingEmailMessage {
  const date = formatDate(input.effectiveAt);
  const paragraphs = [
    `Your DoodleNote Cloud Sync subscription is scheduled to end on ${date}.`,
    `On ${date}, DoodleNote will permanently delete the active cloud copy of meetings, transcripts, notes, folders, tags, shared links, and attachments in your Personal workspace. Linked Cloud Sync devices and agent access tokens will also be disconnected.`,
    "Your local notes and recordings are not deleted and remain on your devices.",
    "Content in shared workspaces is retained for the other workspace members. Your Cloud Sync access to those workspaces will end with your subscription.",
    "You can resume the subscription before it ends from your billing settings.",
  ];
  return {
    to: input.email,
    subject: "Your DoodleNote Cloud Sync cancellation is scheduled",
    text: `${paragraphs.join("\n\n")}\n\nManage subscription: ${input.manageUrl}`,
    html: brandedEmail({
      preview: `Cloud Sync and Personal workspace cloud data are scheduled to end on ${date}.`,
      title: "Cloud Sync cancellation scheduled",
      paragraphs,
      actionLabel: "Manage subscription",
      actionUrl: input.manageUrl,
      mascotUrl: input.mascotUrl,
    }),
  };
}

export function buildCloudSyncEndedEmail(
  input: BillingEmailInput,
): BillingEmailMessage {
  const date = formatDate(input.effectiveAt);
  const paragraphs = [
    `Your DoodleNote Cloud Sync subscription ended on ${date}.`,
    "The active cloud copy of meetings, transcripts, notes, folders, tags, shared links, and attachments in your Personal workspace has been permanently deleted. Linked Cloud Sync devices and agent access tokens have been disconnected.",
    "Your local notes and recordings remain on your devices. Content in shared workspaces is retained for the other workspace members.",
    "You can start a new Cloud Sync subscription whenever you are ready.",
  ];
  return {
    to: input.email,
    subject: "Your DoodleNote Cloud Sync has ended",
    text: `${paragraphs.join("\n\n")}\n\nRestart Cloud Sync: ${input.manageUrl}`,
    html: brandedEmail({
      preview:
        "Cloud Sync has ended and your Personal workspace active cloud copy was deleted.",
      title: "Cloud Sync has ended",
      paragraphs,
      actionLabel: "Restart Cloud Sync",
      actionUrl: input.manageUrl,
      mascotUrl: input.mascotUrl,
    }),
  };
}
