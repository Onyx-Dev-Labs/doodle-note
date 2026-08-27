import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingTestIdentity, stripeCheckoutUrl } from "./billing-e2e-utils.mjs";

describe("billing E2E helpers", () => {
  it("creates independent, non-predictable test credentials", () => {
    const first = billingTestIdentity();
    const second = billingTestIdentity();

    assert.match(first.email, /^billing-e2e-[0-9a-f-]+@example\.com$/);
    assert.notEqual(first.email, second.email);
    assert.notEqual(first.password, second.password);
    assert.ok(first.password.length >= 8);
    assert.ok(!first.password.includes(first.email));
  });

  it("accepts an exact Stripe-hosted checkout URL", () => {
    const url = stripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123#fidkdWxOYHwnPyd1blpxYHZxWjA0");

    assert.equal(url?.hostname, "checkout.stripe.com");
  });

  it("rejects checkout URL lookalikes and unsafe URL forms", () => {
    const rejected = [
      "http://checkout.stripe.com/c/pay/cs_test_123",
      "https://checkout.stripe.com.evil.example/c/pay/cs_test_123",
      "https://evil-checkout.stripe.com/c/pay/cs_test_123",
      "https://evil.example/checkout.stripe.com/c/pay/cs_test_123",
      "https://evil.example/?next=checkout.stripe.com",
      "https://checkout.stripe.com@evil.example/c/pay/cs_test_123",
      "https://user:password@checkout.stripe.com/c/pay/cs_test_123",
      "https://checkout.stripe.com:444/c/pay/cs_test_123",
      "not a URL",
    ];

    for (const value of rejected) assert.equal(stripeCheckoutUrl(value), null, value);
  });
});
