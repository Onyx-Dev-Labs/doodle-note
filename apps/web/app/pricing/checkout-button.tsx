"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buttonPrimary } from "../ui";
import {
  billingViewFromStatus,
  type BillingView,
} from "./billing-view";
import {
  shouldAutoStartTrialCheckout,
  TRIAL_LOGIN_PATH,
} from "./trial-flow";

/**
 * The Sync plan's call to action, state-aware: signed-out visitors go to
 * login, new users to Stripe Checkout (15-day trial), subscribers to the
 * in-app billing settings page.
 */
export function CheckoutButton({
  autoCheckout = false,
}: {
  autoCheckout?: boolean;
}) {
  const [view, setView] = useState<BillingView>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoCheckoutAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/status")
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => null);
        setView(billingViewFromStatus(res.ok, body));
      })
      .catch(() => {
        if (!cancelled) setView({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next: "/app" }),
      });
      const body = await res.json();
      if (res.ok && typeof body.url === "string") {
        window.location.href = body.url;
        return;
      }
      if (body.manageBilling === true) {
        setView({ kind: "subscribed", reason: "billing_attention" });
      }
      setError(body.error ?? "Something went wrong. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (
      !shouldAutoStartTrialCheckout({
        requested: autoCheckout,
        attempted: autoCheckoutAttempted.current,
        viewKind: view.kind,
      })
    ) {
      return;
    }

    autoCheckoutAttempted.current = true;
    window.history.replaceState(null, "", "/pricing");
    void go();
  }, [autoCheckout, go, view.kind]);

  if (view.kind === "legacy-access") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <a href="/app" className={buttonPrimary}>
          Open DoodleNote
        </a>
        <p className="text-xs text-stone">
          Sync access is already active for this account.
        </p>
      </div>
    );
  }

  if (view.kind === "subscribed") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <a href="/app/settings/billing" className={buttonPrimary}>
          Manage subscription
        </a>
        <p className="text-xs text-stone">
          {view.reason === "trialing"
            ? "You're on the free trial."
            : view.reason === "past_due" || view.reason === "billing_attention"
              ? "Your billing needs attention."
              : "Your subscription is active."}
        </p>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  if (view.kind === "disabled") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <a href="/login" className={buttonPrimary}>
          Get started
        </a>
        <p className="text-xs text-stone">
          Billing is temporarily unavailable. Try again soon.
        </p>
      </div>
    );
  }

  if (view.kind === "configuration-error") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <button type="button" className={buttonPrimary} disabled>
          Billing unavailable
        </button>
        <p role="alert" className="text-xs text-red-700">
          Cloud Sync billing is not configured correctly. Please try again later.
        </p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <button
          type="button"
          className={buttonPrimary}
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        <p role="alert" className="text-xs text-red-700">
          We could not check billing status. No subscription was started.
        </p>
      </div>
    );
  }

  if (view.kind === "signed-out") {
    return (
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <a href={TRIAL_LOGIN_PATH} className={buttonPrimary}>
          Start your 15-day free trial
        </a>
        <p className="text-xs text-stone">
          Card up front, cancel anytime. Beta code? Enter it at checkout.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <button
        type="button"
        className={buttonPrimary}
        disabled={busy || view.kind === "loading"}
        onClick={() => void go()}
      >
        {busy
          ? "Opening checkout…"
          : view.kind === "loading"
            ? "Checking billing…"
            : "Start your 15-day free trial"}
      </button>
      <p className="text-xs text-stone">
        Card up front, cancel anytime. Beta code? Enter it at checkout.
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
