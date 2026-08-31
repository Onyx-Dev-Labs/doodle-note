import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type Stripe from "stripe";
import {
  billingDataDeletions,
  billingNotifications,
  eq,
  organization,
  member,
  subscriptions,
  user,
} from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import type { BillingEmailMessage } from "../lib/billing-email-content";
import {
  handleSubscriptionLifecycleEvent,
  processDueDataDeletions,
} from "../lib/billing-lifecycle";

let mem: InMemoryDb;
const userId = "lifecycle-user";
const subscriptionId = "sub_lifecycle";
const customerId = "cus_lifecycle";
const now = new Date("2026-09-01T12:00:00.000Z");
const scheduledFor = new Date("2026-09-15T00:00:00.000Z");

function stripeSubscription(input: {
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd?: boolean;
  endedAt?: number | null;
}): Stripe.Subscription {
  return {
    id: subscriptionId,
    object: "subscription",
    created: 1_800_000_000,
    status: input.status,
    customer: customerId,
    cancel_at: null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    canceled_at: input.endedAt ?? null,
    ended_at: input.endedAt ?? null,
    metadata: { doodlenoteUserId: userId },
    items: {
      object: "list",
      data: [
        {
          id: "si_lifecycle",
          object: "subscription_item",
          price: { id: "price_sync" },
          quantity: 1,
          current_period_end: Math.floor(scheduledFor.getTime() / 1000),
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "/v1/subscription_items",
    },
  } as unknown as Stripe.Subscription;
}

function stripeEvent(
  id: string,
  type:
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  subscription: Stripe.Subscription,
  previousAttributes: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2026-02-25.clover",
    created: Math.floor(now.getTime() / 1000),
    data: {
      object: subscription,
      previous_attributes: previousAttributes,
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as unknown as Stripe.Event;
}

before(async () => {
  mem = await createInMemoryDb();
  await mem.db.insert(user).values({
    id: userId,
    name: "Lifecycle User",
    email: "lifecycle@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await mem.db.insert(organization).values({
    id: "lifecycle-personal",
    name: "Personal",
    slug: "personal-lifecycle",
    createdAt: now,
  });
  await mem.db.insert(member).values({
    id: "lifecycle-member",
    organizationId: "lifecycle-personal",
    userId,
    role: "owner",
    createdAt: now,
  });
  await mem.db.insert(subscriptions).values({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status: "active",
    currentPeriodEnd: scheduledFor,
  });
});

after(async () => {
  await mem.close();
});

describe("durable cancellation processing", () => {
  it("sends the scheduled email once and persists the deletion date", async () => {
    const sent: BillingEmailMessage[] = [];
    const idempotencyKeys: string[] = [];
    const subscription = stripeSubscription({
      status: "active",
      cancelAtPeriodEnd: true,
    });
    const event = stripeEvent("evt_scheduled", "customer.subscription.updated", subscription, {
      cancel_at_period_end: false,
    });
    const dependencies = {
      db: mem.db,
      now,
      sendEmail: async (
        message: BillingEmailMessage,
        idempotencyKey: string,
      ) => {
        sent.push(message);
        idempotencyKeys.push(idempotencyKey);
      },
    };

    await handleSubscriptionLifecycleEvent(
      event,
      { userId, subscription },
      dependencies,
    );
    await handleSubscriptionLifecycleEvent(
      event,
      { userId, subscription },
      dependencies,
    );

    const [job] = await mem.db
      .select()
      .from(billingDataDeletions)
      .where(eq(billingDataDeletions.userId, userId));
    const notifications = await mem.db
      .select()
      .from(billingNotifications)
      .where(eq(billingNotifications.userId, userId));
    assert.equal(job?.status, "pending");
    assert.equal(job?.scheduledFor.toISOString(), scheduledFor.toISOString());
    assert.equal(sent.length, 1);
    assert.deepEqual(idempotencyKeys, [
      "stripe:evt_scheduled:cancellation-scheduled",
    ]);
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0]?.sentAt);
  });

  it("does not purge while Stripe still reports a serving subscription", async () => {
    let purgeCount = 0;
    const result = await processDueDataDeletions({
      db: mem.db,
      now: new Date("2026-09-15T01:00:00.000Z"),
      verifyDeletion: async () => "wait",
      purgeData: async () => {
        purgeCount += 1;
        return { personalWorkspaceCount: 1, meetingCount: 1 };
      },
    });

    const [job] = await mem.db
      .select()
      .from(billingDataDeletions)
      .where(eq(billingDataDeletions.userId, userId));
    assert.deepEqual(result, {
      completed: 0,
      waiting: 1,
      canceled: 0,
      failed: 0,
    });
    assert.equal(purgeCount, 0);
    assert.equal(job?.status, "pending");
  });

  it("cancels the deletion job when the subscriber resumes", async () => {
    const subscription = stripeSubscription({ status: "active" });
    await handleSubscriptionLifecycleEvent(
      stripeEvent("evt_resumed", "customer.subscription.updated", subscription, {
        cancel_at_period_end: true,
      }),
      { userId, subscription },
      { db: mem.db, now, sendEmail: async () => {} },
    );

    const [job] = await mem.db
      .select()
      .from(billingDataDeletions)
      .where(eq(billingDataDeletions.userId, userId));
    assert.equal(job?.status, "canceled");
  });

  it("purges once after Stripe confirms expiration and sends the final email once", async () => {
    const sent: BillingEmailMessage[] = [];
    let purgeAttempts = 0;
    let emailAttempts = 0;
    const endedAt = Math.floor(scheduledFor.getTime() / 1000);
    const subscription = stripeSubscription({ status: "canceled", endedAt });
    const event = stripeEvent(
      "evt_ended",
      "customer.subscription.deleted",
      subscription,
    );
    const dependencies = {
      db: mem.db,
      now: new Date("2026-09-15T01:00:00.000Z"),
      sendEmail: async (message: BillingEmailMessage) => {
        emailAttempts += 1;
        if (emailAttempts === 1) {
          throw new Error("temporary email provider failure");
        }
        sent.push(message);
      },
      verifyDeletion: async () => "ended" as const,
      purgeData: async () => {
        purgeAttempts += 1;
        if (purgeAttempts === 1) {
          throw new Error("temporary blob provider failure");
        }
        return { personalWorkspaceCount: 1, meetingCount: 1 };
      },
    };

    await assert.rejects(
      handleSubscriptionLifecycleEvent(
        event,
        { userId, subscription },
        dependencies,
      ),
      /remains queued for retry/,
    );
    await handleSubscriptionLifecycleEvent(
      event,
      { userId, subscription },
      dependencies,
    );

    const [job] = await mem.db
      .select()
      .from(billingDataDeletions)
      .where(eq(billingDataDeletions.userId, userId));
    const notifications = await mem.db
      .select()
      .from(billingNotifications)
      .where(eq(billingNotifications.userId, userId));
    assert.equal(job?.status, "completed");
    assert.ok(job?.completedAt);
    assert.equal(purgeAttempts, 2);
    assert.equal(emailAttempts, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.subject, "Your DoodleNote Cloud Sync has ended");
    assert.equal(notifications.length, 2);
  });
});
