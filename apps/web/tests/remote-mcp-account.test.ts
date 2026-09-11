import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";
import { hashToken, mintToken } from "../lib/sync-auth";
import { GET } from "../app/api/sync/account/route";

test("account endpoint exposes paid and active-trial eligibility for the authenticated device without changing Sync access", async () => {
  const { db, close } = await createInMemoryDb({ throughMigration: 12 });
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previous = globalDb.__repoDbClient;
  const env = { ...process.env };
  globalDb.__repoDbClient = db;
  // Public fixtures; this route reads persisted state and never calls Stripe.
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_ACCOUNT_ID: "acct_fixture",
    STRIPE_PRICE_ID: "price_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture", DOODLENOTE_SELF_HOSTED: "false",
    DOODLENOTE_SYNC_V2_ENABLED: "false",
  });
  try {
    await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at)
      values('paid-owner','Paid','paid@example.test',true,now(),now()),
      ('free-owner','Free','free@example.test',true,now(),now())`);
    await db.execute(sql`insert into organization(id,name,slug,created_at)
      values('paid-work','Paid workspace','paid-work',now()),('free-work','Free workspace','free-work',now())`);
    await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at)
      values('paid-member','paid-work','paid-owner','member',now()),('free-member','free-work','free-owner','member',now())`);
    const paidToken = mintToken(), freeToken = mintToken();
    await db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id)
      values(${randomUUID()}::uuid,${hashToken(paidToken)},'paid-owner','paid-work'),
      (${randomUUID()}::uuid,${hashToken(freeToken)},'free-owner','free-work')`);
    await db.execute(sql`insert into subscriptions(user_id,status,stripe_subscription_id)
      values('paid-owner','active','sub_fixture')`);
    const request = (token: string) => new Request("https://notes.example.test/api/sync/account?userId=paid-owner", {
      headers: { authorization: `Bearer ${token}` },
    });
    for (const grandfathered of [false, true]) {
      for (const status of ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "none", "grandfathered", "invalid_price"]) {
        await db.execute(sql`update subscriptions set status=${status},grandfathered=${grandfathered} where user_id='paid-owner'`);
        const response = await GET(request(paidToken));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("vary"), "Authorization");
        assert.deepEqual(await response.json(), {
          accountId: "paid-owner", workspaceId: "paid-work", workspaceName: "Paid workspace",
          entitled: grandfathered || ["active", "trialing", "past_due"].includes(status),
          remoteMcpEligible: status === "active" || status === "trialing", syncAvailable: false, libraries: [],
        });
      }
    }
    await db.execute(sql`update subscriptions set status='active',grandfathered=false where user_id='paid-owner'`);
    const free = await (await GET(request(freeToken))).json();
    assert.equal(free.accountId, "free-owner");
    assert.equal(free.workspaceId, "free-work");
    assert.equal(free.remoteMcpEligible, false);
    assert.equal(free.entitled, false);
    // Complimentary access only applies to the authenticated, verified legacy owner.
    process.env.DOODLENOTE_REMOTE_MCP_COMPLIMENTARY_EMAILS = " PAID@example.test ";
    await db.execute(sql`update subscriptions set status='grandfathered',grandfathered=true where user_id='paid-owner'`);
    const legacyBefore = await db.execute(sql`select * from subscriptions where user_id='paid-owner'`);
    const complimentary = await (await GET(request(paidToken))).json();
    assert.equal(complimentary.remoteMcpEligible, true);
    assert.equal(complimentary.accountId, "paid-owner");
    assert.equal(complimentary.workspaceId, "paid-work");
    assert.equal(complimentary.entitled, true);
    assert.deepEqual((await db.execute(sql`select * from subscriptions where user_id='paid-owner'`)).rows, legacyBefore.rows);
    assert.equal((await (await GET(request(freeToken))).json()).remoteMcpEligible, false);
    await db.execute(sql`update "user" set email_verified=false where id='paid-owner'`);
    assert.equal((await (await GET(request(paidToken))).json()).remoteMcpEligible, false);
    await db.execute(sql`update "user" set email_verified=true where id='paid-owner'`);
    delete process.env.DOODLENOTE_REMOTE_MCP_COMPLIMENTARY_EMAILS;
    assert.equal((await (await GET(request(paidToken))).json()).remoteMcpEligible, false);
    process.env.DOODLENOTE_SELF_HOSTED = "true";
    const selfHosted = await (await GET(request(paidToken))).json();
    assert.equal(selfHosted.entitled, true);
    assert.equal(selfHosted.remoteMcpEligible, false);
    process.env.DOODLENOTE_SELF_HOSTED = "false";
    delete process.env.STRIPE_PRICE_ID;
    const misconfigured = await (await GET(request(paidToken))).json();
    assert.equal(misconfigured.remoteMcpEligible, false);
    process.env.STRIPE_PRICE_ID = "price_fixture";
    assert.equal((await GET(new Request("https://notes.example.test/api/sync/account"))).status, 401);
    await db.execute(sql`delete from member where id='paid-member'`);
    assert.equal((await GET(request(paidToken))).status, 401);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    globalDb.__repoDbClient = previous;
    await close();
  }
});
