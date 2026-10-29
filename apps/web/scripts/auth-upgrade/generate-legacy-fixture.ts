/** Run ONLY on preserved 58fd/Better Auth 1.7.1; never against a real DB.
 * node --conditions=react-server --import tsx scripts/auth-upgrade/generate-legacy-fixture.ts
 * Output is synthetic. Session/state expiry is extended for durable tests;
 * cookie signing, password hashing and email token signing use actual 1.7.1.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { providerFixture } from "./provider-fixture";
import { configureFixture, cookieHeader, origin, password, secret } from "./fixture-env";

async function main() {
  configureFixture("test");
  const require = createRequire(import.meta.url);
  assert.equal(JSON.parse(await readFile(new URL("../package.json", "file://" + require.resolve("better-auth")), "utf8")).version, "1.7.1");
  const providers = await providerFixture();
  const emails: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://api.resend.com/emails") {
      const response = await providers.fetch(input, init);
      assert.ok(response, "Unexpected outbound request denied");
      return response;
    }
    const payload = JSON.parse(String(init?.body));
    const url = payload.text?.match(/https?:\/\/\S+/)?.[0];
    if (url) emails.push(url);
    return Response.json({ id: "synthetic-email" });
  };
  const { createInMemoryDb } = await import("@repo/db/testing");
  const { createAuth } = await import("../../lib/create-auth");
  const { createEmailVerificationToken } = await import("better-auth/api");
  const fixture = await createInMemoryDb();
  try {
    const auth = createAuth(fixture.db);
    const request = (path: string, body?: unknown, cookie = "") => auth.handler(new Request(origin + "/api/auth" + path, {
      method: body ? "POST" : "GET", headers: { origin, cookie, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const users: Record<string, string> = {};
    let cookie = "";
    for (const role of ["owner", "google", "microsoft", "unverified"]) {
      const signup = await request("/sign-up/email", { name: role, email: `${role}@example.test`, password });
      assert.equal(signup.status, 200, await signup.clone().text());
      users[role] = (await signup.json()).user.id;
      if (role !== "unverified") {
        const verified = await auth.handler(new Request(emails.at(-1)!));
        assert.equal(verified.status, 302);
        if (role === "owner") cookie = cookieHeader(verified);
      }
    }
    const org = await request("/organization/create", { name: "Synthetic team", slug: "synthetic-team" }, cookie);
    assert.equal(org.status, 200, await org.clone().text());
    const orgId = (await org.json()).id;
    assert.equal((await request("/organization/set-active", { organizationId: orgId }, cookie)).status, 200);
    const invitation = await request("/organization/invite-member", { organizationId: orgId, email: "invitee@example.test", role: "member" }, cookie);
    assert.equal(invitation.status, 200, await invitation.clone().text());
    const states: Record<string, { state: string; cookie: string }> = {};
    for (const provider of ["google", "microsoft"]) {
      const response = await request("/sign-in/social", { provider, callbackURL: origin + "/workspace" });
      assert.equal(response.status, 200, await response.clone().text());
      const authorization = new URL((await response.json()).url);
      const code = `synthetic-${provider}-code`;
      providers.grant(code, { provider: provider as "google" | "microsoft", subject: `legacy-${provider}-subject`, email: `${provider}@example.test`, authorization });
      const signedIn = await request(`/callback/${provider}?state=${authorization.searchParams.get("state")}&code=${code}`, undefined, cookieHeader(response));
      assert.equal(signedIn.status, 302);
      assert.equal(signedIn.headers.get("location"), origin + "/workspace");
      const identity = await request("/get-session", undefined, cookieHeader(signedIn));
      assert.equal((await identity.json()).user.id, users[provider]);
      const pending = await request("/sign-in/social", { provider, callbackURL: origin + "/workspace" });
      assert.equal(pending.status, 200);
      states[provider] = { state: new URL((await pending.json()).url).searchParams.get("state")!, cookie: cookieHeader(pending) };
    }
    await fixture.db.$client.exec(`UPDATE session SET expires_at='2099-01-01'; UPDATE invitation SET expires_at='2099-01-01'; UPDATE verification SET expires_at='2099-01-01', value=jsonb_set(value::jsonb,'{expiresAt}','4070908800000')::text;`);
    const tables: Record<string, unknown[]> = {};
    for (const name of ["user", "account", "session", "organization", "member", "invitation", "verification"]) {
      tables[name] = (await fixture.db.$client.query(`SELECT * FROM "${name}" ORDER BY id`)).rows;
    }
    const pendingEmailToken = await createEmailVerificationToken(secret, "unverified@example.test", undefined, 100 * 365 * 86400);
    await writeFile(new URL("./legacy-1.7.1.json", import.meta.url), JSON.stringify({
      provenance: "Actual Better Auth 1.7.1/createAuth at 58fd; synthetic HTTP signup/verify/session/org/invitation/state. Google/Microsoft accounts created by actual SDK redirect/code exchange against synthetic signed token responses; expiry extended only for fixtures.",
      cookie, users, orgId, states, pendingEmailToken, tables,
      journal: (await fixture.db.$client.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows,
    }, null, 2) + "\n");
  } finally { await fixture.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
