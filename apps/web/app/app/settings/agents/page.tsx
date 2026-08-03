import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { agentTokens, desc, eq, getDb } from "@repo/db";

import { getAppWorkspace } from "@/lib/app-workspace";
import { AgentsPanel } from "./agents-panel";

export const metadata = { title: "Agent access — DoodleNote" };

export default async function AgentSettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  const rows = await getDb().select({ id: agentTokens.id, name: agentTokens.name, createdAt: agentTokens.createdAt, lastUsedAt: agentTokens.lastUsedAt }).from(agentTokens).where(eq(agentTokens.userId, workspace.session.user.id)).orderBy(desc(agentTokens.createdAt));
  return <AgentsPanel organizationId={workspace.activeOrganization.id} tokens={rows.map((token) => ({ id: token.id, name: token.name, createdAt: (token.createdAt ?? new Date()).toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null }))} />;
}
