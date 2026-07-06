import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";

import { LinkDeviceForm } from "./link-device-form";

export const metadata = { title: "Connect desktop — DoodleNote" };

/**
 * Landing page for the desktop "Sync with cloud" flow. The desktop app opens
 * this URL with ?port=<loopback port>&name=<device name>; after the signed-in
 * user approves, the browser redirects to 127.0.0.1:<port> with a sync token.
 */
export default async function LinkDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; name?: string }>;
}) {
  const { port, name } = await searchParams;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    const query = new URLSearchParams({
      next: `/link-device?port=${port ?? ""}&name=${name ?? ""}`,
    });
    redirect(`/login?${query}`);
  }

  await ensurePersonalWorkspace(session.user.id);
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  const portNum = Number(port);
  const validPort =
    Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65_535
      ? portNum
      : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-16">
      <LinkDeviceForm
        port={validPort}
        deviceName={(name ?? "Desktop").slice(0, 80)}
        email={session.user.email}
        organizations={organizations.map((org) => ({
          id: org.id,
          name: org.name,
        }))}
      />
    </main>
  );
}
