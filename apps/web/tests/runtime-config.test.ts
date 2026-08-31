import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAuthBaseUrl,
  resolveAuthEmailEnabled,
  resolveAuthSecret,
  resolveBillingMode,
} from "../lib/runtime-config";

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
  assert.equal(
    resolveAuthBaseUrl({ NODE_ENV: "development" }),
    "http://localhost:4040",
  );
});

test("production auth requires an explicit or Vercel deployment URL", () => {
  assert.throws(
    () => resolveAuthBaseUrl({ NODE_ENV: "production" }),
    /BETTER_AUTH_URL is required in production/,
  );
  assert.equal(
    resolveAuthBaseUrl({
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://sync.example.com",
    }),
    "https://sync.example.com",
  );
  assert.equal(
    resolveAuthBaseUrl({
      NODE_ENV: "production",
      VERCEL_URL: "preview.example.vercel.app",
    }),
    "https://preview.example.vercel.app",
  );
});

test("a Next.js production build does not require live auth credentials", () => {
  const env = {
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-build",
  };
  assert.match(resolveAuthSecret(env), /dev-only-insecure/);
  assert.equal(resolveAuthBaseUrl(env), "http://localhost:4040");
  assert.equal(resolveAuthEmailEnabled(env), false);
});

test("production auth requires a complete email delivery configuration", () => {
  assert.throws(
    () => resolveAuthEmailEnabled({ NODE_ENV: "production" }),
    /RESEND_API_KEY and AUTH_FROM_EMAIL/,
  );
  assert.throws(
    () =>
      resolveAuthEmailEnabled({
        NODE_ENV: "production",
        RESEND_API_KEY: "secret",
      }),
    /RESEND_API_KEY and AUTH_FROM_EMAIL/,
  );
  assert.equal(
    resolveAuthEmailEnabled({
      NODE_ENV: "production",
      RESEND_API_KEY: "secret",
      AUTH_FROM_EMAIL: "DoodleNote <no-reply@doodlenote.ai>",
    }),
    true,
  );
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
    "misconfigured",
  );
  assert.equal(
    resolveBillingMode({
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "secret",
      STRIPE_ACCOUNT_ID: "acct_test",
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
