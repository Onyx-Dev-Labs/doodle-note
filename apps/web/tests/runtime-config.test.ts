import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthSecret, resolveBillingMode } from "../lib/runtime-config";

test("production auth requires an explicit secret", () => {
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: "production" }),
    /BETTER_AUTH_SECRET is required in production/,
  );
  assert.equal(
    resolveAuthSecret({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "production-secret",
    }),
    "production-secret",
  );
});

test("development auth retains the documented zero-config fallback", () => {
  assert.match(resolveAuthSecret({ NODE_ENV: "development" }), /dev-only/);
});

test("hosted production requires the complete Stripe group", () => {
  assert.equal(resolveBillingMode({ NODE_ENV: "production" }), "misconfigured");
  assert.equal(
    resolveBillingMode({
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "secret",
    }),
    "misconfigured",
  );
  assert.equal(
    resolveBillingMode({
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "secret",
      STRIPE_PRICE_ID: "price",
      STRIPE_WEBHOOK_SECRET: "webhook",
    }),
    "stripe",
  );
});

test("billing bypass is limited to development or explicit self-hosting", () => {
  assert.equal(resolveBillingMode({ NODE_ENV: "development" }), "development");
  assert.equal(
    resolveBillingMode({
      NODE_ENV: "production",
      DOODLENOTE_SELF_HOSTED: "true",
    }),
    "self-hosted",
  );
});
