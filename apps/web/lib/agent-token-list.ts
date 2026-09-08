import { agentTokens, and, desc, eq, getDb } from "@repo/db";

/** Only return display metadata for the signed-in user's selected workspace. */
export async function listWorkspaceAgentTokens(
  userId: string,
  organizationId: string,
) {
  return getDb()
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
    })
    .from(agentTokens)
    .where(
      and(
        eq(agentTokens.userId, userId),
        eq(agentTokens.organizationId, organizationId),
      ),
    )
    .orderBy(desc(agentTokens.createdAt));
}
