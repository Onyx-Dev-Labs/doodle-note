import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq, getDb, meetings, sql, syncDevices } from "@repo/db";

import { getAppWorkspace } from "@/lib/app-workspace";
import { DevicesPanel } from "./devices-panel";

export const metadata = { title: "Sync & devices — DoodleNote" };

export default async function SyncSettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  const db = getDb();
  const [devices, counts] = await Promise.all([
    db.select({ id: syncDevices.id, deviceName: syncDevices.deviceName, platform: syncDevices.platform, createdAt: syncDevices.createdAt, lastSeenAt: syncDevices.lastSeenAt }).from(syncDevices).where(eq(syncDevices.userId, workspace.session.user.id)).orderBy(desc(syncDevices.lastSeenAt), desc(syncDevices.createdAt)),
    db.select({ meetings: sql<number>`count(*)::int` }).from(meetings).where(eq(meetings.organizationId, workspace.activeOrganization.id)),
  ]);

  return (
    <section className="min-w-0">
      <DevicesPanel devices={devices.map((device) => ({ ...device, createdAt: (device.createdAt ?? new Date()).toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null }))} />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-sand bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone">Cloud library</p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink">{counts[0]?.meetings ?? 0}</p>
          <p className="mt-1 text-sm text-stone">meetings in {workspace.activeOrganization.name}</p>
        </section>
        <section className="rounded-xl border border-sand bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone">Data safety</p>
          <p className="mt-2 text-sm font-medium text-ink">Cloud access is revocable</p>
          <p className="mt-1 text-sm leading-relaxed text-stone">Revoke a lost device here. Public meeting links are controlled separately on each meeting.</p>
        </section>
      </div>
    </section>
  );
}
