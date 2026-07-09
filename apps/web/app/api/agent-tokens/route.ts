import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { agentTokens, and, eq, getDb, member } from "@repo/db";

import { hashAgentToken, mintAgentToken } from "@/lib/agent-auth";
import { auth } from "@/lib/auth";
import { entitlementFor } from "@/lib/billing";

/**
 * Mint an agent token for the signed-in user in one of their workspaces.
 * Session (cookie) authenticated — called from the workspaces panel.
 * Returns the plaintext token exactly once; only its hash is stored.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const entitlement = await entitlementFor(session.user.id);
  if (!entitlement.entitled) {
    return NextResponse.json(
      { error: "Subscription required", needsSubscription: true },
      { status: 402 },
    );
  }

  let body: { organizationId?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const organizationId = String(body.organizationId ?? "");
  const name = String(body.name ?? "Agent").trim().slice(0, 80) || "Agent";

  const db = getDb();
  const membership = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!membership[0]) {
    return NextResponse.json(
      { error: "Not a member of that workspace" },
      { status: 403 },
    );
  }

  const token = mintAgentToken();
  const id = randomUUID();
  await db.insert(agentTokens).values({
    id,
    tokenHash: hashAgentToken(token),
    userId: session.user.id,
    organizationId,
    name,
  });

  return NextResponse.json({ id, token, name });
}
