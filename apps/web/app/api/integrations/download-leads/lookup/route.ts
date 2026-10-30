import { NextResponse } from "next/server";

import {
  downloadSyncAuthorization,
  lookupDownloadLeads,
  MAX_LOOKUP_EMAILS,
  siteOrigin,
} from "@/lib/download-leads";

export const dynamic = "force-dynamic";

/**
 * Read-only identity lookup for n8n's recheck before each send: download
 * lead, verified account link, and same-address account for each email.
 * Changes nothing; payment is still verified in Stripe.
 */
export async function POST(request: Request) {
  const auth = downloadSyncAuthorization(request);
  if (auth === "unconfigured") {
    return NextResponse.json({ error: "Download lead sync is not configured" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { emails?: unknown } | null;
  const emails = body?.emails;
  if (
    !Array.isArray(emails) ||
    emails.length === 0 ||
    emails.length > MAX_LOOKUP_EMAILS ||
    !emails.every((email) => typeof email === "string" && email.length <= 320)
  ) {
    return NextResponse.json(
      { error: `emails must list 1 to ${MAX_LOOKUP_EMAILS} addresses` },
      { status: 400 },
    );
  }

  const results = await lookupDownloadLeads(emails, { baseUrl: siteOrigin(request) });
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
