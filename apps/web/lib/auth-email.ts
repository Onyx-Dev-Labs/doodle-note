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
  const verificationUrl = html(data.url);
  const mascotUrl = html(new URL("/mascot.png", data.url).toString());
  await sendAuthEmail({
    to: data.user.email,
    subject: "Verify your DoodleNote email",
    text: `Welcome to DoodleNote.\n\nConfirm your email address to finish creating your account:\n${data.url}\n\nThis link expires in one hour. If you did not create a DoodleNote account, you can safely ignore this email.`,
    body: `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Verify your DoodleNote email</title>
  </head>
  <body style="margin:0;padding:0;background:#f7f5ee;color:#26281f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">One quick check, then your DoodleNote account is ready.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f5ee;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e7e3d8;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;text-align:center;background:#e9efe0;border-bottom:1px solid #e7e3d8;">
                <img src="${mascotUrl}" width="88" height="88" alt="DoodleNote mascot" style="display:block;width:88px;height:88px;margin:0 auto 12px;border:0;">
                <div style="font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.3px;color:#26281f;">DoodleNote</div>
                <div style="margin-top:5px;font-size:13px;line-height:20px;color:#506941;">Local-first. Cloud only when you opt in.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 30px;">
                <h1 style="margin:0 0 14px;font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:#26281f;">One quick check, then you&rsquo;re in</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#3a3d33;">Confirm your email address to finish creating your DoodleNote account.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:10px;background:#506941;">
                      <a href="${verificationUrl}" style="display:inline-block;padding:13px 22px;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Verify my email</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 8px;font-size:13px;line-height:20px;color:#6f7367;">This link expires in one hour. If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;font-size:12px;line-height:18px;word-break:break-all;"><a href="${verificationUrl}" style="color:#506941;text-decoration:underline;">${verificationUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#fdfcf8;border-top:1px solid #e7e3d8;font-size:12px;line-height:19px;color:#6f7367;">If you did not create a DoodleNote account, you can safely ignore this email.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  });
}
