/**
 * One-time Stripe provisioning for DoodleNote Cloud Sync. Idempotent —
 * looks up by lookup_key/url before creating. Run once per mode:
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs   # test mode
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs   # go-live
 *
 * Prints the env vars to set (Vercel prod + root .env.local):
 *   STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET (webhook secret prints ONCE —
 *   it cannot be fetched again later).
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…)");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live_") ? "LIVE" : "test";
const WEBHOOK_URL = "https://www.doodlenote.ai/api/billing/webhook";
const LOOKUP_KEY = "doodle-sync-monthly";

// Price (creates its product inline) — found again by lookup_key on re-runs.
let price = (
  await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1 })
).data[0];
if (!price) {
  price = await stripe.prices.create({
    currency: "usd",
    unit_amount: 1000,
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
    product_data: { name: "DoodleNote Cloud Sync" },
  });
  console.log(`created price ${price.id} ($10/mo)`);
} else {
  console.log(`price exists: ${price.id}`);
}

// Webhook endpoint (skipped in test mode — use `stripe listen` locally).
let webhookLine = "";
if (mode === "LIVE") {
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(
    (e) => e.url === WEBHOOK_URL,
  );
  if (existing) {
    console.log(`webhook exists: ${existing.id} (secret not retrievable — reuse the saved one)`);
  } else {
    const endpoint = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "checkout.session.completed",
      ],
    });
    webhookLine = `STRIPE_WEBHOOK_SECRET=${endpoint.secret}`;
    console.log(`created webhook ${endpoint.id}`);
  }
} else {
  console.log("test mode: run `stripe listen --forward-to localhost:4040/api/billing/webhook`");
}

console.log(`\n--- env for ${mode} ---`);
console.log(`STRIPE_SECRET_KEY=${key.slice(0, 12)}…  (already have it)`);
console.log(`STRIPE_PRICE_ID=${price.id}`);
if (webhookLine) console.log(webhookLine);
