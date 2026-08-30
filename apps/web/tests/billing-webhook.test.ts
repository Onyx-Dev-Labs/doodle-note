import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_fixture_secret";
let post: (request: Request) => Promise<Response>;
const stripe = new Stripe("sk_test_fixture");
let originalSelfHosted: string | undefined;

before(async () => {
  originalSelfHosted = process.env.DOODLENOTE_SELF_HOSTED;
  delete process.env.DOODLENOTE_SELF_HOSTED;
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_ACCOUNT_ID = "acct_fixture";
  process.env.STRIPE_PRICE_ID = "price_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  ({ POST: post } = await import("../app/api/billing/webhook/route"));
});

after(() => {
  if (originalSelfHosted === undefined) {
    delete process.env.DOODLENOTE_SELF_HOSTED;
  } else {
    process.env.DOODLENOTE_SELF_HOSTED = originalSelfHosted;
  }
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_ACCOUNT_ID;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

function request(payload: string, signature: string) {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

describe("Stripe webhook signature boundary", () => {
  const payload = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1_800_000_000,
    data: { object: { id: "seti_fixture", object: "setup_intent" } },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "setup_intent.created",
  });

  it("rejects an invalid signature", async () => {
    const response = await post(request(payload, "invalid"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Bad signature" });
  });

  it("accepts a valid signature without logging or returning the payload", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    const response = await post(request(payload, signature));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  });
});
