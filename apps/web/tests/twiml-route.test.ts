import assert from "node:assert/strict";
import { test } from "node:test";

const REQUIRED = {
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_API_KEY_SID: "SK00000000000000000000000000000000",
  TWILIO_API_KEY_SECRET: "fixture-secret",
  TWILIO_TWIML_APP_SID: "AP00000000000000000000000000000000",
  TWILIO_CALLER_ID: "+18175550100",
};

test("the voice webhook refuses unsigned requests when TWILIO_AUTH_TOKEN is missing", async () => {
  const previous = Object.fromEntries(
    [...Object.keys(REQUIRED), "TWILIO_AUTH_TOKEN"].map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, REQUIRED);
    delete process.env.TWILIO_AUTH_TOKEN;
    const { POST } = await import("../app/api/voice/twiml/route");
    const response = await POST(
      new Request("http://localhost/api/voice/twiml", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: "+16145551234", From: "client:someone" }),
      }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("callerId"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
