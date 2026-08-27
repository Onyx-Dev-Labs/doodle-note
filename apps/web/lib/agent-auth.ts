import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { agentTokens, eq, getDb } from "@repo/db";

import { entitlementFor } from "@/lib/billing";

/**
 * Auth for the hosted MCP (/api/mcp): revocable, READ-ONLY agent tokens.
 * Same trust model as sync devices — plaintext `dnag_…` shown once at mint,
 * only its SHA-256 stored, requests send `Authorization: Bearer`. Distinct
 * prefix from `dnsy_` sync tokens so one can never be used as the other.
 */

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintAgentToken(): string {
  return `dnag_${randomBytes(32).toString("hex")}`;
}

export interface AgentAuth {
  tokenId: string;
  userId: string;
  organizationId: string;
}

/** Resolves the bearer header to an agent token row, or null. */
export async function authenticateAgentRequest(
  request: Request,
): Promise<AgentAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("dnag_") || token.length < 40) return null;

  const db = getDb();
  const rows = await db
    .select({
      tokenId: agentTokens.id,
      userId: agentTokens.userId,
      organizationId: agentTokens.organizationId,
    })
    .from(agentTokens)
    .where(eq(agentTokens.tokenHash, hashAgentToken(token)))
    .limit(1);
  const found = rows[0];
  if (!found) return null;

  // Best-effort liveness stamp; never block the request on it.
  db.update(agentTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentTokens.id, found.tokenId))
    .catch(() => {});

  return found;
}

/**
 * Agent auth + billing in one step, mirroring sync's entitlement gate —
 * remote agent access reads cloud-synced data, so it's part of the same
 * paid Sync feature.
 */
export async function authenticateEntitledAgentRequest(
  request: Request,
): Promise<
  | { agent: AgentAuth; response?: undefined }
  | { agent?: undefined; response: Response }
> {
  const agent = await authenticateAgentRequest(request);
  if (!agent) {
    return {
      response: NextResponse.json(
        { error: "Invalid agent token" },
        { status: 401 },
      ),
    };
  }
  const entitlement = await entitlementFor(agent.userId);
  if (!entitlement.entitled) {
    if (entitlement.reason === "configuration_error") {
      return {
        response: NextResponse.json(
          { error: "Hosted agent access is unavailable because billing is not configured" },
          { status: 503 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        {
          error:
            "Remote agent access needs an active subscription — manage billing at https://www.doodlenote.ai/pricing",
          needsSubscription: true,
        },
        { status: 402 },
      ),
    };
  }
  return { agent };
}
