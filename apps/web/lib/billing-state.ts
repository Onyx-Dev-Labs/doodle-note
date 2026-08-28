import { createHash } from "node:crypto";

import type Stripe from "stripe";

import type { BillingMode } from "./runtime-config";

export type EntitlementReason =
  | "grandfathered"
  | "trialing"
  | "active"
  | "past_due"
  | "self-hosted"
  | "development"
  | "configuration_error"
  | "none"
  | "lapsed";

export interface Entitlement {
  entitled: boolean;
  reason: EntitlementReason;
  /** ISO date the current paid/trial period ends, when known. */
  periodEnd?: string;
  /** Raw persisted Stripe status for server-side recovery and Checkout guards. */
  subscriptionStatus?: string;
}

export interface SubscriptionState {
  status: string;
  grandfathered: boolean;
  currentPeriodEnd: Date | null;
}

const SERVING_STATUSES = new Set(["trialing", "active", "past_due"]);
const CHECKOUT_RETRY_STATUSES = new Set([
  "none",
  "canceled",
  "incomplete_expired",
  "invalid_price",
]);

export function entitlementFrom(
  mode: BillingMode,
  subscription?: SubscriptionState,
): Entitlement {
  if (mode === "self-hosted" || mode === "development") {
    return { entitled: true, reason: mode };
  }
  if (mode === "misconfigured") {
    return { entitled: false, reason: "configuration_error" };
  }
  if (!subscription) return { entitled: false, reason: "none" };

  if (subscription.grandfathered) {
    return {
      entitled: true,
      reason: "grandfathered",
      subscriptionStatus: subscription.status,
    };
  }
  if (SERVING_STATUSES.has(subscription.status)) {
    return {
      entitled: true,
      reason: subscription.status as "trialing" | "active" | "past_due",
      ...(subscription.currentPeriodEnd
        ? { periodEnd: subscription.currentPeriodEnd.toISOString() }
        : {}),
      subscriptionStatus: subscription.status,
    };
  }
  return {
    entitled: false,
    reason: subscription.status === "none" ? "none" : "lapsed",
    subscriptionStatus: subscription.status,
  };
}

/** Prevent a second subscription while access or a recoverable attempt exists. */
export function checkoutBlocked(entitlement: Entitlement): boolean {
  if (entitlement.entitled || entitlement.reason === "configuration_error") {
    return true;
  }
  return entitlement.subscriptionStatus
    ? !CHECKOUT_RETRY_STATUSES.has(entitlement.subscriptionStatus)
    : false;
}

export function subscriptionUsesPrice(
  subscription: Stripe.Subscription,
  priceId: string,
): boolean {
  return subscription.items.data.some(
    (item) => item.price.id === priceId && (item.quantity ?? 1) === 1,
  );
}

function subscriptionPriority(status: Stripe.Subscription.Status): number {
  if (SERVING_STATUSES.has(status)) return 3;
  if (status === "incomplete" || status === "paused" || status === "unpaid") {
    return 2;
  }
  return 1;
}

/**
 * Stripe does not guarantee webhook order. Reconcile against the current
 * subscription list, preferring a serving/recoverable subscription over a
 * late terminal event and ignoring products outside the configured Price.
 */
export function selectEffectiveSubscription(
  subscriptions: Stripe.Subscription[],
  priceId: string,
): Stripe.Subscription | undefined {
  return subscriptions
    .filter((subscription) => subscriptionUsesPrice(subscription, priceId))
    .sort((left, right) => {
      const byState =
        subscriptionPriority(right.status) - subscriptionPriority(left.status);
      return byState || right.created - left.created;
    })[0];
}

/** A short-lived stable key makes concurrent/retried Checkout POSTs idempotent. */
export function checkoutIdempotencyKey(
  userId: string,
  next: string,
  now = new Date(),
): string {
  const halfHour = Math.floor(now.getTime() / (30 * 60 * 1000));
  const digest = createHash("sha256")
    .update(`${userId}\0${next}\0${halfHour}`)
    .digest("hex");
  return `doodlenote-checkout-${digest}`;
}
