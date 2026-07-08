import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { billingEnabled, getStripe, recordSubscription } from "@/lib/billing";

/**
 * Stripe → us. Subscription lifecycle events keep the subscriptions table
 * mirroring Stripe; entitlement checks read only our table (no Stripe call
 * on the sync hot path). Signature-verified with STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  if (!billingEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Billing is not enabled" }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await recordSubscription(event.data.object);
      break;
    case "checkout.session.completed": {
      // The subscription events above carry the real state; this is just a
      // safety net for the brief window before they arrive.
      const session = event.data.object;
      if (typeof session.subscription === "string") {
        const sub = await getStripe().subscriptions.retrieve(session.subscription);
        await recordSubscription(sub);
      }
      break;
    }
    default:
      break; // unhandled event types are fine
  }

  return NextResponse.json({ received: true });
}
