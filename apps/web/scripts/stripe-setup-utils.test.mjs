import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertExpectedAccount,
  assertMonthlyPrice,
  stripeKeyMode,
  webhookUrl,
} from "./stripe-setup-utils.mjs";

describe("Stripe provisioning guardrails", () => {
  it("recognizes standard and restricted key modes", () => {
    assert.equal(stripeKeyMode("sk_test_fixture"), "test");
    assert.equal(stripeKeyMode("rk_test_fixture"), "test");
    assert.equal(stripeKeyMode("sk_live_fixture"), "LIVE");
    assert.equal(stripeKeyMode("rk_live_fixture"), "LIVE");
    assert.throws(() => stripeKeyMode("not-a-stripe-key"), /secret or restricted/);
  });

  it("requires the authenticated Stripe account to match the intended account", () => {
    assert.doesNotThrow(() => assertExpectedAccount("acct_expected", "acct_expected"));
    assert.throws(
      () => assertExpectedAccount("acct_other", "acct_expected"),
      /Stripe account mismatch/,
    );
  });

  it("rejects a lookup key that points at the wrong price contract", () => {
    assert.doesNotThrow(() =>
      assertMonthlyPrice({
        id: "price_expected",
        active: true,
        currency: "usd",
        unit_amount: 1000,
        recurring: { interval: "month" },
      }),
    );
    assert.throws(
      () =>
        assertMonthlyPrice({
          id: "price_wrong",
          active: true,
          currency: "usd",
          unit_amount: 900,
          recurring: { interval: "month" },
        }),
      /does not match/,
    );
  });

  it("accepts only credential-free HTTPS webhook URLs", () => {
    assert.equal(
      webhookUrl("https://preview.example.com/api/billing/webhook").href,
      "https://preview.example.com/api/billing/webhook",
    );
    for (const value of [
      "http://preview.example.com/api/billing/webhook",
      "https://user:pass@preview.example.com/api/billing/webhook",
      "not a url",
    ]) {
      assert.throws(() => webhookUrl(value), /valid credential-free HTTPS/);
    }
  });
});
