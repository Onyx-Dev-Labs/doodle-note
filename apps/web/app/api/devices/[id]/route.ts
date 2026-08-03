import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, getDb, syncDevices } from "@repo/db";

import { auth } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const id = (await params).id;
  await getDb()
    .delete(syncDevices)
    .where(
      and(eq(syncDevices.id, id), eq(syncDevices.userId, session.user.id)),
    );
  return NextResponse.json({ ok: true });
}
