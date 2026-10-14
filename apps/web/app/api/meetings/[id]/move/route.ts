import { headers } from "next/headers";
import { getDb } from "@repo/db";

import { getMeetingAccess } from "@/lib/meeting-access";
import { handleMeetingMove } from "@/lib/meeting-move";

/** Same-workspace space/folder moves only; see lib/meeting-move.ts. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getMeetingAccess(await headers(), (await params).id);
  return handleMeetingMove(request, access, getDb());
}
