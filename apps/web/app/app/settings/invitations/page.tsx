import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getAppWorkspace } from "@/lib/app-workspace";
import { invitationEmailConfigured } from "@/lib/invitation-email";
import { InvitationsPanel } from "./invitations-panel";

export const metadata = { title: "Invitations — DoodleNote" };

export default async function InvitationsSettingsPage() {
  const requestHeaders = await headers();
  const workspace = await getAppWorkspace(requestHeaders);
  if (!workspace) redirect("/login");
  const full = await auth.api.getFullOrganization({ headers: requestHeaders, query: { organizationId: workspace.activeOrganization.id } });
  const invitations = (full?.invitations ?? []).filter((invitation) => invitation.status === "pending").map((invitation) => ({ id: invitation.id, email: invitation.email, role: invitation.role === "admin" ? "admin" as const : "member" as const, expiresAt: invitation.expiresAt.toISOString() }));
  return <InvitationsPanel organizationId={workspace.activeOrganization.id} personal={workspace.activeOrganization.id === workspace.personal.id} emailDeliveryEnabled={invitationEmailConfigured()} invitations={invitations} />;
}
