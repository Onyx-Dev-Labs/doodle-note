import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validTwilioSignature, voiceAccessToken, type TwilioVoiceConfig } from "../lib/twilio";

const config: TwilioVoiceConfig = {
  accountSid: "AC00000000000000000000000000000000",
  apiKeySid: "SK00000000000000000000000000000000",
  apiKeySecret: "fixture-api-key-secret",
  twimlAppSid: "AP00000000000000000000000000000000",
  callerId: "+18175550100",
};

function decodePart(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

describe("Twilio authentication helpers", () => {
  it("creates a Twilio Voice JWT signed with the API key secret", () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    let token = "";
    try {
      token = voiceAccessToken(config, "user-123");
    } finally {
      Date.now = originalNow;
    }
    const [encodedHeader, encodedPayload, signature] = token.split(".");

    assert.deepEqual(decodePart(encodedHeader), {
      cty: "twilio-fpa;v=1",
      typ: "JWT",
      alg: "HS256",
    });
    assert.deepEqual(decodePart(encodedPayload), {
      ...(decodePart(encodedPayload) as Record<string, unknown>),
      iss: config.apiKeySid,
      sub: config.accountSid,
      grants: {
        identity: "user-123",
        voice: { outgoing: { application_sid: config.twimlAppSid } },
      },
    });
    assert.equal(signature, "ooIjTi3BTFw90KjoE1p7u97diXbMH0WD4O6n5jJInjc");
  });

  it("matches Twilio's published webhook-signature test vector", () => {
    const params = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    });
    const url = "https://example.com/myapp.php?foo=1&bar=2";

    assert.equal(validTwilioSignature("12345", url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU="), true);
    assert.equal(validTwilioSignature("12345", url, params, "invalid"), false);
  });
});
