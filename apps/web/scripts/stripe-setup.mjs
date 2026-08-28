/**
 * One-time Stripe provisioning for DoodleNote Cloud Sync. Idempotent —
 * looks up by lookup_key/url before creating. Run once per mode:
 *
 *   STRIPE_SECRET_KEY=sk_test_… \
 *     STRIPE_ACCOUNT_ID=acct_… \
 *     node scripts/stripe-setup.mjs                            # test catalog
 *   STRIPE_SECRET_KEY=sk_test_… \
 *     STRIPE_ACCOUNT_ID=acct_… \
 *     STRIPE_WEBHOOK_URL=https://preview.example/api/billing/webhook \
 *     STRIPE_WEBHOOK_SECRET_OUTPUT=/secure/new-file.env \
 *     node scripts/stripe-setup.mjs                            # test preview
 *   STRIPE_SECRET_KEY=sk_live_… \
 *     STRIPE_ACCOUNT_ID=acct_… \
 *     STRIPE_WEBHOOK_SECRET_OUTPUT=/secure/new-file.env \
 *     node scripts/stripe-setup.mjs                            # go-live
 *
 * Prints non-secret configuration. When a live webhook must be created, its
 * one-time secret is written to a new owner-only file and never printed.
 */
import Stripe from "stripe";
import { reserveSecretEnvFile } from "./secure-secret-output.mjs";
import {
  assertExpectedAccount,
  assertMonthlyPrice,
  WEBHOOK_EVENTS,
  webhookUrl,
} from "./stripe-setup-utils.mjs";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…)");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live_") ? "LIVE" : "test";
const expectedAccountId = process.env.STRIPE_ACCOUNT_ID;
const account = await stripe.accounts.retrieveCurrent();
assertExpectedAccount(account.id, expectedAccountId);
console.log(`verified Stripe account ${account.id} (${mode})`);

const requestedWebhookUrl =
  process.env.STRIPE_WEBHOOK_URL ??
  (mode === "LIVE" ? "https://www.doodlenote.ai/api/billing/webhook" : "");
const targetWebhookUrl = requestedWebhookUrl
  ? webhookUrl(requestedWebhookUrl).href
  : null;
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
  assertMonthlyPrice(price);
  console.log(`price exists: ${price.id}`);
}

// Create an explicitly targeted endpoint in either mode. Test mode remains
// local-listener-only unless STRIPE_WEBHOOK_URL is deliberately supplied.
let webhookSecretPath = "";
if (targetWebhookUrl) {
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(
    (endpoint) => endpoint.url === targetWebhookUrl,
  );
  if (existing) {
    const missingEvents = WEBHOOK_EVENTS.filter(
      (event) =>
        !existing.enabled_events.includes("*") &&
        !existing.enabled_events.includes(event),
    );
    if (missingEvents.length) {
      throw new Error(
        `Webhook ${existing.id} is missing required events: ${missingEvents.join(", ")}`,
      );
    }
    console.log(`webhook exists: ${existing.id} (secret not retrievable; reuse the saved one)`);
  } else {
    const output = process.env.STRIPE_WEBHOOK_SECRET_OUTPUT;
    if (!output) {
      throw new Error(
        "Set STRIPE_WEBHOOK_SECRET_OUTPUT to a new secure file before creating the webhook",
      );
    }
    const reservation = reserveSecretEnvFile(output);
    let endpoint;
    try {
      endpoint = await stripe.webhookEndpoints.create({
        url: targetWebhookUrl,
        enabled_events: WEBHOOK_EVENTS,
      });
    } catch (error) {
      reservation.abort();
      throw error;
    }

    try {
      if (!endpoint.secret) throw new Error("Stripe did not return the new webhook secret");
      reservation.write("STRIPE_WEBHOOK_SECRET", endpoint.secret);
    } catch (error) {
      reservation.abort();
      try {
        await stripe.webhookEndpoints.del(endpoint.id);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Could not persist the webhook secret or remove webhook ${endpoint.id}`,
        );
      }
      throw error;
    }
    webhookSecretPath = reservation.path;
    console.log(`created webhook ${endpoint.id}`);
  }
} else {
  console.log(
    "test mode without STRIPE_WEBHOOK_URL: use `stripe listen --forward-to localhost:4040/api/billing/webhook`",
  );
}

console.log(`\n--- env for ${mode} ---`);
console.log("STRIPE_SECRET_KEY=<already supplied>");
console.log(`STRIPE_ACCOUNT_ID=${account.id}`);
console.log(`STRIPE_PRICE_ID=${price.id}`);
if (webhookSecretPath) console.log(`STRIPE_WEBHOOK_SECRET written to ${webhookSecretPath}`);
