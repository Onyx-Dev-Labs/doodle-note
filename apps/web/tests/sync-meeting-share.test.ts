import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { sql, type Db } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";

import { listMeetingsSharedWithUser } from "../lib/meeting-recipients";
import type { RecipientsAddedEvent } from "../lib/meeting-recipients-http";
import { handleSyncRecipientsRequest, handleSyncShareRequest } from "../lib/sync-meeting-share";

const TOKEN = "dnsy_" + "ab".repeat(32);
const OTHER_TOKEN = "dnsy_" + "ef".repeat(32);
const ORIGIN = "https://notes.example.test";

interface Fixture {
  db: Db;
  meetingId: string;
  otherWorkspaceMeetingId: string;
}

type Rows<T> = { rows: T[] };

/**
 * Owner with a linked desktop device in owner-org, a meeting synced there, a
 * meeting in another workspace the owner also belongs to (the device is not
 * linked to it), and a recipient account.
 */
async function withFixture(run: (f: Fixture) => Promise<void>): Promise<void> {
  const { db, close } = await createInMemoryDb();
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previousDb = globalDb.__repoDbClient;
  const previousOrigin = process.env.BETTER_AUTH_URL;
  globalDb.__repoDbClient = db; // sync-auth and billing resolve through getDb()
  process.env.BETTER_AUTH_URL = ORIGIN;
  try {
    await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values
      ('owner','Olive Owner','owner@example.test',true,now(),now()),
      ('recipient','Rae Recipient','rae@example.test',true,now(),now())`);
    await db.execute(sql`insert into organization(id,name,slug,created_at) values
      ('owner-org','Owner team','owner-team',now()),('other-org','Other team','other-team',now()),('rae-org','Personal','personal-rae',now())`);
    await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values
      ('m-owner','owner-org','owner','owner',now()),('m-owner-other','other-org','owner','member',now()),('m-rae','rae-org','recipient','owner',now())`);
    await db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id) values
      (${randomUUID()}::uuid,${createHash("sha256").update(TOKEN).digest("hex")},'owner','owner-org'),
      (${randomUUID()}::uuid,${createHash("sha256").update(OTHER_TOKEN).digest("hex")},'recipient','rae-org')`);
    const meetingId = randomUUID();
    const otherWorkspaceMeetingId = randomUUID();
    await db.execute(sql`insert into meetings(id,organization_id,title) values
      (${meetingId}::uuid,'owner-org','Quarterly planning'),(${otherWorkspaceMeetingId}::uuid,'other-org','Other team sync')`);
    await run({ db, meetingId, otherWorkspaceMeetingId });
  } finally {
    globalDb.__repoDbClient = previousDb;
    if (previousOrigin === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousOrigin;
    await close();
  }
}

function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null } = {},
): Request {
  const token = options.token === undefined ? TOKEN : options.token;
  return new Request(`https://local${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function shareRow(db: Db, meetingId: string) {
  const result = (await db.execute(
    sql`select share_token, share_include_transcript, share_expires_at from meetings where id=${meetingId}::uuid`,
  )) as unknown as Rows<{ share_token: string | null; share_include_transcript: boolean; share_expires_at: string | Date | null }>;
  return result.rows[0]!;
}

async function shareCount(db: Db): Promise<number> {
  const result = (await db.execute(sql`select count(*)::int as count from meeting_shares`)) as unknown as Rows<{ count: number }>;
  return Number(result.rows[0]!.count);
}

/** Puts billing in stripe mode with public fixtures; entitlement then reads `subscriptions` only. */
async function withStripeBilling(run: () => Promise<void>): Promise<void> {
  const env = { ...process.env };
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_ACCOUNT_ID: "acct_fixture", STRIPE_PRICE_ID: "price_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture", DOODLENOTE_SELF_HOSTED: "false",
  });
  try {
    await run();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
}

test("desktop share-with-people adds, lists and removes recipients through the DEV-485 service", async () => {
  await withFixture(async ({ db, meetingId }) => {
    const events: RecipientsAddedEvent[] = [];
    const deps = { db, onRecipientsAdded: (event: RecipientsAddedEvent) => events.push(event) };
    const path = `/api/sync/share/recipients?meetingId=${meetingId}`;

    const empty = await handleSyncRecipientsRequest(call("GET", path), deps);
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).recipients, []);

    const added = await handleSyncRecipientsRequest(
      call("POST", path, { body: { emails: "Rae@Example.test, pending@example.test", includeTranscript: false } }),
      deps,
    );
    assert.equal(added.status, 201);
    const addedBody = await added.json();
    assert.deepEqual(addedBody.recipients.map((r: { email: string }) => r.email).sort(), ["pending@example.test", "rae@example.test"]);
    assert.ok(addedBody.recipients.every((r: { includeTranscript: boolean }) => r.includeTranscript === false));
    // No account information reaches the owner (no-enumeration rule).
    assert.doesNotMatch(JSON.stringify(addedBody), /hasAccount|recipientUserId|Rae Recipient/);
    // The sharer is the device's user, and the same notification hook fires.
    assert.deepEqual(events, [{
      meetingId,
      meetingTitle: "Quarterly planning",
      sharedBy: { name: "Olive Owner", email: "owner@example.test" },
      emails: ["rae@example.test", "pending@example.test"],
    }]);
    const sharedBy = (await db.execute(sql`select distinct shared_by_user_id from meeting_shares`)) as unknown as Rows<{ shared_by_user_id: string }>;
    assert.deepEqual(sharedBy.rows.map((r) => r.shared_by_user_id), ["owner"]);

    // The recipient sees it in their own Shared with me.
    const recipient = { id: "recipient", email: "rae@example.test", emailVerified: true };
    assert.deepEqual(
      (await listMeetingsSharedWithUser(db, { identity: recipient, requireVerifiedEmail: true })).map((m) => m.meetingId),
      [meetingId],
    );

    // DEV-485 validation applies unchanged: self, duplicate and invalid addresses.
    const self = await handleSyncRecipientsRequest(call("POST", path, { body: { emails: ["owner@example.test"] } }), deps);
    assert.equal(self.status, 400);
    assert.equal((await self.json()).code, "self_share");
    const again = await handleSyncRecipientsRequest(call("POST", path, { body: { emails: ["rae@example.test"] } }), deps);
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, "already_shared");
    const invalid = await handleSyncRecipientsRequest(call("POST", path, { body: { emails: "nope" } }), deps);
    assert.equal(invalid.status, 400);
    assert.deepEqual((await invalid.json()).emails, ["nope"]);
    assert.equal(events.length, 1);

    const listed = await (await handleSyncRecipientsRequest(call("GET", path), deps)).json();
    const rae = listed.recipients.find((r: { email: string }) => r.email === "rae@example.test");
    const removed = await handleSyncRecipientsRequest(call("DELETE", `${path}&recipientId=${rae.id}`), deps);
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).recipients.map((r: { email: string }) => r.email), ["pending@example.test"]);
    assert.deepEqual(await listMeetingsSharedWithUser(db, { identity: recipient, requireVerifiedEmail: true }), []);
    const missing = await handleSyncRecipientsRequest(call("DELETE", `${path}&recipientId=${rae.id}`), deps);
    assert.equal(missing.status, 404);
  });
});

test("desktop recipients require a synced meeting in the device's own workspace", async () => {
  await withFixture(async ({ db, meetingId, otherWorkspaceMeetingId }) => {
    const deps = { db, onRecipientsAdded: () => assert.fail("must not notify") };
    for (const id of [otherWorkspaceMeetingId, randomUUID()]) {
      const path = `/api/sync/share/recipients?meetingId=${id}`;
      for (const request of [
        call("GET", path),
        call("POST", path, { body: { emails: ["rae@example.test"] } }),
        call("DELETE", `${path}&recipientId=${randomUUID()}`),
      ]) {
        const response = await handleSyncRecipientsRequest(request, deps);
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error, "Meeting not synced yet — sync it first");
      }
    }
    // A different user's device cannot manage the owner's meeting either.
    const stranger = await handleSyncRecipientsRequest(
      call("POST", `/api/sync/share/recipients?meetingId=${meetingId}`, { token: OTHER_TOKEN, body: { emails: ["x@example.test"] } }),
      deps,
    );
    assert.equal(stranger.status, 404);
    const badId = await handleSyncRecipientsRequest(call("GET", "/api/sync/share/recipients?meetingId=nope"), deps);
    assert.equal(badId.status, 400);
    assert.equal(await shareCount(db), 0);
  });
});

test("desktop sharing is gated on the sync token and the owner's entitlement", async () => {
  await withFixture(async ({ db, meetingId }) => {
    const deps = { db, onRecipientsAdded: () => assert.fail("must not notify") };
    const recipients = `/api/sync/share/recipients?meetingId=${meetingId}`;
    for (const token of [null, "dnsy_" + "00".repeat(32)]) {
      assert.equal((await handleSyncRecipientsRequest(call("GET", recipients, { token }), deps)).status, 401);
      assert.equal((await handleSyncShareRequest(call("POST", "/api/sync/share", { token, body: { meetingId, enable: true } }), { db })).status, 401);
    }

    await withStripeBilling(async () => {
      const blocked = await handleSyncRecipientsRequest(call("POST", recipients, { body: { emails: ["rae@example.test"] } }), deps);
      assert.equal(blocked.status, 402);
      assert.equal((await blocked.json()).needsSubscription, true);
      const link = await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: true, includeTranscript: true, expiresInDays: 7 } }), { db });
      assert.equal(link.status, 402);
      assert.equal((await shareRow(db, meetingId)).share_token, null);
      assert.equal(await shareCount(db), 0);

      await db.execute(sql`insert into subscriptions(user_id,status) values('owner','active')`);
      assert.equal((await handleSyncRecipientsRequest(call("GET", recipients), deps)).status, 200);
    });
  });
});

test("old desktop request shape still mints a notes-only, never-expiring link", async () => {
  await withFixture(async ({ db, meetingId }) => {
    const first = await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: true } }), { db });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.ok, true);
    assert.match(body.url, new RegExp(`^${ORIGIN}/share/[0-9a-f]{32}$`));
    assert.equal(body.includeTranscript, false);
    assert.equal(body.expiresAt, null);
    const row = await shareRow(db, meetingId);
    assert.equal(row.share_include_transcript, false);
    assert.equal(row.share_expires_at, null);

    // Repeat calls return the same link.
    const second = await (await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: true } }), { db })).json();
    assert.equal(second.url, body.url);

    // A link configured elsewhere (web Share panel) keeps its settings under the old shape.
    await db.execute(sql`update meetings set share_include_transcript=true, share_expires_at=now() + interval '7 days' where id=${meetingId}::uuid`);
    const kept = await (await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: true } }), { db })).json();
    assert.equal(kept.url, body.url);
    assert.equal(kept.includeTranscript, true);
    assert.ok(kept.expiresAt);

    // Revoke is unchanged: the link stops resolving, and a later old-shape
    // request gets a brand-new notes-only link even if the column was left on.
    const revoked = await (await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: false } }), { db })).json();
    assert.equal(revoked.url, null);
    assert.equal((await shareRow(db, meetingId)).share_token, null);
    const fresh = await (await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable: true } }), { db })).json();
    assert.notEqual(fresh.url, body.url);
    assert.equal(fresh.includeTranscript, false);
    assert.equal(fresh.expiresAt, null);
  });
});

test("public link honors includeTranscript and expiresInDays and validates them", async () => {
  await withFixture(async ({ db, meetingId, otherWorkspaceMeetingId }) => {
    const post = (body: unknown) => handleSyncShareRequest(call("POST", "/api/sync/share", { body }), { db });

    const created = await post({ meetingId, enable: true, includeTranscript: true, expiresInDays: 7 });
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.includeTranscript, true);
    const expires = Date.parse(body.expiresAt);
    assert.ok(Math.abs(expires - (Date.now() + 7 * 86_400_000)) < 60_000);
    const row = await shareRow(db, meetingId);
    assert.equal(row.share_include_transcript, true);
    assert.equal(new Date(row.share_expires_at!).getTime(), expires);

    // Update keeps the URL; 0 = never expires.
    const updated = await (await post({ meetingId, enable: true, includeTranscript: false, expiresInDays: 0 })).json();
    assert.equal(updated.url, body.url);
    assert.equal(updated.includeTranscript, false);
    assert.equal(updated.expiresAt, null);
    assert.equal((await shareRow(db, meetingId)).share_expires_at, null);

    // GET reports the current settings without changing them.
    const read = await handleSyncShareRequest(call("GET", `/api/sync/share?meetingId=${meetingId}`), { db });
    assert.deepEqual(await read.json(), { ok: true, url: body.url, includeTranscript: false, expiresAt: null });

    for (const invalid of [
      { expiresInDays: 3 },
      { expiresInDays: -1 },
      { expiresInDays: "forever" },
      { includeTranscript: "yes" },
    ]) {
      const response = await post({ meetingId, enable: true, ...invalid });
      assert.equal(response.status, 400, JSON.stringify(invalid));
    }
    assert.equal((await shareRow(db, meetingId)).share_include_transcript, false);

    // Workspace and sync checks are the same as before.
    for (const id of [otherWorkspaceMeetingId, randomUUID()]) {
      const response = await post({ meetingId: id, enable: true, includeTranscript: true, expiresInDays: 1 });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "Meeting not synced yet — sync it first");
      assert.equal((await handleSyncShareRequest(call("GET", `/api/sync/share?meetingId=${id}`), { db })).status, 404);
    }
    assert.equal((await shareRow(db, otherWorkspaceMeetingId)).share_token, null);
    assert.equal((await post({ meetingId: "nope", enable: true })).status, 400);

    // Revoke clears the expiry too and GET reports no link.
    await post({ meetingId, enable: true, expiresInDays: 30 });
    await post({ meetingId, enable: false });
    assert.deepEqual(await (await handleSyncShareRequest(call("GET", `/api/sync/share?meetingId=${meetingId}`), { db })).json(), {
      ok: true, url: null, includeTranscript: false, expiresAt: null,
    });
    assert.equal((await shareRow(db, meetingId)).share_expires_at, null);
  });
});

test("the /api/sync/share route keeps its POST export and serves GET", async () => {
  await withFixture(async ({ meetingId }) => {
    const route = await import("../app/api/sync/share/route");
    const response = await route.POST(call("POST", "/api/sync/share", { body: { meetingId, enable: true } }));
    assert.equal(response.status, 200);
    const { url } = await response.json();
    const read = await route.GET(call("GET", `/api/sync/share?meetingId=${meetingId}`));
    assert.equal((await read.json()).url, url);
  });
});
