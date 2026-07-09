import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { agentTokens, and, eq, getDb } from "@repo/db";

import { auth } from "@/lib/auth";

/** Revoke an agent token. Only the user who minted it can delete it. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;

  const db = getDb();
  const owned = await db
    .select({ id: agentTokens.id })
    .from(agentTokens)
    .where(and(eq(agentTokens.id, id), eq(agentTokens.userId, session.user.id)))
    .limit(1);
  if (!owned[0]) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }
  await db.delete(agentTokens).where(eq(agentTokens.id, id));
  return NextResponse.json({ ok: true });
}
