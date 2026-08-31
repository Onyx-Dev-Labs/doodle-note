import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, getDb, subscriptions } from "@repo/db";

import { buttonSecondary } from "@/app/ui";
import { getAppWorkspace } from "@/lib/app-workspace";
import { billingEnabled, getVerifiedStripe } from "@/lib/billing";

import { BillingPortalButton } from "./billing-portal-button";
import {
  billingSettingsState,
  stripeCancellationDate,
} from "./billing-settings-state";

export const metadata = { title: "Billing — DoodleNote" };

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(value);
}

export default async function BillingSettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");

  const [subscription] = await getDb()
    .select({
      status: subscriptions.status,
      grandfathered: subscriptions.grandfathered,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, workspace.session.user.id))
    .limit(1);

  const enabled = billingEnabled();
  let cancellationDate: Date | null = null;
  if (enabled && subscription?.stripeSubscriptionId) {
    try {
      const stripe = await getVerifiedStripe();
      const current = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
      );
      cancellationDate = stripeCancellationDate(
        current.cancel_at,
        current.cancel_at_period_end,
        current.items.data[0]?.current_period_end,
      );
    } catch (error) {
      console.error(
        "[billing] Unable to refresh the scheduled cancellation",
        subscription.stripeSubscriptionId,
        error,
      );
    }
  }

  const state = billingSettingsState(
    enabled,
    subscription ? { ...subscription, cancellationDate } : undefined,
  );
  const periodLabel =
    state.kind === "canceling" && cancellationDate
      ? `Cancels ${formatDate(cancellationDate)}`
      : subscription?.currentPeriodEnd
        ? state.kind === "trialing"
          ? `Trial ends ${formatDate(subscription.currentPeriodEnd)}`
          : state.kind === "active" || state.kind === "attention"
            ? `Current billing period ends ${formatDate(subscription.currentPeriodEnd)}`
            : null
        : null;
  const statusTone =
    state.kind === "active" || state.kind === "trialing" || state.kind === "legacy"
      ? "bg-sage-fill text-sage-deep"
      : state.kind === "attention" || state.kind === "canceling"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "bg-card-soft text-stone";

  return (
    <section className="min-w-0">
      <h2 className="font-display text-xl font-semibold text-ink">Billing</h2>
      <p className="mt-1 text-sm text-stone">
        Manage the subscription that powers DoodleNote Cloud Sync.
      </p>

      <section className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold text-ink">
                Cloud Sync
              </h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}
              >
                {state.title}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-stone">
              {state.description}
            </p>
            {periodLabel && (
              <p className="mt-2 text-sm font-medium text-bark">{periodLabel}</p>
            )}
            {state.kind !== "canceling" && (
              <p className="mt-3 text-sm text-bark">
                15-day trial, then $10 USD per month. Cancel anytime.
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            {state.canManage && <BillingPortalButton />}
            {state.canStart && (
              <Link href="/pricing?checkout=1" className={buttonSecondary}>
                Start Cloud Sync
              </Link>
            )}
          </div>
        </div>
        <div className="border-t border-sand bg-card-soft px-5 py-4 text-sm leading-relaxed text-stone">
          Stripe securely handles your card details, invoices, and cancellation.
          DoodleNote never receives your full card number.
        </div>
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-sand bg-card p-5">
          <h3 className="font-display text-base font-semibold text-ink">
            Payment method
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone">
            Open the Stripe portal to replace an expired card or use a different
            payment method for future renewals.
          </p>
        </section>
        <section className="rounded-xl border border-sand bg-card p-5">
          <h3 className="font-display text-base font-semibold text-ink">
            Cancel Cloud Sync
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone">
            Cancellation is completed in Stripe. Stripe shows when Cloud Sync
            access will end before you confirm the change. On that date,
            DoodleNote permanently deletes the active cloud copy in your Personal
            workspace and disconnects linked Cloud Sync devices. Your local
            notes and recordings remain on your devices. Shared-workspace data
            is retained for the other workspace members.
          </p>
        </section>
      </div>
    </section>
  );
}
