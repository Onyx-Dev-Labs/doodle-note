import { eq, getDb, verifiedCallerIds } from "@repo/db";

import { entitlementFor } from "@/lib/billing";
import { twilioConfig, validTwilioSignature } from "@/lib/twilio";

/**
 * TwiML App voice URL — Twilio POSTs here when the mobile app places a call;
 * the response bridges it to the dialed number over the phone network.
 * Configure this route's public URL as the TwiML App's "Voice Request URL".
 */
export async function POST(request: Request) {
  const config = twilioConfig();
  if (!config) {
    return new Response("Not configured", { status: 503 });
  }

  // Fail closed: without the auth token the webhook cannot prove it is Twilio.
  if (!config.authToken) {
    console.error("[voice] TWILIO_AUTH_TOKEN is not set; refusing unsigned voice webhook requests.");
    return new Response("Not configured", { status: 503 });
  }

  const body = await request.text();
  const params = new URLSearchParams(body);

  if (
    !validTwilioSignature(
      config.authToken,
      request.url,
      params,
      request.headers.get("X-Twilio-Signature"),
    )
  ) {
    return new Response("Bad signature", { status: 403 });
  }

  const to = (params.get("To") ?? "").trim();
  if (!/^\+[1-9][0-9]{6,14}$/.test(to)) {
    return twiml(`<Response><Say>Invalid number.</Say></Response>`);
  }

  // Calls arrive as client:<userId>, the identity of the access token we
  // minted. A user with a Verified Caller ID gets their own number displayed
  // instead of the shared workspace number.
  const from = params.get("From") ?? "";
  if (!from.startsWith("client:")) {
    return twiml(`<Response><Say>Calling is not available.</Say></Response>`);
  }
  const userId = from.slice("client:".length);
  // Tokens live up to an hour, so re-check the subscription at call time.
  if (!(await entitlementFor(userId)).entitled) {
    return twiml(`<Response><Say>Calling needs an active DoodleNote subscription.</Say></Response>`);
  }

  let callerId = config.callerId;
  {
    const [row] = await getDb()
      .select()
      .from(verifiedCallerIds)
      .where(eq(verifiedCallerIds.userId, userId))
      .limit(1);
    if (row?.status === "verified" && /^\+[1-9][0-9]{6,14}$/.test(row.phoneNumber)) {
      callerId = row.phoneNumber;
    }
  }

  return twiml(
    `<Response><Dial callerId="${callerId}" answerOnBridge="true"><Number>${to}</Number></Dial></Response>`,
  );
}

function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${inner}`, {
    headers: { "Content-Type": "text/xml" },
  });
}
