import { NextResponse } from "next/server";

import {
  claimDownloadEvents,
  DOWNLOAD_EVENT_TYPE,
  DOWNLOAD_EVENT_TYPES,
  downloadSyncAuthorization,
  isDownloadEventType,
  MAX_CLAIM_LIMIT,
  siteOrigin,
} from "@/lib/download-leads";

export const dynamic = "force-dynamic";

/**
 * n8n's 15-minute run leases unsynchronized download events here, writes them
 * to MailCheap, then reports each result to ../ack. Unacknowledged leases
 * expire and the events are handed out again. `eventTypes` defaults to
 * download requests only, so a worker never receives a type it can't handle.
 */
export async function POST(request: Request) {
  const auth = downloadSyncAuthorization(request);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Download lead sync is not configured" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { limit?: unknown; eventTypes?: unknown }
    | null;
  const limit = typeof body?.limit === "number" ? body.limit : 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM_LIMIT) {
    return NextResponse.json({ error: `limit must be 1 to ${MAX_CLAIM_LIMIT}` }, { status: 400 });
  }
  const eventTypes = body?.eventTypes ?? [DOWNLOAD_EVENT_TYPE];
  if (
    !Array.isArray(eventTypes) ||
    eventTypes.length === 0 ||
    !eventTypes.every(isDownloadEventType)
  ) {
    return NextResponse.json(
      { error: `eventTypes must list one or more of: ${DOWNLOAD_EVENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const events = await claimDownloadEvents({ limit, eventTypes, baseUrl: siteOrigin(request) });
  return NextResponse.json({ events }, { headers: { "cache-control": "no-store" } });
}
