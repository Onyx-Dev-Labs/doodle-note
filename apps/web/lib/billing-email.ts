import "server-only";

import type { BillingEmailMessage } from "./billing-email-content";

export function billingEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      (process.env.BILLING_FROM_EMAIL || process.env.AUTH_FROM_EMAIL),
  );
}

export async function sendBillingEmail(
  message: BillingEmailMessage,
  idempotencyKey: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BILLING_FROM_EMAIL || process.env.AUTH_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Billing email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Billing email delivery failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
}
