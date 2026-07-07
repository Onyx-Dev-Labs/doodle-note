import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { billingEnabled, entitlementFor } from "@/lib/billing";

/** Cloud-sync entitlement for the UI. Signed-out callers still learn
 *  whether billing is enabled (no personal data) so the pricing page can
 *  show honest copy either way. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({
      entitled: false,
      reason: "signed-out",
      billingEnabled: billingEnabled(),
    });
  }
  const entitlement = await entitlementFor(session.user.id);
  return NextResponse.json({ ...entitlement, billingEnabled: billingEnabled() });
}
