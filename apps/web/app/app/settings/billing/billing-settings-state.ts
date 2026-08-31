export type BillingSettingsKind =
  | "unavailable"
  | "legacy"
  | "trialing"
  | "active"
  | "canceling"
  | "attention"
  | "inactive";

export interface BillingSubscriptionSummary {
  status: string;
  grandfathered: boolean;
  stripeCustomerId: string | null;
  cancellationDate?: Date | null;
}

export interface BillingSettingsState {
  kind: BillingSettingsKind;
  title: string;
  description: string;
  canManage: boolean;
  canStart: boolean;
}

const INACTIVE_STATUSES = new Set([
  "none",
  "canceled",
  "incomplete_expired",
  "invalid_price",
]);

export function billingSettingsState(
  enabled: boolean,
  subscription?: BillingSubscriptionSummary,
): BillingSettingsState {
  if (!enabled) {
    return {
      kind: "unavailable",
      title: "Billing unavailable",
      description: "Cloud Sync billing is not enabled for this installation.",
      canManage: false,
      canStart: false,
    };
  }

  if (subscription?.grandfathered) {
    return {
      kind: "legacy",
      title: "Cloud Sync access",
      description:
        "This account has legacy Cloud Sync access and is not billed through Stripe.",
      canManage: false,
      canStart: false,
    };
  }

  if (!subscription || INACTIVE_STATUSES.has(subscription.status)) {
    return {
      kind: "inactive",
      title: "No active subscription",
      description: "Start a 15-day Cloud Sync trial when you are ready.",
      canManage: Boolean(subscription?.stripeCustomerId),
      canStart: true,
    };
  }

  if (
    subscription.cancellationDate &&
    (subscription.status === "trialing" || subscription.status === "active")
  ) {
    return {
      kind: "canceling",
      title: "Cancellation scheduled",
      description: "Cloud Sync remains available until the cancellation date.",
      canManage: Boolean(subscription.stripeCustomerId),
      canStart: false,
    };
  }

  if (subscription.status === "trialing") {
    return {
      kind: "trialing",
      title: "Free trial active",
      description: "Cloud Sync is available during your 15-day trial.",
      canManage: Boolean(subscription.stripeCustomerId),
      canStart: false,
    };
  }

  if (subscription.status === "active") {
    return {
      kind: "active",
      title: "Cloud Sync active",
      description: "Your Cloud Sync subscription is active.",
      canManage: Boolean(subscription.stripeCustomerId),
      canStart: false,
    };
  }

  return {
    kind: "attention",
    title:
      subscription.status === "past_due"
        ? "Payment needs attention"
        : "Subscription needs attention",
    description:
      "Open Stripe to review the subscription or update the payment method.",
    canManage: Boolean(subscription.stripeCustomerId),
    canStart: false,
  };
}

export function stripeCancellationDate(
  cancelAt: number | null,
  cancelAtPeriodEnd: boolean,
  currentPeriodEnd?: number | null,
): Date | null {
  const timestamp =
    cancelAt ?? (cancelAtPeriodEnd ? currentPeriodEnd : null) ?? null;
  return timestamp ? new Date(timestamp * 1000) : null;
}
