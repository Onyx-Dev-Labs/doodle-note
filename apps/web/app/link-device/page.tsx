import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getAppWorkspace } from "@/lib/app-workspace";

import { LinkDeviceForm } from "./link-device-form";

export const metadata = { title: "Connect device — DoodleNote" };

/** Custom URL schemes allowed as link callbacks (mobile apps). */
const ALLOWED_SCHEMES = new Set(["doodlenote"]);

/**
 * Landing page for the device "Sync with cloud" flow.
 *
 * Desktop opens this URL with ?port=<loopback port>&name=<device name>; after
 * the signed-in user approves, the browser redirects to 127.0.0.1:<port> with
 * a sync token. The iOS app opens it with ?scheme=doodlenote&name=<device>
 * inside ASWebAuthenticationSession and receives the token via
 * doodlenote://link?token=... instead.
 */
export default async function LinkDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; name?: string; scheme?: string }>;
}) {
  const { port, name, scheme } = await searchParams;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    // Encode the inner params individually — a device name with spaces
    // ("iPhone 17 Pro") otherwise lands raw in the login form's callbackURL,
    // which Better Auth rejects with INVALID_CALLBACK_URL.
    const inner = new URLSearchParams({
      port: port ?? "",
      scheme: scheme ?? "",
      name: name ?? "",
    });
    const query = new URLSearchParams({ next: `/link-device?${inner}` });
    redirect(`/login?${query}`);
  }

  const workspace = await getAppWorkspace(requestHeaders);
  const organizations = workspace?.organizations ?? [];

  const portNum = Number(port);
  const validPort =
    Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65_535
      ? portNum
      : null;
  const validScheme = scheme && ALLOWED_SCHEMES.has(scheme) ? scheme : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-16">
      <LinkDeviceForm
        port={validPort}
        callbackScheme={validScheme}
        personalOrganizationId={workspace?.personal.id ?? null}
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
