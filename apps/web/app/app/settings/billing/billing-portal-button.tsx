"use client";

import { useState } from "react";

import { buttonPrimary } from "@/app/ui";

export function BillingPortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string;
      } | null;
      if (response.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body?.error ?? "Stripe billing is temporarily unavailable.");
    } catch {
      setError("Stripe billing is temporarily unavailable.");
    }
    setBusy(false);
  }

  return (
    <div>
      <button
        type="button"
        className={buttonPrimary}
        disabled={busy}
        onClick={() => void openPortal()}
      >
        {busy ? "Opening Stripe…" : "Manage subscription"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
