import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";

import {
  checkoutBlocked,
  checkoutIdempotencyKey,
  entitlementFrom,
  selectEffectiveSubscription,
  subscriptionUsesPrice,
} from "../lib/billing-state";

function subscription(
  id: string,
  status: Stripe.Subscription.Status,
  priceId = "price_sync",
  created = 1,
): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    created,
    status,
    customer: "cus_fixture",
    metadata: { doodlenoteUserId: "user-1" },
    items: {
      object: "list",
      data: [
        {
          id: `si_${id}`,
          object: "subscription_item",
          created,
          current_period_end: 1_800_000_000,
          current_period_start: 1_700_000_000,
          discounts: [],
          metadata: {},
          price: { id: priceId },
          quantity: 1,
          subscription: id,
          tax_rates: [],
        } as unknown as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`,
    },
  } as unknown as Stripe.Subscription;
}

describe("billing entitlement state", () => {
  it("preserves explicit self-hosted and development access", () => {
    assert.deepEqual(entitlementFrom("development"), {
      entitled: true,
      reason: "development",
    });
    assert.deepEqual(entitlementFrom("self-hosted"), {
      entitled: true,
      reason: "self-hosted",
    });
  });

  it("fails closed for incomplete hosted configuration", () => {
    assert.deepEqual(entitlementFrom("misconfigured"), {
      entitled: false,
      reason: "configuration_error",
    });
  });

  it("preserves grandfathered access without marketing it as a new offer", () => {
    assert.deepEqual(
      entitlementFrom("stripe", {
        status: "canceled",
        grandfathered: true,
        currentPeriodEnd: null,
      }),
      {
        entitled: true,
        reason: "grandfathered",
        subscriptionStatus: "canceled",
      },
    );
  });

  it("serves trialing, active, and past-due subscriptions", () => {
    const periodEnd = new Date("2026-09-12T12:00:00.000Z");
    for (const status of ["trialing", "active", "past_due"] as const) {
      assert.deepEqual(
        entitlementFrom("stripe", {
          status,
          grandfathered: false,
          currentPeriodEnd: periodEnd,
        }),
        {
          entitled: true,
          reason: status,
          periodEnd: periodEnd.toISOString(),
          subscriptionStatus: status,
        },
      );
    }
  });

  it("keeps non-serving Stripe statuses bounded behind lapsed", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "paused"] as const) {
      assert.deepEqual(
        entitlementFrom("stripe", {
          status,
          grandfathered: false,
          currentPeriodEnd: null,
        }),
        {
          entitled: false,
          reason: "lapsed",
          subscriptionStatus: status,
        },
      );
    }
  });
});

describe("checkout and subscription reconciliation", () => {
  it("blocks checkout for entitled and recoverable subscriptions", () => {
    assert.equal(checkoutBlocked({ entitled: true, reason: "active" }), true);
    assert.equal(
      checkoutBlocked({
        entitled: false,
        reason: "lapsed",
        subscriptionStatus: "incomplete",
      }),
      true,
    );
    assert.equal(
      checkoutBlocked({
        entitled: false,
        reason: "lapsed",
        subscriptionStatus: "unpaid",
      }),
      true,
    );
  });

  it("allows checkout for a new or terminal subscription", () => {
    assert.equal(checkoutBlocked({ entitled: false, reason: "none" }), false);
    assert.equal(
      checkoutBlocked({
        entitled: false,
        reason: "lapsed",
        subscriptionStatus: "canceled",
      }),
      false,
    );
    assert.equal(
      checkoutBlocked({
        entitled: false,
        reason: "lapsed",
        subscriptionStatus: "incomplete_expired",
      }),
      false,
    );
  });

  it("accepts only the configured recurring price", () => {
    assert.equal(subscriptionUsesPrice(subscription("sub_1", "active"), "price_sync"), true);
    assert.equal(subscriptionUsesPrice(subscription("sub_2", "active", "price_other"), "price_sync"), false);
  });

  it("selects current serving state instead of a late terminal event", () => {
    const selected = selectEffectiveSubscription(
      [
        subscription("sub_old", "canceled", "price_sync", 10),
        subscription("sub_current", "active", "price_sync", 20),
        subscription("sub_other", "active", "price_other", 30),
      ],
      "price_sync",
    );
    assert.equal(selected?.id, "sub_current");
  });

  it("uses a stable, non-identifying idempotency key for the same attempt", () => {
    const first = checkoutIdempotencyKey(
      "person@example.com",
      "/app",
      new Date("2026-08-28T21:10:00Z"),
    );
    const retry = checkoutIdempotencyKey(
      "person@example.com",
      "/app",
      new Date("2026-08-28T21:29:59Z"),
    );
    const nextAttempt = checkoutIdempotencyKey(
      "person@example.com",
      "/app",
      new Date("2026-08-28T21:30:00Z"),
    );

    assert.equal(first, retry);
    assert.notEqual(first, nextAttempt);
    assert.doesNotMatch(first, /person|example/);
  });
});
