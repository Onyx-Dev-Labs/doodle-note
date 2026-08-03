import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getAppWorkspace } from "@/lib/app-workspace";
import { MembersPanel } from "./members-panel";

export const metadata = { title: "Members — DoodleNote" };

export default async function MembersSettingsPage() {
  const requestHeaders = await headers();
  const workspace = await getAppWorkspace(requestHeaders);
  if (!workspace) redirect("/login");
  const full = await auth.api.getFullOrganization({ headers: requestHeaders, query: { organizationId: workspace.activeOrganization.id } });
  const members = (full?.members ?? []).map((member) => ({ id: member.id, email: member.user?.email ?? "Unknown member", role: member.role, currentUser: member.user?.id === workspace.session.user.id }));
  return <MembersPanel organizationId={workspace.activeOrganization.id} personal={workspace.activeOrganization.id === workspace.personal.id} members={members} />;
}
