"use client";

import { useEffect, useState } from "react";

import { buttonPrimary } from "../ui";
import {
  billingViewFromStatus,
  type BillingView,
} from "./billing-view";

/**
 * The Sync plan's call to action, state-aware: signed-out visitors go to
 * login, new users to Stripe Checkout (15-day trial), subscribers to the
 * billing portal.
 */
export function CheckoutButton() {
  const [view, setView] = useState<BillingView>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function go(endpoint: "checkout" | "portal") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${endpoint}`, {
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
      setError(body.error ?? "Something went wrong — try again.");
    } catch {
      setError("Something went wrong — try again.");
    }
    setBusy(false);
  }

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
        <button
          type="button"
          className={buttonPrimary}
          disabled={busy}
          onClick={() => void go("portal")}
        >
          Manage billing
        </button>
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
        <a href="/login?next=/pricing" className={buttonPrimary}>
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
        onClick={() => void go("checkout")}
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
