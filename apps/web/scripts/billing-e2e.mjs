/**
 * Billing end-to-end against a local dev server or BILLING_E2E_BASE_URL with
 * Stripe TEST values in the process environment or apps/web/.env.local.
 * Exercises the whole loop:
 *
 *   sign-up → status(none) → checkout session minted → trial subscription
 *   created in Stripe → SIGNED webhook delivered → status(trialing) →
 *   device link mints a sync token → subscription canceled → signed
 *   webhook → status(lapsed) → sync push rejected with 402
 *
 * The hosted checkout page needs a human + browser; this script creates
 * the same subscription the checkout would (same price, same trial, same
 * metadata) and drives our REAL webhook route with properly signed events.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Stripe from "stripe";
import {
  billingBaseUrl,
  billingTestIdentity,
  stripeCheckoutUrl,
} from "./billing-e2e-utils.mjs";

const here = import.meta.dirname;
const envPath = join(here, "..", ".env.local");
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const env = (key) =>
  process.env[key] ?? envText.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
const BASE = billingBaseUrl(env("BILLING_E2E_BASE_URL"));

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));
const PRICE_ID = env("STRIPE_PRICE_ID");
const WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");
if (!PRICE_ID || !WEBHOOK_SECRET) throw new Error("Stripe env missing in .env.local");

const { email: EMAIL, password: PASSWORD } = billingTestIdentity();
let cookie = "";
let pass = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exit(1);
  pass++;
};

const call = async (path, options = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON page responses are fine
  }
  return { res, body };
};

// 1. Fresh user
{
  const { res } = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Billing E2E" }),
  });
  check("sign-up", res.ok, EMAIL);
}

// 2. Unsubscribed: status says so
{
  const { body } = await call("/api/billing/status");
  check(
    "status before checkout",
    body?.billingEnabled === true && body?.entitled === false && body?.reason === "none",
    JSON.stringify(body),
  );
}

// 3. Personal workspace exists (auto-created); device link must 402 now
let organizationId = null;
{
  await call("/app"); // triggers first-visit workspace bootstrap
  const { body } = await call("/api/auth/organization/list");
  organizationId = Array.isArray(body) ? body[0]?.id : body?.[0]?.id;
  check("personal workspace", typeof organizationId === "string", organizationId ?? "none");
  const { res, body: link } = await call("/api/device/link", {
    method: "POST",
    body: JSON.stringify({ organizationId, deviceName: "E2E Mac" }),
  });
  check("device link blocked while unpaid", res.status === 402 && link?.needsSubscription === true);
}

// 4. Checkout session mints a real Stripe URL (trial + promo codes on)
let customerId = null;
{
  const { res, body } = await call("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ next: "/app" }),
  });
  const checkoutUrl = stripeCheckoutUrl(body?.url);
  check("checkout session", res.ok && checkoutUrl !== null, checkoutUrl?.origin);
  const page = await fetch(checkoutUrl);
  check("hosted checkout page loads", page.ok, `HTTP ${page.status}`);
  // ensureCustomer persisted the mapping — find the customer for later steps.
  // customers.list filters by exact email with no search-index lag.
  const customers = await stripe.customers.list({ email: EMAIL, limit: 1 });
  customerId = customers.data[0]?.id;
  check("stripe customer created", typeof customerId === "string", customerId);
}

// 5. Complete "checkout": same subscription the hosted page would create
let subscription = null;
{
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  const customer = await stripe.customers.retrieve(customerId);
  subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: PRICE_ID }],
    trial_period_days: 15,
    metadata: { doodlenoteUserId: customer.metadata.doodlenoteUserId },
  });
  check("trial subscription created", subscription.status === "trialing", subscription.id);
}

const deliverWebhook = async (type, object) => {
  const payload = JSON.stringify({
    id: `evt_e2e_${randomUUID()}`,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return fetch(`${BASE}/api/billing/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
};

// 6. Signed webhook flips entitlement to trialing
{
  const res = await deliverWebhook("customer.subscription.created", subscription);
  check("webhook accepted", res.ok, `HTTP ${res.status}`);
  const { body } = await call("/api/billing/status");
  check(
    "status after webhook = trialing",
    body?.entitled === true && body?.reason === "trialing",
    JSON.stringify(body),
  );
}

// 7. Device link now mints a sync token
let syncToken = null;
{
  const { res, body } = await call("/api/device/link", {
    method: "POST",
    body: JSON.stringify({ organizationId, deviceName: "E2E Mac" }),
  });
  syncToken = body?.token;
  check("device link while trialing", res.ok && syncToken?.startsWith("dnsy_"));
}

// 8. Sync works while entitled
{
  const res = await fetch(`${BASE}/api/sync/pull`, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  check("sync pull while trialing", res.ok, `HTTP ${res.status}`);
}

// 9. Cancel → signed webhook → sync is cut off with a 402 + message
{
  const canceled = await stripe.subscriptions.cancel(subscription.id);
  const res = await deliverWebhook("customer.subscription.deleted", canceled);
  check("cancel webhook accepted", res.ok);
  const { body } = await call("/api/billing/status");
  check(
    "status after cancel = lapsed",
    body?.entitled === false && body?.reason === "lapsed",
    JSON.stringify(body),
  );
  const push = await fetch(`${BASE}/api/sync/pull`, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  const pushBody = await push.json();
  check(
    "sync rejected after lapse",
    push.status === 402 && String(pushBody?.error ?? "").includes("doodlenote.ai/pricing"),
    pushBody?.error,
  );
}

console.log(`\nAll ${pass} checks passed.`);
