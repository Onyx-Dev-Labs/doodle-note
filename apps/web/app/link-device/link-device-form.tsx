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
  deviceName,
  email,
  organizations,
}: {
  port: number | null;
  deviceName: string;
  email: string;
  organizations: Array<{ id: string; name: string }>;
}) {
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    if (!port) return;
    setError(null);
    setPending(true);
    const response = await fetch("/api/device/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, deviceName }),
    });
    const body = await response.json();
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
    window.location.href = `http://127.0.0.1:${port}/callback?${params}`;
  }

  if (!port) {
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
        This computer will sync meetings, transcripts, and notes to the
        workspace below, signed in as <strong>{email}</strong>.
      </p>

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
          {pending ? "Connecting…" : "Connect desktop app"}
        </button>
      )}
    </DialogCard>
  );
}
