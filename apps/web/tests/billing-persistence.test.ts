import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type Stripe from "stripe";
import { eq, subscriptions, user } from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

let mem: InMemoryDb;
let recordSubscription: (
  subscription: Stripe.Subscription,
) => Promise<string | null>;

function subscription(priceId = "price_sync"): Stripe.Subscription {
  return {
    id: "sub_fixture",
    object: "subscription",
    created: 1_800_000_000,
    status: "active",
    customer: "cus_fixture",
    metadata: { doodlenoteUserId: "billing-user" },
    items: {
      object: "list",
      data: [
        {
          id: "si_fixture",
          object: "subscription_item",
          created: 1_800_000_000,
          current_period_end: 1_900_000_000,
          current_period_start: 1_800_000_000,
          discounts: [],
          metadata: {},
          price: { id: priceId },
          quantity: 1,
          subscription: "sub_fixture",
          tax_rates: [],
        } as unknown as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "/v1/subscription_items?subscription=sub_fixture",
    },
  } as unknown as Stripe.Subscription;
}

before(async () => {
  process.env.STRIPE_PRICE_ID = "price_sync";
  mem = await createInMemoryDb();
  (globalThis as { __repoDbClient?: unknown }).__repoDbClient = mem.db;
  ({ recordSubscription } = await import("../lib/billing"));
  await mem.db.insert(user).values({
    id: "billing-user",
    name: "Billing User",
    email: "billing-user@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

after(async () => {
  delete (globalThis as { __repoDbClient?: unknown }).__repoDbClient;
  await mem.close();
});

describe("subscription persistence", () => {
  it("is effect-idempotent for a repeated subscription event", async () => {
    await recordSubscription(subscription());
    await recordSubscription(subscription());

    const rows = await mem.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "billing-user"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.stripeSubscriptionId, "sub_fixture");
    assert.equal(rows[0]?.status, "active");
  });

  it("does not grant access for a subscription on another Price", async () => {
    await recordSubscription(subscription("price_other"));

    const row = await mem.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, "billing-user"))
      .limit(1);
    assert.equal(row[0]?.status, "invalid_price");
  });
});
