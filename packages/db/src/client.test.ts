import assert from "node:assert/strict";
import test from "node:test";

import { resolveDatabaseUrl } from "./client";

test("production requires a durable database URL", () => {
  assert.throws(
    () => resolveDatabaseUrl({ NODE_ENV: "production" }),
    /DATABASE_URL is required in production/,
  );
  assert.equal(
    resolveDatabaseUrl({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/doodlenote",
    }),
    "postgresql://example.invalid/doodlenote",
  );
});

test("local development retains the PGlite fallback", () => {
  assert.equal(resolveDatabaseUrl({ NODE_ENV: "development" }), null);
  assert.equal(resolveDatabaseUrl({ NODE_ENV: "test" }), null);
});

test("a Next.js production build does not require a live database", () => {
  assert.equal(
    resolveDatabaseUrl({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
    }),
    null,
  );
});
