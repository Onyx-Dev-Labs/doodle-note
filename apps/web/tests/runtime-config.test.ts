import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAuthBaseUrl,
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
