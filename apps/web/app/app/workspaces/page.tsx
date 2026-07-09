import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { agentTokens, desc, eq, getDb } from "@repo/db";

import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";

import { WorkspacesPanel } from "./workspaces-panel";

export const metadata = { title: "Workspaces — DoodleNote" };

export default async function WorkspacesPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  await ensurePersonalWorkspace(session.user.id);
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  // Same fallback as the meetings library: no explicit active workspace
  // means the first one is treated as active.
  const activeOrganizationId =
    session.session.activeOrganizationId ?? organizations[0]?.id ?? null;

  // Members + pending invitations of the active workspace, for the panel.
  let members: Array<{ id: string; email: string; role: string }> = [];
  let invitations: Array<{ id: string; email: string; status: string }> = [];
  if (activeOrganizationId) {
    try {
      const full = await auth.api.getFullOrganization({
        headers: requestHeaders,
        query: { organizationId: activeOrganizationId },
      });
      members = (full?.members ?? []).map((m) => ({
        id: m.id,
        email: m.user?.email ?? "",
        role: m.role,
      }));
      invitations = (full?.invitations ?? [])
        .filter((i) => i.status === "pending")
        .map((i) => ({ id: i.id, email: i.email, status: i.status }));
    } catch {
      // Not a member of the active org (stale session) — panel shows basics.
    }
  }

  // The user's agent tokens (hosted-MCP access), newest first.
  const tokenRows = await getDb()
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
    })
    .from(agentTokens)
    .where(eq(agentTokens.userId, session.user.id))
    .orderBy(desc(agentTokens.createdAt));
  const agentTokenList = tokenRows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: (t.createdAt ?? new Date()).toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
  }));

  return (
    <WorkspacesPanel
      userEmail={session.user.email}
      activeOrganizationId={activeOrganizationId}
      organizations={organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
      }))}
      members={members}
      invitations={invitations}
      agentTokens={agentTokenList}
    />
  );
}
