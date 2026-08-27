import Stripe from "stripe";
import { eq, getDb, subscriptions } from "@repo/db";

import { resolveBillingMode } from "./runtime-config";

/**
 * Cloud-sync billing: $10/month per user, 15-day trial for everyone (card
 * up front), users with a linked device before launch grandfathered free.
 *
 * Local development and explicitly self-hosted installations bypass official
 * DoodleNote billing. Hosted production fails closed unless the full Stripe
 * configuration is present.
 */

export const TRIAL_DAYS = 15;

let stripeClient: Stripe | null = null;

export function billingEnabled(): boolean {
  return resolveBillingMode() === "stripe";
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
  /** Why: grandfathered | trialing | active | self-hosted | development | configuration_error | none | lapsed */
  reason: string;
  /** ISO date the current paid/trial period ends, when known. */
  periodEnd?: string;
}

/** Statuses Stripe considers "keep serving". past_due gets a grace pass so a
 *  failed card doesn't cut sync mid-retry cycle; Stripe cancels it for us. */
const SERVING_STATUSES = new Set(["trialing", "active", "past_due"]);

export async function entitlementFor(userId: string): Promise<Entitlement> {
  const mode = resolveBillingMode();
  if (mode === "self-hosted" || mode === "development") {
    return { entitled: true, reason: mode };
  }
  if (mode === "misconfigured") {
    console.error(
      "[billing] Production billing is incomplete. Configure Stripe or set DOODLENOTE_SELF_HOSTED=true.",
    );
    return { entitled: false, reason: "configuration_error" };
  }
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
