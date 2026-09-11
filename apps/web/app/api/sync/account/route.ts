import { eq, getDb, user } from "@repo/db";
import { entitlementFor } from "@/lib/billing";
import { isRemoteMcpEligible } from "@/lib/billing-state";
import { syncAccountResponse } from "@/lib/sync-account";
import { authenticateIdentityRequest } from "@/lib/sync-auth";
import { syncV2Enabled } from "@/lib/sync-v2";

export async function GET(request: Request) {
  try {
    const device = await authenticateIdentityRequest(request);
    if (!device) return Response.json({ error: "invalid_account" }, { status: 401,
      headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
    const entitlement = await entitlementFor(device.userId);
    let remoteMcpEligible = isRemoteMcpEligible(entitlement);
    // Explicit complimentary setup access preserves the existing legacy account.
    // Never substitute a paid Stripe status or broaden Cloud Sync entitlement.
    const complimentaryEmails = (process.env.DOODLENOTE_REMOTE_MCP_COMPLIMENTARY_EMAILS ?? "")
      .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!remoteMcpEligible && entitlement.entitled && entitlement.reason === "grandfathered" && complimentaryEmails.length) {
      const [account] = await getDb().select({ email: user.email, verified: user.emailVerified })
        .from(user).where(eq(user.id, device.userId)).limit(1);
      remoteMcpEligible = account?.verified === true && complimentaryEmails.includes(account.email.toLowerCase());
    }
    return await syncAccountResponse(getDb(), device, entitlement.entitled, syncV2Enabled(),
      remoteMcpEligible);
  } catch {
    return Response.json({ error: "account_unavailable" }, { status: 503,
      headers: { "Cache-Control": "private, no-store" } });
  }
}
