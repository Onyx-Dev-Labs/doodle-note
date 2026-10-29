import { NextResponse } from "next/server";

import {
  acknowledgeDownloadEvents,
  downloadSyncAuthorization,
  MAX_CLAIM_LIMIT,
  parseDownloadEventResult,
  type DownloadEventResult,
} from "@/lib/download-leads";

export const dynamic = "force-dynamic";

/** Records n8n's confirmed MailCheap result for each claimed event. */
export async function POST(request: Request) {
  const auth = downloadSyncAuthorization(request);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Download lead sync is not configured" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { results?: unknown } | null;
  const input = body?.results;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CLAIM_LIMIT) {
    return NextResponse.json(
      { error: `results must list 1 to ${MAX_CLAIM_LIMIT} events` },
      { status: 400 },
    );
  }
  const results = input.map(parseDownloadEventResult);
  const invalid = results.findIndex((result) => result === null);
  if (invalid !== -1) {
    return NextResponse.json({ error: `results[${invalid}] is invalid` }, { status: 400 });
  }

  const outcome = await acknowledgeDownloadEvents(results as DownloadEventResult[]);
  return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
}
