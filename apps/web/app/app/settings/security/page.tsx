import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppWorkspace } from "@/lib/app-workspace";
import { SignOutButton } from "../../sign-out-button";

export const metadata = { title: "Account & security — DoodleNote" };

export default async function SecuritySettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">Account &amp; security</h2>
      <p className="mt-1 text-sm text-stone">Account identity, privacy boundaries, and access controls.</p>
      <dl className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
        <div className="border-b border-sand p-4"><dt className="text-xs font-medium text-stone">Signed in email</dt><dd className="mt-1 text-sm font-medium text-ink">{workspace.session.user.email}</dd></div>
        <div className="border-b border-sand p-4"><dt className="text-xs font-medium text-stone">Personal workspace</dt><dd className="mt-1 text-sm text-ink">Private to your account. Meetings are not copied to team workspaces automatically.</dd></div>
        <div className="p-4"><dt className="text-xs font-medium text-stone">Public links</dt><dd className="mt-1 text-sm text-ink">Off by default and controlled per meeting. You can exclude transcripts, add an expiry, or revoke a link immediately.</dd></div>
      </dl>
      <div className="mt-8 rounded-xl border border-sand bg-card p-4"><h3 className="font-display text-base font-semibold text-ink">End this browser session</h3><p className="mt-1 text-sm text-stone">This does not revoke linked DoodleNote devices. Manage those under Sync &amp; devices.</p><div className="mt-4"><SignOutButton /></div></div>
    </section>
  );
}
