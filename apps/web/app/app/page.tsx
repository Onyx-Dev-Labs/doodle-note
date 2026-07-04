import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { WorkspacesPanel } from "./workspaces-panel";

export const metadata = { title: "Workspaces — Doodle Note" };

export default async function AppPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  return (
    <WorkspacesPanel
      userEmail={session.user.email}
      activeOrganizationId={session.session.activeOrganizationId ?? null}
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
      }))}
    />
  );
}
