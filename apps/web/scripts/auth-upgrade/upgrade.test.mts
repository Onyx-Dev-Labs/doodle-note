import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { providerFixture } from "./provider-fixture";
import { configureFixture, cookieHeader, origin, password } from "./fixture-env";

configureFixture();
const providers = await providerFixture();
const emails: string[] = [];
const unexpected: string[] = [];
globalThis.fetch = async (input, init) => {
  if (String(input) === "https://api.resend.com/emails") {
    const payload = JSON.parse(String(init?.body));
    const url = payload.text?.match(/https?:\/\/\S+/)?.[0];
    if (url) emails.push(url);
    return Response.json({ id: "synthetic-email" });
  }
  const providerResponse = await providers.fetch(input, init);
  if (providerResponse) return providerResponse;
  unexpected.push(String(input));
  throw new Error("Unexpected outbound request denied: " + String(input));
};
const legacy = JSON.parse(await readFile(new URL("./legacy-1.7.1.json", import.meta.url), "utf8"));
const { createInMemoryDb } = await import("@repo/db/testing");
const { createAuth } = await import("../../lib/create-auth");

async function restoreLegacy() {
  const fixture = await createInMemoryDb({ throughMigration: 16 });
  for (const [table, rows] of Object.entries(legacy.tables) as [string, Record<string, unknown>[]][]) {
    for (const row of rows) {
      const keys = Object.keys(row);
      await fixture.db.$client.query(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
    }
  }
  const before: Record<string, unknown> = {};
  for (const table of Object.keys(legacy.tables)) {
    before[table] = (await fixture.db.$client.query(`SELECT row_to_json(t)::text AS bytes FROM "${table}" t ORDER BY id`)).rows;
  }
  await fixture.migrate();
  for (const table of Object.keys(legacy.tables)) {
    assert.deepEqual((await fixture.db.$client.query(`SELECT row_to_json(t)::text AS bytes FROM "${table}" t ORDER BY id`)).rows, before[table], `${table}: migration must preserve every field`);
  }
  return fixture;
}

test("1.7.1 session cookie survives forward migration and 1.7.7 schema validation", async () => {
  const fixture = await restoreLegacy();
  try {
    const auth = createAuth(fixture.db);
    const response = await auth.handler(new Request(origin + "/api/auth/get-session", { headers: { cookie: legacy.cookie } }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).user.id, legacy.users.owner);
    assert.deepEqual(unexpected, []);
  } finally { await fixture.close(); }
});

function request(auth: ReturnType<typeof createAuth>, path: string, body?: unknown, cookie = "", requestOrigin = origin) {
  return auth.handler(new Request(origin + "/api/auth" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: requestOrigin, cookie, "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
async function sessionUser(auth: ReturnType<typeof createAuth>, cookie: string) {
  const result = await request(auth, "/get-session", undefined, cookie);
  assert.equal(result.status, 200);
  return result.json();
}

test("unmigrated physical schema rejects account creation and issues no session", async () => {
  const fixture = await createInMemoryDb({ throughMigration: 16 });
  try {
    const response = await request(createAuth(fixture.db), "/sign-up/email", { name: "Blocked", email: "blocked@example.test", password });
    assert.equal(response.status, 500);
    assert.deepEqual((await fixture.db.$client.query("SELECT * FROM account")).rows, []);
    assert.equal(cookieHeader(response), "");
    assert.deepEqual((await fixture.db.$client.query("SELECT * FROM session")).rows, []);
  } finally { await fixture.close(); }
});

test("old password and verification token work; new HTTP signup verifies, signs in and signs out", async () => {
  const fixture = await restoreLegacy();
  try {
    const auth = createAuth(fixture.db);
    const login = await request(auth, "/sign-in/email", { email: "owner@example.test", password });
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = cookieHeader(login);
    assert.equal((await sessionUser(auth, cookie)).user.id, legacy.users.owner);
    assert.equal((await request(auth, "/sign-in/email", { email: "owner@example.test", password: "wrong-password" })).status, 401);
    assert.equal((await request(auth, "/sign-in/email", { email: "unverified@example.test", password })).status, 403);
    const oldVerification = await request(auth, "/verify-email?token=" + legacy.pendingEmailToken);
    assert.equal(oldVerification.status, 200, await oldVerification.clone().text());
    assert.equal((await request(auth, "/sign-in/email", { email: "unverified@example.test", password })).status, 200);

    const signup = await request(auth, "/sign-up/email", { name: "Fresh", email: "fresh@example.test", password });
    assert.equal(signup.status, 200, await signup.clone().text());
    const newId = (await signup.json()).user.id;
    assert.equal(cookieHeader(signup), "");
    assert.equal((await request(auth, "/send-verification-email", { email: "fresh@example.test" })).status, 200);
    const verified = await auth.handler(new Request(emails.at(-1)!));
    assert.equal(verified.status, 302);
    const freshCookie = cookieHeader(verified);
    assert.equal((await sessionUser(auth, freshCookie)).user.id, newId);
    assert.equal((await request(auth, "/sign-in/email", { email: "fresh@example.test", password })).status, 200);
    assert.equal((await request(auth, "/sign-in/email", { email: "fresh@example.test", password: "wrong-password" })).status, 401);
    assert.equal((await request(auth, "/sign-out", {}, freshCookie)).status, 200);
    assert.equal(await sessionUser(auth, freshCookie), null);
    assert.equal((await request(auth, "/sign-up/email", { name: "Too long", email: "long@example.test", password: "x".repeat(129) })).status, 400);
    assert.equal((await request(auth, "/sign-in/email", { email: "owner@example.test", password }, "", "https://attacker.invalid")).status, 403);
    const account = await fixture.db.$client.query("SELECT issuer FROM account WHERE user_id=$1", [newId]);
    assert.deepEqual(account.rows, [{ issuer: null }]);
  } finally { await fixture.close(); }
});

test("old organization, selected workspace and invitation survive; roles and invite lifecycle still enforce ownership", async () => {
  const fixture = await restoreLegacy();
  try {
    const auth = createAuth(fixture.db);
    const oldSession = await sessionUser(auth, legacy.cookie);
    assert.equal(oldSession.session.activeOrganizationId, legacy.orgId);
    const listed = await request(auth, "/organization/list", undefined, legacy.cookie);
    assert.equal((await listed.json())[0].id, legacy.orgId);
    const newUser = await request(auth, "/sign-up/email", { name: "Invitee", email: "invitee@example.test", password });
    assert.equal(newUser.status, 200);
    const verified = await auth.handler(new Request(emails.at(-1)!));
    const memberCookie = cookieHeader(verified);
    const invitationId = legacy.tables.invitation[0].id;
    const accepted = await request(auth, "/organization/accept-invitation", { invitationId }, memberCookie);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await request(auth, "/organization/set-active", { organizationId: legacy.orgId }, memberCookie)).status, 200);
    assert.equal((await sessionUser(auth, memberCookie)).session.activeOrganizationId, legacy.orgId);
    assert.equal((await request(auth, "/organization/invite-member", { email: "forbidden@example.test", role: "admin", organizationId: legacy.orgId }, memberCookie)).status, 403);
    const inviteBody = { email: "cancel@example.test", role: "member", organizationId: legacy.orgId };
    const invite = await request(auth, "/organization/invite-member", inviteBody, legacy.cookie);
    assert.equal(invite.status, 200, await invite.clone().text());
    const resend = await request(auth, "/organization/invite-member", { ...inviteBody, resend: true }, legacy.cookie);
    assert.equal(resend.status, 200, await resend.clone().text());
    assert.equal((await request(auth, "/organization/cancel-invitation", { invitationId: (await resend.json()).id }, legacy.cookie)).status, 200);
    assert.equal((await request(auth, "/organization/set-active", { organizationId: "foreign-organization" }, memberCookie)).status, 403);
    assert.equal((await sessionUser(auth, legacy.cookie)).session.activeOrganizationId, legacy.orgId);
  } finally { await fixture.close(); }
});

for (const provider of ["google", "microsoft"] as const) {
  test(`${provider}: old state rejected, fresh and existing subjects sign in, repeat preserves ownership, mismatches/replay fail`, async () => {
    const fixture = await restoreLegacy();
    try {
      const auth = createAuth(fixture.db);
      const start = async () => {
        const response = await request(auth, "/sign-in/social", { provider, callbackURL: origin + "/workspace" });
        assert.equal(response.status, 200, await response.clone().text());
        return { authorization: new URL((await response.json()).url), cookie: cookieHeader(response) };
      };
      const callback = (state: string, code: string, cookie: string) => request(auth, `/callback/${provider}?state=${encodeURIComponent(state)}&code=${code}`, undefined, cookie);
      const noSession = (response: Response) => {
        assert.equal(response.status, 302);
        assert.ok(new URL(response.headers.get("location")!).searchParams.get("error"));
        assert.equal(response.headers.getSetCookie().some(c => /session_token=[^;]/.test(c)), false);
      };
      const old = legacy.states[provider];
      const redeemedBefore = providers.redeemed;
      noSession(await callback(old.state, "must-not-redeem", old.cookie));
      assert.equal(providers.redeemed, redeemedBefore);
      assert.equal((await fixture.db.$client.query<{ count: number }>("SELECT count(*)::int AS count FROM verification WHERE identifier=$1", [old.state])).rows[0]?.count, 1);

      for (const subject of [`legacy-${provider}-subject`, `fresh-${provider}-subject`]) {
        const expectedOwner = subject.startsWith("legacy") ? legacy.users[provider] : null;
        let observedOwner: string | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const flow = await start();
          const state = flow.authorization.searchParams.get("state")!;
          const code = `${provider}-${subject}-${attempt}`;
          providers.grant(code, { provider, subject, email: `${subject.startsWith("legacy") ? provider : `fresh-${provider}`}@example.test`, authorization: flow.authorization });
          const response = await callback(state, code, flow.cookie);
          assert.equal(response.status, 302);
          assert.equal(response.headers.get("location"), origin + "/workspace");
          const owner = (await sessionUser(auth, cookieHeader(response))).user.id;
          if (expectedOwner) assert.equal(owner, expectedOwner);
          if (observedOwner) assert.equal(owner, observedOwner);
          observedOwner = owner;
          const accounts = await fixture.db.$client.query<{ id: string; user_id: string; issuer: string | null }>("SELECT id,user_id,issuer FROM account WHERE provider_id=$1 AND account_id=$2", [provider, subject]);
          assert.equal(accounts.rows.length, 1);
          assert.equal(accounts.rows[0]?.user_id, owner);
          if (expectedOwner) assert.equal(accounts.rows[0]?.id, legacy.tables.account.find((a: { provider_id: string; account_id: string }) => a.provider_id === provider && a.account_id === subject).id);
          else assert.equal(accounts.rows[0]?.issuer, null);
          const redeemed = providers.redeemed;
          noSession(await callback(state, code, flow.cookie));
          assert.equal(providers.redeemed, redeemed);
        }
      }
      const first = await start();
      const second = await start();
      const beforeMismatch = providers.redeemed;
      noSession(await callback(first.authorization.searchParams.get("state")!, "must-not-redeem", second.cookie));
      assert.equal(providers.redeemed, beforeMismatch);
      const redirectFlow = await start();
      providers.grant("redirect-response", { provider, subject: "must-not-adopt", email: "nobody@example.test", authorization: redirectFlow.authorization, redirectTokenResponse: true });
      noSession(await callback(redirectFlow.authorization.searchParams.get("state")!, "redirect-response", redirectFlow.cookie));
      assert.equal((await fixture.db.$client.query<{ count: number }>("SELECT count(*)::int AS count FROM account WHERE account_id='must-not-adopt'")).rows[0]?.count, 0);
      assert.deepEqual(unexpected, []);
    } finally { await fixture.close(); }
  });
}
