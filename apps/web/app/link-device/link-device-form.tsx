"use client";

import Image from "next/image";
import { useState } from "react";

import { buttonPrimary, inputClass } from "../ui";

function DialogCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-sand bg-card p-6 shadow-[0_1px_0_var(--color-sand),0_12px_32px_-20px_rgba(38,40,31,0.35)]">
      <Image
        src="/mascot.png"
        alt=""
        width={40}
        height={40}
        className="rounded-lg"
        unoptimized
      />
      {children}
    </div>
  );
}

export function LinkDeviceForm({
  port,
  callbackScheme,
  personalOrganizationId,
  deviceName,
  email,
  organizations,
}: {
  port: number | null;
  /** Custom URL scheme callback for mobile apps (e.g. "doodlenote"). */
  callbackScheme?: string | null;
  personalOrganizationId: string | null;
  deviceName: string;
  email: string;
  organizations: Array<{ id: string; name: string }>;
}) {
  const [organizationId, setOrganizationId] = useState(
    personalOrganizationId ?? organizations[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCallback = Boolean(port || callbackScheme);

  async function handleApprove() {
    if (!hasCallback) return;
    setError(null);
    setPending(true);
    const response = await fetch("/api/device/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        deviceName,
        platform: callbackScheme ? "ios" : "desktop",
      }),
    });
    const body = await response.json();
    if (response.status === 402 && body.needsSubscription) {
      // Cloud sync is subscription-backed: hand off to Stripe Checkout
      // (15-day free trial), then return here to finish linking.
      const checkout = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          next: window.location.pathname + window.location.search,
        }),
      });
      const checkoutBody = await checkout.json();
      setPending(false);
      if (checkout.ok && typeof checkoutBody.url === "string") {
        window.location.href = checkoutBody.url;
      } else {
        setError(checkoutBody.error ?? "Could not start checkout");
      }
      return;
    }
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Could not link the device");
      return;
    }
    setDone(true);
    const params = new URLSearchParams({
      token: body.token,
      email: body.email,
      workspace: body.workspaceName,
    });
    window.location.href = callbackScheme
      ? `${callbackScheme}://link?${params}`
      : `http://127.0.0.1:${port}/callback?${params}`;
  }

  if (!hasCallback) {
    return (
      <DialogCard>
        <h1 className="mt-4 font-display text-lg font-semibold text-ink">
          Connect DoodleNote
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-bark">
          This page is opened by the DoodleNote desktop app. Start the
          connection from <strong>Settings → Sync with cloud</strong> on your
          computer.
        </p>
      </DialogCard>
    );
  }

  return (
    <DialogCard>
      <h1 className="mt-4 font-display text-lg font-semibold text-ink">
        Connect &ldquo;{deviceName}&rdquo;?
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-bark">
        This {callbackScheme ? "device" : "computer"} will sync meetings,
        transcripts, and notes to the workspace below, signed in as{" "}
        <strong>{email}</strong>.
      </p>

      {organizationId === personalOrganizationId && (
        <p className="mt-3 rounded-lg bg-sage-fill px-3 py-2 text-xs leading-relaxed text-sage-deep">
          Personal is private to you. You can deliberately move individual
          meetings into a shared workspace later.
        </p>
      )}

      {organizations.length > 1 && (
        <label className="mt-4 block text-sm text-bark">
          Workspace
          <select
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            className={`mt-1 ${inputClass}`}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {done ? (
        <p className="mt-4 rounded-lg bg-sage-fill px-3 py-2 text-sm text-sage-deep">
          Connected — taking you to your meetings…
        </p>
      ) : (
        <button
          type="button"
          disabled={pending || !organizationId}
          onClick={handleApprove}
          className={`mt-5 w-full ${buttonPrimary}`}
        >
          {pending
            ? "Connecting…"
            : callbackScheme
              ? "Connect this device"
              : "Connect desktop app"}
        </button>
      )}
    </DialogCard>
  );
}
