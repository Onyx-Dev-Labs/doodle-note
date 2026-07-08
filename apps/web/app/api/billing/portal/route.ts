import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, getDb, subscriptions } from "@repo/db";

import { auth } from "@/lib/auth";
import { billingEnabled, getStripe } from "@/lib/billing";

/** Stripe Billing Portal: update card, cancel, view invoices. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: "Billing is not enabled" }, { status: 503 });
  }

  const rows = await getDb()
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription on file" }, { status: 404 });
  }

  const origin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/app`,
  });
  return NextResponse.json({ url: portal.url });
}
