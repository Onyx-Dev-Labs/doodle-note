import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listWorkspaceAgentTokens } from "@/lib/agent-token-list";

import { getAppWorkspace } from "@/lib/app-workspace";
import { resolveAuthBaseUrl } from "@/lib/runtime-config";
import { AgentsPanel } from "./agents-panel";

export const metadata = { title: "Agent access — DoodleNote" };

export default async function AgentSettingsPage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  const rows = await listWorkspaceAgentTokens(
    workspace.session.user.id,
    workspace.activeOrganization.id,
  );
  return (
    <AgentsPanel
      key={workspace.activeOrganization.id}
      baseUrl={resolveAuthBaseUrl()}
      workspaceName={workspace.activeOrganization.name}
      organizationId={workspace.activeOrganization.id}
      tokens={rows.map((token) => ({
        id: token.id,
        name: token.name,
        createdAt: (token.createdAt ?? new Date()).toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      }))}
    />
  );
}
