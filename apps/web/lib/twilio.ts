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

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function restAuth(config: TwilioVoiceConfig): string {
  return (
    "Basic " +
    Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString("base64")
  );
}

/**
 * Starts Twilio's Verified Caller ID flow: Twilio immediately calls the
 * number and the returned 6-digit code must be entered on that call's keypad.
 */
export async function createValidationRequest(
  config: TwilioVoiceConfig,
  phoneNumber: string,
  friendlyName: string,
): Promise<{ validationCode: string }> {
  const response = await fetch(
    `${TWILIO_API}/Accounts/${config.accountSid}/OutgoingCallerIds.json`,
    {
      method: "POST",
      headers: {
        Authorization: restAuth(config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        PhoneNumber: phoneNumber,
        FriendlyName: friendlyName.slice(0, 64),
      }),
    },
  );
  const body = (await response.json()) as {
    validation_code?: string;
    message?: string;
  };
  if (!response.ok || !body.validation_code) {
    throw new Error(body.message ?? `Twilio validation failed (${response.status})`);
  }
  return { validationCode: body.validation_code };
}

/**
 * Returns the OutgoingCallerId SID if the number has completed verification
 * on this Twilio account, else null.
 */
export async function findVerifiedCallerId(
  config: TwilioVoiceConfig,
  phoneNumber: string,
): Promise<string | null> {
  const query = new URLSearchParams({ PhoneNumber: phoneNumber });
  const response = await fetch(
    `${TWILIO_API}/Accounts/${config.accountSid}/OutgoingCallerIds.json?${query}`,
    { headers: { Authorization: restAuth(config) } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    outgoing_caller_ids?: Array<{ sid: string; phone_number: string }>;
  };
  return body.outgoing_caller_ids?.[0]?.sid ?? null;
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
