import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { WorkspacesPanel } from "./workspaces-panel";

export const metadata = { title: "Workspaces — DoodleNote" };

export default async function WorkspacesPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  // Same fallback as the meetings library: no explicit active workspace
  // means the first one is treated as active.
  const activeOrganizationId =
    session.session.activeOrganizationId ?? organizations[0]?.id ?? null;

  return (
    <WorkspacesPanel
      userEmail={session.user.email}
      activeOrganizationId={activeOrganizationId}
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
      }))}
    />
  );
}
