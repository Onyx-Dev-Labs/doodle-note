"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Device {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
}

function deviceStatus(lastSeenAt: string | null): { label: string; tone: string } {
  if (!lastSeenAt) return { label: "Never synced", tone: "text-amber-800 dark:text-amber-200" };
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (age < 10 * 60 * 1000) return { label: "Online recently", tone: "text-sage-deep" };
  if (age < 24 * 60 * 60 * 1000) return { label: "Seen today", tone: "text-sage-deep" };
  return { label: `Last seen ${new Date(lastSeenAt).toLocaleDateString()}`, tone: "text-stone" };
}

export function DevicesPanel({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    setPendingId(id);
    const response = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    setPendingId(null);
    if (!response.ok) {
      setError("Could not revoke this device. Try again.");
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-ink">Linked devices</h2>
          <p className="mt-1 text-sm text-stone">Last seen updates when a device contacts the cloud sync service.</p>
        </div>
        <button type="button" onClick={() => router.refresh()} className="shrink-0 rounded-lg border border-sand bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill">Check status</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {devices.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-sand bg-card-soft p-6 text-center">
          <p className="text-sm font-medium text-ink">No devices are linked</p>
          <p className="mt-1 text-sm text-stone">Open DoodleNote on a computer or iPhone and choose Settings → Sync with cloud.</p>
        </div>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
          {devices.map((device) => {
            const status = deviceStatus(device.lastSeenAt);
            return (
              <li key={device.id} className="flex flex-col justify-between gap-3 border-b border-sand p-4 last:border-b-0 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{device.deviceName}</p>
                  <p className="mt-0.5 text-xs text-stone">{device.platform === "ios" ? "iPhone or iPad" : device.platform === "desktop" ? "Desktop app" : "DoodleNote app"} · Linked {new Date(device.createdAt).toLocaleDateString()}</p>
                  <p className={`mt-1 text-xs font-medium ${status.tone}`}>{status.label}</p>
                </div>
                {confirmId === device.id ? (
                  <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
                    <button
                      type="button"
                      disabled={pendingId === device.id}
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-bark hover:bg-card-soft disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === device.id}
                      onClick={() => void revoke(device.id)}
                      className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {pendingId === device.id ? "Revoking…" : "Confirm revoke"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(device.id)}
                    className="shrink-0 self-start rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950 sm:self-auto"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
