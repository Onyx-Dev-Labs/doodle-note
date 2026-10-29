"use client";

import { useState } from "react";

import { buttonPrimary } from "../../ui";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

const FALLBACK_ERROR = "We couldn't connect this email right now. Please try again.";

/** An explicit confirm step, so a mail scanner opening the link links nothing. */
export function ConnectForm({ token, downloadEmail }: { token: string; downloadEmail: string }) {
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function confirm() {
    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/download-leads/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : FALLBACK_ERROR);
      }
      setState({ kind: "connected" });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : FALLBACK_ERROR });
    }
  }

  if (state.kind === "connected") {
    return (
      <p className="mt-6 text-sm font-medium text-sage-deep" role="status">
        Done. {downloadEmail} is now connected to your account.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={confirm}
        disabled={state.kind === "submitting"}
        className={`mt-6 w-full ${buttonPrimary}`}
      >
        {state.kind === "submitting" ? "Connecting…" : "Connect this email"}
      </button>
      <p
        className="mt-3 min-h-5 text-sm text-red-700 dark:text-red-300"
        role={state.kind === "error" ? "alert" : undefined}
        aria-live="polite"
      >
        {state.kind === "error" ? state.message : null}
      </p>
    </>
  );
}
