import "server-only";

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendAuthEmail({
  to,
  subject,
  text,
  body,
}: {
  to: string;
  subject: string;
  text: string;
  body: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Authentication email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html: body }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Authentication email delivery failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
}

export async function sendAuthVerificationEmail(data: {
  user: { email: string };
  url: string;
}): Promise<void> {
  const url = html(data.url);
  await sendAuthEmail({
    to: data.user.email,
    subject: "Verify your DoodleNote email",
    text: `Verify your DoodleNote email: ${data.url}`,
    body: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#26281f"><h2>Verify your email</h2><p>Confirm this email address to finish creating your DoodleNote account.</p><p><a href="${url}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#26281f;color:#f7f5ee;text-decoration:none">Verify email</a></p><p style="color:#6f7367;font-size:13px">This link expires in one hour. If you did not create a DoodleNote account, you can ignore this email.</p></div>`,
  });
}
