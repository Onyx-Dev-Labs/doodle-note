import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppWorkspace } from "@/lib/app-workspace";
import { WorkspacePanel } from "./workspace-panel";

export const metadata = { title: "Workspace settings — DoodleNote" };

export default async function WorkspaceSettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  return <WorkspacePanel activeOrganizationId={workspace.activeOrganization.id} organizations={workspace.organizations.map((organization) => ({ id: organization.id, name: organization.name, slug: organization.slug, personal: organization.id === workspace.personal.id }))} />;
}
