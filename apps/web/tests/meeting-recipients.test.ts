import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { sql, type Db } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";

import { entitlementFor } from "../lib/billing";
import {
  MAX_RECIPIENTS_PER_MEETING,
  addMeetingRecipients,
  findSharedMeetingGrant,
  listMeetingRecipients,
  listMeetingsSharedWithUser,
  normalizeRecipientEmail,
  planShareNotifications,
  readSharedMeeting,
  type ShareRecipientIdentity,
} from "../lib/meeting-recipients";
import {
  handleMeetingRecipientsRequest,
  type RecipientManagerAccess,
  type RecipientsAddedEvent,
} from "../lib/meeting-recipients-http";

const entitled = async () => ({ entitled: true, reason: "active" });

interface Fixture {
  db: Db;
  close: () => Promise<void>;
  meetingId: string;
  otherMeetingId: string;
  owner: RecipientManagerAccess;
  recipient: ShareRecipientIdentity;
  stranger: ShareRecipientIdentity;
}

/** Owner workspace with two meetings, plus a recipient and a stranger in their own workspaces. */
async function fixture(): Promise<Fixture> {
  const { db, close } = await createInMemoryDb();
  await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values
    ('owner','Olive Owner','owner@example.test',true,now(),now()),
    ('recipient','Rae Recipient','rae@example.test',true,now(),now()),
    ('stranger','Sam Stranger','sam@example.test',true,now(),now())`);
  await db.execute(sql`insert into organization(id,name,slug,created_at) values
    ('owner-org','Owner team','owner-team',now()),('recipient-org','Personal','personal-rae',now()),('stranger-org','Personal','personal-sam',now())`);
  await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values
    ('m-owner','owner-org','owner','owner',now()),('m-rae','recipient-org','recipient','owner',now()),('m-sam','stranger-org','stranger','owner',now())`);
  const meetingId = randomUUID();
  const otherMeetingId = randomUUID();
  const folderId = randomUUID();
  await db.execute(sql`insert into folders(id,organization_id,name) values(${folderId}::uuid,'owner-org','Private folder')`);
  await db.execute(sql`insert into meetings(id,organization_id,title,folder_id) values
    (${meetingId}::uuid,'owner-org','Quarterly planning',${folderId}::uuid),(${otherMeetingId}::uuid,'owner-org','Secret other meeting',null)`);
  await db.execute(sql`insert into notes(meeting_id,enhanced_content) values(${meetingId}::uuid,${JSON.stringify({ format: "markdown", markdown: "# Plan\n- ship it" })}::jsonb)`);
  await db.execute(sql`insert into transcript_segments(meeting_id,channel,speaker,text,start_ms,end_ms) values
    (${meetingId}::uuid,'mic','You','Let us ship it',0,1000),(${meetingId}::uuid,'system','Rae','Agreed',1000,2000)`);
  return {
    db,
    close,
    meetingId,
    otherMeetingId,
    owner: { meetingId, meetingTitle: "Quarterly planning", userId: "owner", userEmail: "owner@example.test", userName: "Olive Owner" },
    recipient: { id: "recipient", email: "rae@example.test", emailVerified: true },
    stranger: { id: "stranger", email: "sam@example.test", emailVerified: true },
  };
}

function request(method: string, body?: unknown, query = ""): Request {
  return new Request(`http://localhost/api/meetings/x/recipients${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function shareCount(db: Db): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as count from meeting_shares`);
  return Number((result as unknown as { rows: Array<{ count: number }> }).rows[0]!.count);
}

test("owner can share, list, and remove people; notification hook gets only new addresses", async () => {
  const f = await fixture();
  try {
    const events: RecipientsAddedEvent[] = [];
    const handle = (req: Request) =>
      handleMeetingRecipientsRequest(req, { db: f.db, access: f.owner, onRecipientsAdded: (event) => events.push(event) });

    const empty = await handle(request("GET"));
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await empty.json()).recipients, []);

    const created = await handle(request("POST", { emails: " Rae@Example.test , newperson@example.test" }));
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.deepEqual(body.added.map((r: { email: string }) => r.email).sort(), ["newperson@example.test", "rae@example.test"]);
    // No per-person settings: transcript visibility is meeting-level.
    assert.ok(body.added.every((r: Record<string, unknown>) => Object.keys(r).sort().join() === "createdAt,email,id"));
    assert.equal(body.recipients.length, 2);
    assert.deepEqual(events, [{
      meetingId: f.meetingId,
      meetingTitle: "Quarterly planning",
      sharedBy: { name: "Olive Owner", email: "owner@example.test" },
      emails: body.added.map((r: { email: string }) => r.email),
    }]);

    // A per-person transcript flag from an older client is ignored, not stored.
    const third = await handle(request("POST", { emails: ["third@example.test"], includeTranscript: false }));
    assert.equal(third.status, 201);
    assert.equal("includeTranscript" in (await third.json()).added[0], false);

    const listed = await (await handle(request("GET"))).json();
    assert.equal(listed.recipients.length, 3);
    const rae = listed.recipients.find((r: { email: string }) => r.email === "rae@example.test");

    const removed = await handle(request("DELETE", undefined, `?recipientId=${rae.id}`));
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).recipients.map((r: { email: string }) => r.email).sort(), ["newperson@example.test", "third@example.test"]);
    assert.equal((await handle(request("DELETE", undefined, `?recipientId=${rae.id}`))).status, 404);
    assert.equal((await handle(request("DELETE", { recipientId: "not-a-uuid" }))).status, 404);
    assert.equal((await handle(request("DELETE"))).status, 400);
    assert.equal((await handle(request("PATCH", {}))).status, 405);
  } finally {
    await f.close();
  }
});

test("callers without management access get 404 on every method and nothing changes", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    const before = await shareCount(f.db);
    const [row] = await listMeetingRecipients(f.db, f.meetingId);
    for (const req of [request("GET"), request("POST", { emails: ["x@example.test"] }), request("DELETE", undefined, `?recipientId=${row!.id}`)]) {
      const response = await handleMeetingRecipientsRequest(req, { db: f.db, access: null });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Meeting not found" });
    }
    assert.equal(await shareCount(f.db), before);
  } finally {
    await f.close();
  }
});

test("a recipient reads exactly the shared meeting, transcript only while the meeting setting is on", async () => {
  const f = await fixture();
  try {
    await f.db.execute(sql`update meetings set share_include_transcript=true where id=${f.meetingId}::uuid`);
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    const read = await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled });
    assert.equal(read.status, "ok");
    if (read.status !== "ok") return;
    assert.equal(read.markdown, "# Plan\n- ship it");
    assert.equal(read.segments.length, 2);
    assert.equal(read.sharedByEmail, "owner@example.test");
    assert.equal(read.meeting.organizationId, "owner-org"); // never moved

    // Other meetings in the owner's workspace stay invisible.
    assert.equal((await readSharedMeeting(f.db, { meetingId: f.otherMeetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled })).status, "not_found");
    const library = await listMeetingsSharedWithUser(f.db, { identity: f.recipient, requireVerifiedEmail: true });
    assert.deepEqual(library.map((m) => m.title), ["Quarterly planning"]);
    assert.equal(library[0]!.sharedByEmail, "owner@example.test");
    assert.deepEqual(Object.keys(library[0]!).sort(), ["createdAt", "endedAt", "kind", "meetingId", "sharedAt", "sharedByEmail", "sharedByName", "startedAt", "title"]);

    // Notes only (the default for a meeting): transcript is not even loaded.
    await f.db.execute(sql`update meetings set share_include_transcript=false where id=${f.meetingId}::uuid`);
    const notesOnly = await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled });
    assert.equal(notesOnly.status, "ok");
    if (notesOnly.status === "ok") {
      assert.equal(notesOnly.includeTranscript, false);
      assert.deepEqual(notesOnly.segments, []);
      assert.equal(notesOnly.markdown, "# Plan\n- ship it");
    }
  } finally {
    await f.close();
  }
});

test("strangers and revoked recipients get nothing", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    assert.equal((await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.stranger, requireVerifiedEmail: true, entitlement: entitled })).status, "not_found");
    assert.deepEqual(await listMeetingsSharedWithUser(f.db, { identity: f.stranger, requireVerifiedEmail: true }), []);
    assert.equal((await readSharedMeeting(f.db, { meetingId: "not-a-uuid", identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled })).status, "not_found");

    // Open once (attaches recipient_user_id), then revoke.
    assert.equal((await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled })).status, "ok");
    const [row] = await listMeetingRecipients(f.db, f.meetingId);
    const response = await handleMeetingRecipientsRequest(request("DELETE", undefined, `?recipientId=${row!.id}`), { db: f.db, access: f.owner });
    assert.equal(response.status, 200);
    assert.equal((await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitled })).status, "not_found");
    assert.deepEqual(await listMeetingsSharedWithUser(f.db, { identity: f.recipient, requireVerifiedEmail: true }), []);
  } finally {
    await f.close();
  }
});

test("a pending email share attaches when that address signs up, and stays bound to that account", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["Later@Example.test"] });
    const pending = await f.db.execute(sql`select recipient_email, recipient_user_id from meeting_shares`);
    assert.deepEqual((pending as unknown as { rows: unknown[] }).rows, [{ recipient_email: "later@example.test", recipient_user_id: null }]);

    // "Sign-up": the account now exists with a verified email.
    await f.db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values('later','Later','later@example.test',true,now(),now())`);
    const later = { id: "later", email: "later@example.test", emailVerified: true };
    const library = await listMeetingsSharedWithUser(f.db, { identity: later, requireVerifiedEmail: true });
    assert.deepEqual(library.map((m) => m.meetingId), [f.meetingId]);
    const attached = await f.db.execute(sql`select recipient_user_id from meeting_shares`);
    assert.equal((attached as unknown as { rows: Array<{ recipient_user_id: string }> }).rows[0]!.recipient_user_id, "later");

    // After attach, the grant follows the account (e.g. after an email change) and
    // another account presenting the old address cannot claim it.
    const renamed = { ...later, email: "renamed@example.test" };
    assert.ok(await findSharedMeetingGrant(f.db, { meetingId: f.meetingId, identity: renamed, requireVerifiedEmail: true }));
    const impostor = { id: "impostor", email: "later@example.test", emailVerified: true };
    assert.equal(await findSharedMeetingGrant(f.db, { meetingId: f.meetingId, identity: impostor, requireVerifiedEmail: true }), null);
  } finally {
    await f.close();
  }
});

test("unverified emails match only when email verification is disabled (local development)", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["fresh@example.test"] });
    const unverified = { id: "fresh", email: "fresh@example.test", emailVerified: false };
    await f.db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values('fresh','Fresh','fresh@example.test',false,now(),now())`);

    assert.equal((await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: unverified, requireVerifiedEmail: true, entitlement: entitled })).status, "not_found");
    assert.deepEqual(await listMeetingsSharedWithUser(f.db, { identity: unverified, requireVerifiedEmail: true }), []);
    const stillPending = await f.db.execute(sql`select recipient_user_id from meeting_shares`);
    assert.equal((stillPending as unknown as { rows: Array<{ recipient_user_id: string | null }> }).rows[0]!.recipient_user_id, null);

    assert.equal((await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: unverified, requireVerifiedEmail: false, entitlement: entitled })).status, "ok");
  } finally {
    await f.close();
  }
});

test("the owner-facing response is identical for existing accounts and unknown addresses", async () => {
  const f = await fixture();
  try {
    const shape = async (email: string) => {
      const response = await handleMeetingRecipientsRequest(request("POST", { emails: [email] }), { db: f.db, access: f.owner });
      const body = await response.json();
      await handleMeetingRecipientsRequest(request("DELETE", undefined, `?recipientId=${body.added[0].id}`), { db: f.db, access: f.owner });
      const scrub = (r: Record<string, unknown>) => ({ ...r, id: "<id>", createdAt: "<date>", email: "<email>" });
      return {
        status: response.status,
        headers: [...response.headers.entries()].sort(),
        body: { ...body, added: body.added.map(scrub), recipients: body.recipients.map(scrub) },
      };
    };
    const existing = await shape("rae@example.test");
    const unknown = await shape("nobody-here@example.test");
    assert.deepEqual(existing, unknown);
    assert.deepEqual(Object.keys(existing.body.added[0]).sort(), ["createdAt", "email", "id"]);

    // Account existence only drives the recipient's email template, server-side.
    assert.deepEqual(await planShareNotifications(f.db, ["rae@example.test", "nobody-here@example.test"]), [
      { email: "rae@example.test", hasAccount: true },
      { email: "nobody-here@example.test", hasAccount: false },
    ]);
  } finally {
    await f.close();
  }
});

test("invalid, duplicate, self, oversized, over-limit, and already-shared requests create no rows", async () => {
  const f = await fixture();
  try {
    const post = async (body: unknown) => {
      const response = await handleMeetingRecipientsRequest(request("POST", body), { db: f.db, access: f.owner });
      return { status: response.status, body: await response.json() };
    };
    const cases: Array<[unknown, number, string]> = [
      [{ emails: [] }, 400, "no_emails"],
      [{ emails: "   " }, 400, "no_emails"],
      [{ emails: ["ok@example.test", "not-an-email"] }, 400, "invalid_email"],
      [{ emails: ["a@example.test", "A@example.test "] }, 400, "duplicate_email"],
      [{ emails: ["friend@example.test", "OWNER@example.test"] }, 400, "self_share"],
      [{ emails: Array.from({ length: 21 }, (_, i) => `p${i}@example.test`) }, 400, "too_many_emails"],
    ];
    for (const [body, status, code] of cases) {
      const result = await post(body);
      assert.equal(result.status, status, JSON.stringify(body));
      assert.equal(result.body.code, code);
      assert.equal(typeof result.body.error, "string");
    }
    const badJson = await handleMeetingRecipientsRequest(
      new Request("http://localhost/x", { method: "POST", body: "{" }),
      { db: f.db, access: f.owner },
    );
    assert.equal(badJson.status, 400);
    assert.equal(await shareCount(f.db), 0);

    assert.equal((await post({ emails: ["dup@example.test"] })).status, 201);
    const again = await post({ emails: ["new@example.test", "DUP@example.test"] });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "already_shared");
    assert.deepEqual(again.body.emails, ["dup@example.test"]);
    assert.equal(await shareCount(f.db), 1);

    // Fill to the per-meeting cap, then one more is refused.
    for (let start = 1; start < MAX_RECIPIENTS_PER_MEETING; start += 20) {
      const batch = Array.from({ length: Math.min(20, MAX_RECIPIENTS_PER_MEETING - start) }, (_, i) => `cap${start + i}@example.test`);
      assert.equal((await post({ emails: batch })).status, 201);
    }
    assert.equal(await shareCount(f.db), MAX_RECIPIENTS_PER_MEETING);
    const over = await post({ emails: ["one-more@example.test"] });
    assert.equal(over.status, 400);
    assert.equal(over.body.code, "recipient_limit");
    assert.equal(await shareCount(f.db), MAX_RECIPIENTS_PER_MEETING);

    // The database itself refuses non-normalized addresses.
    await assert.rejects(f.db.execute(sql`insert into meeting_shares(meeting_id,recipient_email,shared_by_user_id) values(${f.meetingId}::uuid,'Upper@Example.test','owner')`));
  } finally {
    await f.close();
  }
});

test("email normalization", () => {
  assert.equal(normalizeRecipientEmail("  Person@Example.COM "), "person@example.com");
  for (const bad of ["", "no-at", "a@b", "a b@example.com", "<a@example.com>", 42, null]) {
    assert.equal(normalizeRecipientEmail(bad), null, String(bad));
  }
});

test("a notification failure never fails the share", async () => {
  const f = await fixture();
  try {
    const response = await handleMeetingRecipientsRequest(request("POST", { emails: ["rae@example.test"] }), {
      db: f.db,
      access: f.owner,
      onRecipientsAdded: () => {
        throw new Error("email provider down");
      },
    });
    assert.equal(response.status, 201);
    assert.equal(await shareCount(f.db), 1);
  } finally {
    await f.close();
  }
});

test("non-entitled recipients get an upgrade result with no meeting content", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    let asked: string | null = null;
    const blocked = await readSharedMeeting(f.db, {
      meetingId: f.meetingId,
      identity: f.recipient,
      requireVerifiedEmail: true,
      entitlement: async (userId) => {
        asked = userId;
        return { entitled: false, reason: "none" };
      },
    });
    assert.equal(asked, "recipient"); // the recipient's own plan, not the owner's
    assert.deepEqual(blocked, { status: "needs_subscription", meetingId: f.meetingId, sharedByEmail: "owner@example.test", sharedByName: "Olive Owner" });
    const unavailable = await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: async () => ({ entitled: false, reason: "configuration_error" }) });
    assert.equal(unavailable.status, "billing_unavailable");
    // Still listed in Shared with me.
    assert.equal((await listMeetingsSharedWithUser(f.db, { identity: f.recipient, requireVerifiedEmail: true })).length, 1);
  } finally {
    await f.close();
  }
});

test("the real entitlement check gates recipients by their persisted subscription", async () => {
  const f = await fixture();
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previousDb = globalDb.__repoDbClient;
  const env = { ...process.env };
  globalDb.__repoDbClient = f.db;
  // Public fixtures; entitlementFor reads the subscriptions table and never calls Stripe.
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_ACCOUNT_ID: "acct_fixture", STRIPE_PRICE_ID: "price_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture", DOODLENOTE_SELF_HOSTED: "false",
  });
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    const read = () => readSharedMeeting(f.db, { meetingId: f.meetingId, identity: f.recipient, requireVerifiedEmail: true, entitlement: entitlementFor });
    assert.equal((await read()).status, "needs_subscription");
    await f.db.execute(sql`insert into subscriptions(user_id,status) values('recipient','active')`);
    assert.equal((await read()).status, "ok");
    await f.db.execute(sql`update subscriptions set status='canceled' where user_id='recipient'`);
    assert.equal((await read()).status, "needs_subscription");
  } finally {
    globalDb.__repoDbClient = previousDb;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await f.close();
  }
});

test("desktop sync DELETE of a meeting cascades its share rows away", async () => {
  const f = await fixture();
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previousDb = globalDb.__repoDbClient;
  const previousV2 = process.env.DOODLENOTE_SYNC_V2_ENABLED;
  delete process.env.DOODLENOTE_SYNC_V2_ENABLED;
  globalDb.__repoDbClient = f.db;
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test", "pending@example.test"] });
    await addMeetingRecipients(f.db, { meetingId: f.otherMeetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    assert.equal(await shareCount(f.db), 3);

    const token = "dnsy_" + "cd".repeat(32);
    await f.db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id) values(${randomUUID()}::uuid,${createHash("sha256").update(token).digest("hex")},'owner','owner-org')`);
    await f.db.execute(sql`insert into subscriptions(user_id,grandfathered) values('owner',true)`);
    const route = await import("../app/api/sync/push/route");
    const response = await route.DELETE(new Request("https://local/api/sync/push", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: [f.meetingId] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(await shareCount(f.db), 1);
    assert.deepEqual((await listMeetingsSharedWithUser(f.db, { identity: f.recipient, requireVerifiedEmail: true })).map((m) => m.title), ["Secret other meeting"]);
    const owner = await f.db.execute(sql`select organization_id from meetings where id=${f.otherMeetingId}::uuid`);
    assert.equal((owner as unknown as { rows: Array<{ organization_id: string }> }).rows[0]!.organization_id, "owner-org");
  } finally {
    globalDb.__repoDbClient = previousDb;
    if (previousV2 === undefined) delete process.env.DOODLENOTE_SYNC_V2_ENABLED;
    else process.env.DOODLENOTE_SYNC_V2_ENABLED = previousV2;
    await f.close();
  }
});
