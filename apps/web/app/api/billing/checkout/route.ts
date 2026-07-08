import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { billingEnabled, ensureCustomer, getStripe, TRIAL_DAYS } from "@/lib/billing";

/**
 * Start a cloud-sync subscription: hosted Stripe Checkout, $10/mo, 15-day
 * trial with the card collected up front. `next` (path only) is where the
 * success redirect lands — the device-link flow uses it to resume linking
 * right after payment.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: "Billing is not enabled" }, { status: 503 });
  }
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "STRIPE_PRICE_ID is not set" }, { status: 503 });
  }

  let next = "/app";
  try {
    const body = (await request.json()) as { next?: unknown };
    // Path-only, same-site: never an open redirect.
    if (typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//")) {
      next = body.next;
    }
  } catch {
    // no body — default landing
  }

  const origin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  const customerId = await ensureCustomer(session.user.id, session.user.email);

  const checkout = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { doodlenoteUserId: session.user.id },
    },
    // BETADOODLENOTE (and future codes) get typed here.
    allow_promotion_codes: true,
    success_url: `${origin}${next}${next.includes("?") ? "&" : "?"}billing=success`,
    cancel_url: `${origin}/pricing?billing=canceled`,
  });

  return NextResponse.json({ url: checkout.url });
}
