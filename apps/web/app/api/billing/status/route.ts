import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { billingEnabled, entitlementFor } from "@/lib/billing";

/** The signed-in user's cloud-sync entitlement (UI + link-device page). */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const entitlement = await entitlementFor(session.user.id);
  return NextResponse.json({ ...entitlement, billingEnabled: billingEnabled() });
}
