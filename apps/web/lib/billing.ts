import { createHash } from "node:crypto";

import Stripe from "stripe";
import { eq, getDb, subscriptions } from "@repo/db";

import {
  checkoutBlocked,
  entitlementFrom,
  selectEffectiveSubscription,
  subscriptionUsesPrice,
  type Entitlement,
} from "./billing-state";
import { resolveBillingMode } from "./runtime-config";

export type { Entitlement, EntitlementReason } from "./billing-state";

/**
 * Cloud-sync billing: $10/month per user, 15-day trial for everyone (card
 * up front), with existing legacy access preserved until a separate migration.
 *
 * Local development and explicitly self-hosted installations bypass official
 * DoodleNote billing. Hosted production fails closed unless the full Stripe
 * configuration is present.
 */

export const TRIAL_DAYS = 15;

let stripeClient: Stripe | null = null;
let verifiedStripe: Promise<Stripe> | null = null;

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

/** Confirm the secret key belongs to the explicitly configured Stripe account. */
export async function getVerifiedStripe(): Promise<Stripe> {
  if (!verifiedStripe) {
    const stripe = getStripe();
    const expectedAccountId = process.env.STRIPE_ACCOUNT_ID;
    verifiedStripe = stripe.accounts
      .retrieveCurrent()
      .then((account) => {
        if (!expectedAccountId || account.id !== expectedAccountId) {
          throw new Error("Stripe account does not match STRIPE_ACCOUNT_ID");
        }
        return stripe;
      })
      .catch((error: unknown) => {
        verifiedStripe = null;
        throw error;
      });
  }
  return verifiedStripe;
}

export async function entitlementFor(userId: string): Promise<Entitlement> {
  const mode = resolveBillingMode();
  if (mode === "misconfigured") {
    console.error(
      "[billing] Production billing is incomplete. Configure Stripe or set DOODLENOTE_SELF_HOSTED=true.",
    );
  }
  if (mode !== "stripe") return entitlementFrom(mode);

  const db = getDb();
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const sub = rows[0];
  return entitlementFrom(mode, sub);
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

  const stripe = await getVerifiedStripe();
  const customer = await stripe.customers.create(
    {
      email,
      metadata: { doodlenoteUserId: userId },
    },
    {
      idempotencyKey: `doodlenote-customer-${createHash("sha256").update(userId).digest("hex")}`,
    },
  );
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
export async function recordSubscription(
  sub: Stripe.Subscription,
): Promise<string | null> {
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
    return null;
  }

  const periodEnd = sub.items.data[0]?.current_period_end;
  const configuredPriceId = process.env.STRIPE_PRICE_ID;
  const status =
    configuredPriceId && subscriptionUsesPrice(sub, configuredPriceId)
      ? sub.status
      : "invalid_price";
  await db
    .insert(subscriptions)
    .values({
      userId: targetUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        updatedAt: new Date(),
      },
    });
  return targetUserId;
}

/**
 * Re-read the customer's current Stripe subscriptions for every lifecycle
 * event. Stripe can deliver events more than once and out of order, so the
 * event body alone is not authoritative enough to overwrite current access.
 */
export async function reconcileSubscription(
  incoming: Stripe.Subscription,
): Promise<{
  userId: string | null;
  subscription: Stripe.Subscription;
}> {
  const customerId =
    typeof incoming.customer === "string"
      ? incoming.customer
      : incoming.customer.id;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");

  const stripe = await getVerifiedStripe();
  const current = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const subscription =
    selectEffectiveSubscription(current.data, priceId) ?? incoming;
  const userId = await recordSubscription(subscription);
  return { userId, subscription };
}

/** Return the current configured-Price subscription when Checkout must stop. */
export async function blockingSubscriptionForCustomer(
  customerId: string,
): Promise<Stripe.Subscription | undefined> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");

  const stripe = await getVerifiedStripe();
  const current = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const subscription = selectEffectiveSubscription(current.data, priceId);
  if (!subscription) return undefined;

  const entitlement = entitlementFrom("stripe", {
    status: subscription.status,
    grandfathered: false,
    currentPeriodEnd: null,
  });
  return checkoutBlocked(entitlement) ? subscription : undefined;
}
