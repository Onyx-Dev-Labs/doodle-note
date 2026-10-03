import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";
import { syncAccountResponse } from "../lib/sync-account";
import { authenticateIdentityRequest, authenticateSyncRequest, hashToken, mintToken } from "../lib/sync-auth";

test("native identity proof reopens lapsed identity but never authorizes data or voice; membership revocation invalidates it", async () => {
  const { db, close } = await createInMemoryDb({ throughMigration: 12 });
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previous = globalDb.__repoDbClient;
  globalDb.__repoDbClient = db;
  try {
    await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at)
      values('cache-owner','Owner','owner@example.test',true,now(),now())`);
    await db.execute(sql`insert into organization(id,name,slug,created_at) values('cache-work','Work','cache-work',now())`);
    await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at)
      values('cache-member','cache-work','cache-owner','member',now())`);
    const token = mintToken(true);
    await db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id)
      values(${randomUUID()}::uuid,${hashToken(token)},'cache-owner','cache-work')`);
    const request = new Request("https://local/api/sync/account", { headers: { authorization: `Bearer ${token}` } });
    const device = await authenticateIdentityRequest(request);
    assert.equal(device?.userId, "cache-owner");
    assert.equal(await authenticateSyncRequest(request), null);
    assert.equal(await authenticateSyncRequest(new Request(request.url, { headers: {
      authorization: `Bearer ${token.replace("dnid_", "dnsy_")}`,
    } })), null);
    const identity = await syncAccountResponse(db, device!, false, false);
    assert.equal(identity.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await identity.json(), { accountId: "cache-owner", workspaceId: "cache-work",
      workspaceName: "Work", entitled: false, remoteMcpEligible: false, syncAvailable: false, libraries: [] });
    const { GET: pull } = await import("../app/api/sync/pull/route");
    const { POST: push } = await import("../app/api/sync/push/route");
    assert.equal((await pull(request)).status, 401);
    assert.equal((await push(new Request(request.url, { method: "POST", headers: request.headers,
      body: JSON.stringify({ meetings: [] }) }))).status, 401);
    const { GET: voice } = await import("../app/api/voice/token/route");
    const { POST: callerID } = await import("../app/api/voice/caller-id/route");
    assert.equal((await voice(request)).status, 401);
    assert.equal((await callerID(new Request(request.url, { method: "POST", headers: request.headers }))).status, 401);
    await db.execute(sql`delete from member where id='cache-member'`);
    assert.equal(await authenticateIdentityRequest(request), null);
  } finally {
    globalDb.__repoDbClient = previous;
    await close();
  }
});

test("account library discovery is scoped and old schema fails closed without migration", async () => {
  const { db, close } = await createInMemoryDb();
  try {
    await db.execute(sql`insert into organization(id,name,slug,created_at) values('one','One','one',now()),('two','Two','two',now())`);
    const mine = randomUUID(), foreign = randomUUID();
    await db.execute(sql`insert into sync_libraries(id,organization_id) values(${mine}::uuid,'one'),(${foreign}::uuid,'two')`);
    const device = { deviceId: randomUUID(), userId: "owner", organizationId: "one", organizationName: "One" };
    const response = await syncAccountResponse(db, device, true, true);
    assert.deepEqual((await response.json()).libraries, [{ id: mine }]);
  } finally { await close(); }
  const legacy = await createInMemoryDb({ throughMigration: 12 });
  try {
    const response = await syncAccountResponse(legacy.db, { deviceId: "device", userId: "user",
      organizationId: "org", organizationName: "Org" }, true, true);
    assert.equal((await response.json()).syncAvailable, false);
  } finally { await legacy.close(); }
});
