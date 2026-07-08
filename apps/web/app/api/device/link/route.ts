import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, getDb, member, organization, syncDevices } from "@repo/db";

import { auth } from "@/lib/auth";
import { entitlementFor } from "@/lib/billing";
import { hashToken, mintToken } from "@/lib/sync-auth";

/**
 * Link a desktop app to the signed-in user's workspace. Session (cookie)
 * authenticated — called by the /link-device approval page. Returns the
 * plaintext sync token exactly once.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Cloud sync is the paid feature — linking a device requires entitlement
  // (grandfathered, trialing, or active). The approval page turns this 402
  // into a "start your free trial" checkout hand-off.
  const entitlement = await entitlementFor(session.user.id);
  if (!entitlement.entitled) {
    return NextResponse.json(
      { error: "Subscription required", needsSubscription: true },
      { status: 402 },
    );
  }

  let body: { organizationId?: unknown; deviceName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const organizationId = String(body.organizationId ?? "");
  const deviceName = String(body.deviceName ?? "Desktop").slice(0, 80);

  const db = getDb();
  const membership = await db
    .select({ orgName: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
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

  const token = mintToken();
  await db.insert(syncDevices).values({
    id: randomUUID(),
    tokenHash: hashToken(token),
    userId: session.user.id,
    organizationId,
    deviceName,
  });

  return NextResponse.json({
    token,
    email: session.user.email,
    workspaceName: membership[0].orgName,
  });
}
