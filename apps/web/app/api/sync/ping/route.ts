import { NextResponse } from "next/server";

import { authenticateSyncRequest } from "@/lib/sync-auth";

/** Cheap token check for the desktop's "connected" status. */
export async function GET(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    workspaceName: device.organizationName,
  });
}
