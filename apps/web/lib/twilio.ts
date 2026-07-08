import { createHmac } from "node:crypto";

/**
 * Minimal Twilio helpers for DoodleNote phone calls — hand-rolled (no SDK
 * dependency): a Voice access token (standard JWT with a voice grant) and
 * webhook signature validation.
 *
 * Required env: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET,
 * TWILIO_TWIML_APP_SID, TWILIO_CALLER_ID (the purchased number), and
 * TWILIO_AUTH_TOKEN (webhook signature validation).
 */

export interface TwilioVoiceConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  callerId: string;
  authToken?: string;
}

export function twilioConfig(): TwilioVoiceConfig | null {
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    TWILIO_TWIML_APP_SID,
    TWILIO_CALLER_ID,
    TWILIO_AUTH_TOKEN,
  } = process.env;
  if (
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_API_KEY_SID ||
    !TWILIO_API_KEY_SECRET ||
    !TWILIO_TWIML_APP_SID ||
    !TWILIO_CALLER_ID
  ) {
    return null;
  }
  return {
    accountSid: TWILIO_ACCOUNT_SID,
    apiKeySid: TWILIO_API_KEY_SID,
    apiKeySecret: TWILIO_API_KEY_SECRET,
    twimlAppSid: TWILIO_TWIML_APP_SID,
    callerId: TWILIO_CALLER_ID,
    authToken: TWILIO_AUTH_TOKEN,
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Twilio Voice access token: JWT signed with the API key secret. */
export function voiceAccessToken(config: TwilioVoiceConfig, identity: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { cty: "twilio-fpa;v=1", typ: "JWT", alg: "HS256" };
  const payload = {
    jti: `${config.apiKeySid}-${now}`,
    iss: config.apiKeySid,
    sub: config.accountSid,
    iat: now,
    exp: now + 3600,
    grants: {
      identity,
      voice: { outgoing: { application_sid: config.twimlAppSid } },
    },
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", config.apiKeySecret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Validates X-Twilio-Signature on webhook requests: HMAC-SHA1 of the full URL
 * plus the POST params concatenated in sorted-key order, keyed by the account
 * auth token.
 */
export function validTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const data = url + sorted.map(([key, value]) => key + value).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return expected === signature;
}
