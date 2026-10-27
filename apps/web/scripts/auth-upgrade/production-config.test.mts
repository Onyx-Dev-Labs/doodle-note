import assert from "node:assert/strict";
import test from "node:test";
import { configureFixture, origin } from "./fixture-env";

configureFixture("production");
const unexpected: string[] = [];
globalThis.fetch = async input => { unexpected.push(String(input)); throw new Error("Unexpected outbound request denied"); };
const { createInMemoryDb } = await import("@repo/db/testing");
const { createAuth } = await import("../../lib/create-auth");

test("production configuration retains memory counters, origin checks and no Magic Link/proxy endpoints", async () => {
  const fixture = await createInMemoryDb();
  try {
    const auth = createAuth(fixture.db);
    const context = await auth.$context;
    assert.equal(context.rateLimit.enabled, true);
    assert.equal(context.rateLimit.storage, "memory");
    assert.equal(context.skipOriginCheck, false);
    assert.equal(context.skipCSRFCheck, false);
    assert.deepEqual(auth.options.plugins.map(p => p.id), ["organization", "next-cookies"]);
    assert.equal(context.secondaryStorage, undefined);
    assert.equal(context.oauthConfig.storeStateStrategy, "database");
    for (const path of ["/sign-in/magic-link", "/oauth-proxy/callback"]) {
      const response = await auth.handler(new Request(origin + "/api/auth" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }));
      assert.equal(response.status, 404);
    }
    const responses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await auth.handler(new Request(origin + "/api/auth/sign-in/email", {
        method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.77" },
        body: JSON.stringify({ email: "missing@example.test", password: "synthetic-wrong-password" }),
      }));
      responses.push(response.status);
    }
    assert.deepEqual(responses, [401, 401, 401, 429]);
    assert.deepEqual(unexpected, []);
  } finally { await fixture.close(); }
});
