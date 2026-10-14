import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { sql, type Db } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";

import { listMeetingsSharedWithUser, readSharedMeeting } from "../lib/meeting-recipients";
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
    // sync-auth stamps lastSeenAt without awaiting; PGlite runs queries in
    // order, so one more query lets that write finish before closing.
    await db.execute(sql`select 1`).catch(() => {});
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
      call("POST", path, { body: { emails: "Rae@Example.test, pending@example.test" } }),
      deps,
    );
    assert.equal(added.status, 201);
    const addedBody = await added.json();
    assert.deepEqual(addedBody.recipients.map((r: { email: string }) => r.email).sort(), ["pending@example.test", "rae@example.test"]);
    // Recipients carry no per-person settings.
    assert.ok(addedBody.recipients.every((r: Record<string, unknown>) => Object.keys(r).sort().join() === "createdAt,email,id"));
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
      const link = await handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, link: "on", includeTranscript: true, expiresInDays: 7 } }), { db });
      assert.equal(link.status, 402);
      assert.equal((await handleSyncShareRequest(call("GET", `/api/sync/share?meetingId=${meetingId}`), { db })).status, 402);
      const row = await shareRow(db, meetingId);
      assert.equal(row.share_token, null);
      assert.equal(row.share_include_transcript, false);
      assert.equal(await shareCount(db), 0);

      await db.execute(sql`insert into subscriptions(user_id,status) values('owner','active')`);
      assert.equal((await handleSyncRecipientsRequest(call("GET", recipients), deps)).status, 200);
    });
  });
});

test("old desktop request shape still mints a never-expiring link and never flips Include transcript", async () => {
  await withFixture(async ({ db, meetingId }) => {
    const old = (enable: boolean) => handleSyncShareRequest(call("POST", "/api/sync/share", { body: { meetingId, enable } }), { db });
    for (const includeTranscript of [true, false]) {
      await db.execute(sql`update meetings set share_include_transcript=${includeTranscript}, share_token=null, share_expires_at=null where id=${meetingId}::uuid`);
      const first = await old(true);
      assert.equal(first.status, 200);
      const body = await first.json();
      assert.equal(body.ok, true);
      assert.match(body.url, new RegExp(`^${ORIGIN}/share/[0-9a-f]{32}$`));
      assert.equal(body.link.url, body.url);
      assert.equal(body.link.expiresAt, null);
      assert.equal(body.includeTranscript, includeTranscript);
      const row = await shareRow(db, meetingId);
      assert.equal(row.share_include_transcript, includeTranscript);
      assert.equal(row.share_expires_at, null);

      // Repeat calls return the same link and still leave the setting alone.
      assert.equal((await (await old(true)).json()).url, body.url);
      assert.equal((await shareRow(db, meetingId)).share_include_transcript, includeTranscript);
    }

    // A link given an expiry elsewhere (web Share panel) keeps it under the old shape.
    const url = (await (await old(true)).json()).url;
    await db.execute(sql`update meetings set share_expires_at=now() + interval '7 days' where id=${meetingId}::uuid`);
    const kept = await (await old(true)).json();
    assert.equal(kept.url, url);
    assert.ok(kept.link.expiresAt);

    // Revoke is unchanged: url null, token and expiry cleared; the next
    // old-shape request mints a brand-new link with no expiry.
    const revoked = await (await old(false)).json();
    assert.equal(revoked.url, null);
    assert.equal(revoked.link, null);
    const row = await shareRow(db, meetingId);
    assert.equal(row.share_token, null);
    assert.equal(row.share_expires_at, null);
    assert.equal(row.share_include_transcript, false);
    const fresh = await (await old(true)).json();
    assert.notEqual(fresh.url, url);
    assert.equal(fresh.link.expiresAt, null);
  });
});

test("desktop share state and settings use the web Share panel contract", async () => {
  await withFixture(async ({ db, meetingId, otherWorkspaceMeetingId }) => {
    const post = (body: unknown, token?: string) => handleSyncShareRequest(call("POST", "/api/sync/share", { body, token }), { db });
    const get = (id: string, token?: string) => handleSyncShareRequest(call("GET", `/api/sync/share?meetingId=${id}`, { token }), { db });

    const initial = await get(meetingId);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await initial.json(), {
      ok: true,
      url: null,
      includeTranscript: false,
      link: null,
      recipients: [],
      workspace: { name: "Owner team", personal: false, memberCount: 1 },
      limits: { perRequest: 20, perMeeting: 50 },
    });

    // General access on: a never-expiring link by default.
    const on = await (await post({ meetingId, link: "on" })).json();
    assert.match(on.link.url, new RegExp(`^${ORIGIN}/share/[0-9a-f]{32}$`));
    assert.equal(on.link.expiresAt, null);
    const week = await (await post({ meetingId, expiresInDays: 7 })).json();
    assert.equal(week.link.url, on.link.url);
    assert.ok(Math.abs(Date.parse(week.link.expiresAt) - (Date.now() + 7 * 86_400_000)) < 60_000);
    assert.equal((await (await post({ meetingId, expiresInDays: 0 })).json()).link.expiresAt, null);

    // One transcript setting: toggling it changes what a recipient sees immediately.
    const recipients = `/api/sync/share/recipients?meetingId=${meetingId}`;
    assert.equal((await handleSyncRecipientsRequest(call("POST", recipients, { body: { emails: ["rae@example.test"] } }), { db })).status, 201);
    const rae = { id: "recipient", email: "rae@example.test", emailVerified: true };
    const recipientSeesTranscript = async () => {
      const read = await readSharedMeeting(db, { meetingId, identity: rae, requireVerifiedEmail: true, entitlement: async () => ({ entitled: true }) });
      assert.equal(read.status, "ok");
      return read.status === "ok" ? read.includeTranscript : null;
    };
    assert.equal(await recipientSeesTranscript(), false);
    const withTranscript = await (await post({ meetingId, includeTranscript: true })).json();
    assert.equal(withTranscript.includeTranscript, true);
    assert.equal(withTranscript.link.url, on.link.url);
    assert.deepEqual(withTranscript.recipients.map((r: { email: string }) => r.email), ["rae@example.test"]);
    assert.equal(await recipientSeesTranscript(), true);
    assert.equal((await shareRow(db, meetingId)).share_include_transcript, true);

    // General access off revokes; the transcript setting stays for people added.
    const off = await (await post({ meetingId, link: "off" })).json();
    assert.equal(off.link, null);
    assert.equal(off.url, null);
    assert.equal(off.includeTranscript, true);
    assert.equal(await recipientSeesTranscript(), true);

    const before = await shareRow(db, meetingId);
    for (const [body, status] of [
      [{ meetingId, expiresInDays: 3 }, 400],
      [{ meetingId, expiresInDays: "forever" }, 400],
      [{ meetingId, includeTranscript: "yes" }, 400],
      [{ meetingId, link: "maybe" }, 400],
      [{ meetingId }, 400],
      [{ meetingId, link: "off", expiresInDays: 7 }, 400],
      [{ meetingId, expiresInDays: 7 }, 409], // the link is off
      [{ meetingId: "nope", link: "on" }, 400],
    ] as const) {
      assert.equal((await post(body)).status, status, JSON.stringify(body));
    }
    assert.deepEqual(await shareRow(db, meetingId), before);

    // Another workspace's meeting, an unsynced id, or another user's device: 404, no writes.
    for (const [id, token] of [[otherWorkspaceMeetingId, undefined], [randomUUID(), undefined], [meetingId, OTHER_TOKEN]] as const) {
      for (const body of [{ meetingId: id, link: "on" }, { meetingId: id, includeTranscript: false }, { meetingId: id, enable: false }]) {
        const response = await post(body, token);
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error, "Meeting not synced yet — sync it first");
      }
      assert.equal((await get(id, token)).status, 404);
    }
    assert.deepEqual(await shareRow(db, meetingId), before);
    assert.equal((await shareRow(db, otherWorkspaceMeetingId)).share_token, null);
    assert.equal((await handleSyncShareRequest(call("PUT", "/api/sync/share", { body: {} }), { db })).status, 405);
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
