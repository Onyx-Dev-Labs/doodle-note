"use client";

import { useEffect, useState } from "react";

import { buttonPrimary } from "../ui";

type BillingView =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "disabled" } // billing not enabled yet — early access continues
  | { kind: "start-trial" }
  | { kind: "subscribed"; reason: string }
  | { kind: "grandfathered" };

/**
 * The Sync plan's call to action, state-aware: signed-out visitors go to
 * login, new users to Stripe Checkout (15-day trial), subscribers to the
 * billing portal, and grandfathered accounts get a thank-you instead of
 * a checkout.
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
        const body = await res.json();
        if (!body.billingEnabled) setView({ kind: "disabled" });
        else if (body.reason === "signed-out") setView({ kind: "signed-out" });
        else if (body.reason === "grandfathered") setView({ kind: "grandfathered" });
        else if (body.entitled) setView({ kind: "subscribed", reason: body.reason });
        else setView({ kind: "start-trial" });
      })
      .catch(() => {
        if (!cancelled) setView({ kind: "signed-out" });
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
      setError(body.error ?? "Something went wrong — try again.");
    } catch {
      setError("Something went wrong — try again.");
    }
    setBusy(false);
  }

  if (view.kind === "grandfathered") {
    return (
      <p className="rounded-lg bg-sage-fill px-3 py-2 text-sm text-sage-deep">
        You&rsquo;re an early supporter — Sync is free on your account, forever.
      </p>
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
          Free during early access — billing starts when Sync leaves beta.
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
        {busy ? "Opening checkout…" : "Start your 15-day free trial"}
      </button>
      <p className="text-xs text-stone">
        Card up front, cancel anytime. Beta code? Enter it at checkout.
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
