import Stripe from "stripe";
import { eq, getDb, subscriptions } from "@repo/db";

/**
 * Cloud-sync billing: $10/month per user, 15-day trial for everyone (card
 * up front), users with a linked device before launch grandfathered free.
 *
 * DORMANT WITHOUT KEYS: when STRIPE_SECRET_KEY is unset, every entitlement
 * check passes — the feature ships dark and flips on when the env lands.
 */

export const TRIAL_DAYS = 15;

let stripeClient: Stripe | null = null;

export function billingEnabled(): boolean {
  return typeof process.env.STRIPE_SECRET_KEY === "string" &&
    process.env.STRIPE_SECRET_KEY.length > 0;
}

export function getStripe(): Stripe {
  if (!stripeClient) {
    if (!billingEnabled()) throw new Error("STRIPE_SECRET_KEY is not set");
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeClient;
}

export interface Entitlement {
  entitled: boolean;
  /** Why: grandfathered | trialing | active | disabled (no keys) | none | lapsed */
  reason: string;
  /** ISO date the current paid/trial period ends, when known. */
  periodEnd?: string;
}

/** Statuses Stripe considers "keep serving". past_due gets a grace pass so a
 *  failed card doesn't cut sync mid-retry cycle; Stripe cancels it for us. */
const SERVING_STATUSES = new Set(["trialing", "active", "past_due"]);

export async function entitlementFor(userId: string): Promise<Entitlement> {
  if (!billingEnabled()) return { entitled: true, reason: "disabled" };
  const db = getDb();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const sub = rows[0];
  if (!sub) return { entitled: false, reason: "none" };
  if (sub.grandfathered) return { entitled: true, reason: "grandfathered" };
  if (SERVING_STATUSES.has(sub.status)) {
    return {
      entitled: true,
      reason: sub.status,
      ...(sub.currentPeriodEnd
        ? { periodEnd: sub.currentPeriodEnd.toISOString() }
        : {}),
    };
  }
  return { entitled: false, reason: sub.status === "none" ? "none" : "lapsed" };
}

/** Create-or-fetch the Stripe customer for a user, persisting the mapping. */
export async function ensureCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const existing = rows[0];
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await getStripe().customers.create({
    email,
    metadata: { doodlenoteUserId: userId },
  });
  await db
    .insert(subscriptions)
    .values({ userId, stripeCustomerId: customer.id, status: "none" })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    });
  return customer.id;
}

/** Mirror a Stripe subscription event into our table. */
export async function recordSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.doodlenoteUserId;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const db = getDb();

  // Resolve the user: metadata first, customer mapping as fallback.
  let targetUserId = userId;
  if (!targetUserId) {
    const rows = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);
    targetUserId = rows[0]?.userId;
  }
  if (!targetUserId) {
    console.error("[billing] subscription event with unknown user", sub.id);
    return;
  }

  const periodEnd = sub.items.data[0]?.current_period_end;
  await db
    .insert(subscriptions)
    .values({
      userId: targetUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        updatedAt: new Date(),
      },
    });
}
