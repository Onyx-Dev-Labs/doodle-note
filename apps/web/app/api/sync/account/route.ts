import { getDb } from "@repo/db";
import { entitlementFor } from "@/lib/billing";
import { syncAccountResponse } from "@/lib/sync-account";
import { authenticateIdentityRequest } from "@/lib/sync-auth";
import { syncV2Enabled } from "@/lib/sync-v2";

export async function GET(request: Request) {
  try {
    const device = await authenticateIdentityRequest(request);
    if (!device) return Response.json({ error: "invalid_account" }, { status: 401 });
    const entitlement = await entitlementFor(device.userId);
    return await syncAccountResponse(getDb(), device, entitlement.entitled, syncV2Enabled());
  } catch {
    return Response.json({ error: "account_unavailable" }, { status: 503,
      headers: { "Cache-Control": "private, no-store" } });
  }
}
