import type Stripe from "stripe";
import {
  and,
  billingDataDeletions,
  billingNotifications,
  eq,
  getDb,
  isNull,
  lt,
  lte,
  or,
  user,
  type Db,
} from "@repo/db";

import {
  cancellationChange,
  subscriptionCancellationDate,
} from "./billing-cancellation-state";
import {
  buildCancellationScheduledEmail,
  buildCloudSyncEndedEmail,
  type BillingEmailMessage,
} from "./billing-email-content";
import { getVerifiedStripe } from "./billing";
import { selectEffectiveSubscription } from "./billing-state";
import { purgePersonalCloudData } from "./cloud-data-purge";

const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const SERVING_STATUSES = new Set(["trialing", "active", "past_due"]);

async function defaultSendBillingEmail(
  message: BillingEmailMessage,
  idempotencyKey: string,
): Promise<void> {
  const { sendBillingEmail } = await import("./billing-email");
  await sendBillingEmail(message, idempotencyKey);
}

type NotificationKind =
  | "cancellation_scheduled"
  | "cloud_sync_ended";

export interface ReconciledSubscription {
  userId: string | null;
  subscription: Stripe.Subscription;
}

interface LifecycleDependencies {
  db?: Db;
  now?: Date;
  sendEmail?: (
    message: BillingEmailMessage,
    idempotencyKey: string,
  ) => Promise<void>;
  purgeData?: typeof purgePersonalCloudData;
  verifyDeletion?: (
    job: typeof billingDataDeletions.$inferSelect,
  ) => Promise<"ended" | "wait" | "canceled">;
}

function publicOrigin(): string {
  const raw =
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4040");
  return new URL(raw).origin;
}

function stripeCancellationFields(subscription: Stripe.Subscription) {
  return {
    cancelAt: subscription.cancel_at,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: subscription.items.data[0]?.current_period_end,
  };
}

function terminalDate(
  subscription: Stripe.Subscription,
  fallback: Date,
): Date {
  const timestamp =
    subscription.ended_at ??
    subscription.canceled_at ??
    subscription.items.data[0]?.current_period_end;
  return timestamp ? new Date(timestamp * 1000) : fallback;
}

function stripeOperationId(event: Stripe.Event): string {
  const request =
    typeof event.request === "string" ? event.request : event.request?.id;
  return request ?? event.id;
}

async function scheduleDeletion(input: {
  db: Db;
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  scheduledFor: Date;
  now: Date;
}): Promise<void> {
  const [existing] = await input.db
    .select({
      stripeSubscriptionId: billingDataDeletions.stripeSubscriptionId,
      status: billingDataDeletions.status,
    })
    .from(billingDataDeletions)
    .where(eq(billingDataDeletions.userId, input.userId))
    .limit(1);
  if (
    existing?.stripeSubscriptionId === input.stripeSubscriptionId &&
    existing.status === "completed"
  ) {
    return;
  }

  await input.db
    .insert(billingDataDeletions)
    .values({
      userId: input.userId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      scheduledFor: input.scheduledFor,
      status: "pending",
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: billingDataDeletions.userId,
      set: {
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        scheduledFor: input.scheduledFor,
        status: "pending",
        claimedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: input.now,
      },
    });
}

async function cancelDeletion(db: Db, userId: string, now: Date) {
  await db
    .update(billingDataDeletions)
    .set({
      status: "canceled",
      claimedAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(billingDataDeletions.userId, userId),
        eq(billingDataDeletions.status, "pending"),
      ),
    );
}

async function enqueueNotification(input: {
  db: Db;
  dedupeKey: string;
  userId: string;
  kind: NotificationKind;
  effectiveAt: Date;
  now: Date;
}): Promise<void> {
  await input.db
    .insert(billingNotifications)
    .values({
      dedupeKey: input.dedupeKey,
      userId: input.userId,
      kind: input.kind,
      effectiveAt: input.effectiveAt,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: billingNotifications.dedupeKey });
}

export async function processBillingNotification(
  dedupeKey: string,
  dependencies: LifecycleDependencies = {},
): Promise<"sent" | "already_sent" | "claimed" | "missing"> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const [claimed] = await db
    .update(billingNotifications)
    .set({ claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(billingNotifications.dedupeKey, dedupeKey),
        isNull(billingNotifications.sentAt),
        or(
          isNull(billingNotifications.claimedAt),
          lt(billingNotifications.claimedAt, staleBefore),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    const [existing] = await db
      .select({
        sentAt: billingNotifications.sentAt,
        claimedAt: billingNotifications.claimedAt,
      })
      .from(billingNotifications)
      .where(eq(billingNotifications.dedupeKey, dedupeKey))
      .limit(1);
    if (!existing) return "missing";
    return existing.sentAt ? "already_sent" : "claimed";
  }

  const [recipient] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, claimed.userId))
    .limit(1);
  if (!recipient) {
    await db.delete(billingNotifications).where(eq(billingNotifications.id, claimed.id));
    return "missing";
  }

  const origin = publicOrigin();
  const common = {
    email: recipient.email,
    effectiveAt: claimed.effectiveAt,
    mascotUrl: `${origin}/mascot.png`,
  };
  const message =
    claimed.kind === "cancellation_scheduled"
      ? buildCancellationScheduledEmail({
          ...common,
          manageUrl: `${origin}/app/settings/billing`,
        })
      : buildCloudSyncEndedEmail({
          ...common,
          manageUrl: `${origin}/pricing?checkout=1`,
        });

  try {
    await (dependencies.sendEmail ?? defaultSendBillingEmail)(
      message,
      claimed.dedupeKey,
    );
    await db
      .update(billingNotifications)
      .set({ sentAt: now, claimedAt: null, lastError: null, updatedAt: now })
      .where(eq(billingNotifications.id, claimed.id));
    return "sent";
  } catch (error) {
    await db
      .update(billingNotifications)
      .set({
        claimedAt: null,
        lastError: String(error instanceof Error ? error.message : error).slice(
          0,
          500,
        ),
        updatedAt: now,
      })
      .where(eq(billingNotifications.id, claimed.id));
    throw error;
  }
}

async function defaultVerifyDeletion(
  job: typeof billingDataDeletions.$inferSelect,
): Promise<"ended" | "wait" | "canceled"> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  const stripe = await getVerifiedStripe();
  const subscriptionsForCustomer = await stripe.subscriptions.list({
    customer: job.stripeCustomerId,
    status: "all",
    limit: 100,
  });
  const current = selectEffectiveSubscription(
    subscriptionsForCustomer.data,
    priceId,
  );
  if (!current || !SERVING_STATUSES.has(current.status)) return "ended";
  if (current.id !== job.stripeSubscriptionId) return "canceled";
  return subscriptionCancellationDate(stripeCancellationFields(current))
    ? "wait"
    : "canceled";
}

export async function processDueDataDeletions(
  dependencies: LifecycleDependencies & { limit?: number; userId?: string } = {},
): Promise<{
  completed: number;
  waiting: number;
  canceled: number;
  failed: number;
}> {
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const filters = [
    eq(billingDataDeletions.status, "pending"),
    lte(billingDataDeletions.scheduledFor, now),
  ];
  if (dependencies.userId) {
    filters.push(eq(billingDataDeletions.userId, dependencies.userId));
  }
  const due = await db
    .select()
    .from(billingDataDeletions)
    .where(and(...filters))
    .limit(dependencies.limit ?? 10);

  const result = { completed: 0, waiting: 0, canceled: 0, failed: 0 };
  for (const candidate of due) {
    const [job] = await db
      .update(billingDataDeletions)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(billingDataDeletions.userId, candidate.userId),
          eq(billingDataDeletions.status, "pending"),
          or(
            isNull(billingDataDeletions.claimedAt),
            lt(billingDataDeletions.claimedAt, staleBefore),
          ),
        ),
      )
      .returning();
    if (!job) continue;

    try {
      const verification = await (
        dependencies.verifyDeletion ?? defaultVerifyDeletion
      )(job);
      if (verification === "wait") {
        await db
          .update(billingDataDeletions)
          .set({ claimedAt: null, updatedAt: now })
          .where(eq(billingDataDeletions.userId, job.userId));
        result.waiting += 1;
        continue;
      }
      if (verification === "canceled") {
        await cancelDeletion(db, job.userId, now);
        result.canceled += 1;
        continue;
      }

      await (dependencies.purgeData ?? purgePersonalCloudData)({
        db,
        userId: job.userId,
      });
      await db
        .update(billingDataDeletions)
        .set({
          status: "completed",
          claimedAt: null,
          completedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(billingDataDeletions.userId, job.userId));
      const finalNotificationKey = `cloud-sync-ended:${job.stripeSubscriptionId}:${job.scheduledFor.toISOString()}`;
      await enqueueNotification({
        db,
        dedupeKey: finalNotificationKey,
        userId: job.userId,
        kind: "cloud_sync_ended",
        effectiveAt: job.scheduledFor,
        now,
      });
      try {
        await processBillingNotification(finalNotificationKey, dependencies);
      } catch {
        // The durable outbox keeps the email retryable without repeating a
        // successful irreversible data purge.
      }
      result.completed += 1;
    } catch (error) {
      await db
        .update(billingDataDeletions)
        .set({
          claimedAt: null,
          lastError: String(error instanceof Error ? error.message : error).slice(
            0,
            500,
          ),
          updatedAt: now,
        })
        .where(eq(billingDataDeletions.userId, job.userId));
      result.failed += 1;
    }
  }
  return result;
}

export async function processPendingBillingNotifications(
  dependencies: LifecycleDependencies & { limit?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const db = dependencies.db ?? getDb();
  const pending = await db
    .select({ dedupeKey: billingNotifications.dedupeKey })
    .from(billingNotifications)
    .where(isNull(billingNotifications.sentAt))
    .limit(dependencies.limit ?? 20);
  const result = { sent: 0, failed: 0 };
  for (const notification of pending) {
    try {
      const status = await processBillingNotification(
        notification.dedupeKey,
        dependencies,
      );
      if (status === "sent") result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function handleSubscriptionLifecycleEvent(
  event: Stripe.Event,
  reconciled: ReconciledSubscription,
  dependencies: LifecycleDependencies = {},
): Promise<void> {
  if (!reconciled.userId) return;
  const db = dependencies.db ?? getDb();
  const now = dependencies.now ?? new Date();
  const subscription = reconciled.subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const previous =
    event.type === "customer.subscription.updated"
      ? (event.data.previous_attributes ?? {})
      : {};
  const change = cancellationChange(
    stripeCancellationFields(subscription),
    previous as { cancel_at?: number | null; cancel_at_period_end?: boolean },
  );
  const scheduledFor = subscriptionCancellationDate(
    stripeCancellationFields(subscription),
  );
  const incoming = event.data.object as Stripe.Subscription;
  const incomingIsAuthoritative = incoming.id === subscription.id;

  if (SERVING_STATUSES.has(subscription.status) && scheduledFor) {
    await scheduleDeletion({
      db,
      userId: reconciled.userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      scheduledFor,
      now,
    });
    if (incomingIsAuthoritative && change.kind === "scheduled") {
      const dedupeKey =
        `stripe:${stripeOperationId(event)}:cancellation-scheduled`;
      await enqueueNotification({
        db,
        dedupeKey,
        userId: reconciled.userId,
        kind: "cancellation_scheduled",
        effectiveAt: change.scheduledFor,
        now,
      });
      await processBillingNotification(dedupeKey, dependencies);
    }
    return;
  }

  if (SERVING_STATUSES.has(subscription.status)) {
    await cancelDeletion(db, reconciled.userId, now);
    return;
  }

  if (
    event.type === "customer.subscription.deleted" &&
    incomingIsAuthoritative
  ) {
    const deletionDate = terminalDate(subscription, now);
    await scheduleDeletion({
      db,
      userId: reconciled.userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      scheduledFor: deletionDate,
      now,
    });
    const result = await processDueDataDeletions({
      ...dependencies,
      db,
      now,
      userId: reconciled.userId,
      limit: 1,
    });
    if (result.failed > 0) {
      throw new Error("Cloud data deletion failed and remains queued for retry.");
    }
    await processBillingNotification(
      `cloud-sync-ended:${subscription.id}:${deletionDate.toISOString()}`,
      dependencies,
    );
  }
}
