import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { sql, type Db } from "@repo/db";
import { createInMemoryDb } from "@repo/db/testing";

import { addMeetingRecipients, readSharedMeeting } from "../lib/meeting-recipients";
import {
  handleMeetingShareRequest,
  parseShareSettingsUpdate,
  readMeetingShareState,
} from "../lib/meeting-share-state";

delete process.env.BETTER_AUTH_URL;
const ORIGIN = "http://localhost";
const DAY_MS = 24 * 60 * 60 * 1000;
const entitled = async () => ({ entitled: true, reason: "active" });
const rae = { id: "recipient", email: "rae@example.test", emailVerified: true };

interface Fixture {
  db: Db;
  close: () => Promise<void>;
  meetingId: string;
  personalMeetingId: string;
}

/** A two-person team workspace meeting (notes + transcript), a personal meeting, and a recipient. */
async function fixture(): Promise<Fixture> {
  const { db, close } = await createInMemoryDb();
  await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values
    ('owner','Olive Owner','owner@example.test',true,now(),now()),
    ('teammate','Tia Teammate','tia@example.test',true,now(),now()),
    ('recipient','Rae Recipient','rae@example.test',true,now(),now())`);
  await db.execute(sql`insert into organization(id,name,slug,created_at) values
    ('team-org','Acme','acme',now()),('owner-personal','Personal','personal-olive',now()),('rae-personal','Personal','personal-rae',now())`);
  await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values
    ('m1','team-org','owner','owner',now()),('m2','team-org','teammate','member',now()),
    ('m3','owner-personal','owner','owner',now()),('m4','rae-personal','recipient','owner',now())`);
  const meetingId = randomUUID();
  const personalMeetingId = randomUUID();
  await db.execute(sql`insert into meetings(id,organization_id,title) values
    (${meetingId}::uuid,'team-org','Quarterly planning'),(${personalMeetingId}::uuid,'owner-personal','Journal')`);
  await db.execute(sql`insert into notes(meeting_id,enhanced_content) values(${meetingId}::uuid,${JSON.stringify({ format: "markdown", markdown: "# Plan" })}::jsonb)`);
  await db.execute(sql`insert into transcript_segments(meeting_id,channel,speaker,text,start_ms,end_ms) values
    (${meetingId}::uuid,'mic','You','Let us ship it',0,1000),(${meetingId}::uuid,'system','Tia','Agreed',1000,2000)`);
  return { db, close, meetingId, personalMeetingId };
}

function request(method: string, body?: unknown): Request {
  return new Request(`${ORIGIN}/api/meetings/x/share`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function call(f: Fixture, method: string, body?: unknown, meetingId: string | null = f.meetingId) {
  const response = await handleMeetingShareRequest(request(method, body), { db: f.db, meetingId });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function shareColumns(db: Db, meetingId: string) {
  const result = await db.execute(sql`select share_token, share_expires_at, share_include_transcript, updated_at from meetings where id=${meetingId}::uuid`);
  return (result as unknown as { rows: Array<{ share_token: string | null; share_expires_at: string | null; share_include_transcript: boolean; updated_at: string }> }).rows[0]!;
}

/** Renders the real public reader (/share/[token]) and returns what it shows, or null for its 404. */
async function publicReader(db: Db, url: string | null) {
  if (!url) return null;
  const globalDb = globalThis as { __repoDbClient?: unknown };
  const previous = globalDb.__repoDbClient;
  globalDb.__repoDbClient = db;
  try {
    const { default: SharePage } = await import("../app/share/[token]/page");
    const tree = await SharePage({ params: Promise.resolve({ token: url.split("/").pop()! }) });
    const find = (node: unknown): { segments: unknown[]; showTranscript: boolean } | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = find(child);
          if (found) return found;
        }
        return null;
      }
      const props = (node as { props?: Record<string, unknown> }).props;
      if (props && "segments" in props && "showTranscript" in props) {
        return { segments: props.segments as unknown[], showTranscript: props.showTranscript as boolean };
      }
      return props ? find(props.children) : null;
    };
    return find(tree);
  } catch (error) {
    if (String((error as { digest?: unknown })?.digest ?? "").includes("404")) return null;
    throw error;
  } finally {
    globalDb.__repoDbClient = previous;
  }
}

test("GET returns one share state: notes only, no link, and who already has access", async () => {
  const f = await fixture();
  try {
    const team = await call(f, "GET");
    assert.equal(team.status, 200);
    assert.equal(team.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(team.body, {
      ok: true,
      includeTranscript: false,
      link: null,
      recipients: [],
      workspace: { name: "Acme", personal: false, memberCount: 2 },
      limits: { perRequest: 20, perMeeting: 50 },
    });
    const personal = await call(f, "GET", undefined, f.personalMeetingId);
    assert.deepEqual(personal.body.workspace, { name: "Personal", personal: true, memberCount: 1 });

    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    const shared = await call(f, "GET");
    assert.deepEqual(shared.body.recipients.map((r: Record<string, unknown>) => Object.keys(r).sort()), [["createdAt", "email", "id"]]);
  } finally {
    await f.close();
  }
});

test("one Include transcript setting governs people added and the public link, immediately", async () => {
  const f = await fixture();
  try {
    await addMeetingRecipients(f.db, { meetingId: f.meetingId, sharedByUserId: "owner", sharedByEmail: "owner@example.test", emails: ["rae@example.test"] });
    const on = await call(f, "POST", { link: "on" });
    assert.equal(on.status, 200);
    const url = on.body.link.url as string;

    const recipientView = async () => {
      const read = await readSharedMeeting(f.db, { meetingId: f.meetingId, identity: rae, requireVerifiedEmail: true, entitlement: entitled });
      assert.equal(read.status, "ok");
      return read.status === "ok" ? { includeTranscript: read.includeTranscript, segments: read.segments.length } : null;
    };

    // Default: notes only, for everyone.
    assert.deepEqual(await recipientView(), { includeTranscript: false, segments: 0 });
    assert.deepEqual(await publicReader(f.db, url), { segments: [], showTranscript: false });

    const withTranscript = await call(f, "POST", { includeTranscript: true });
    assert.equal(withTranscript.body.includeTranscript, true);
    assert.equal(withTranscript.body.link.url, url); // the link is untouched
    assert.deepEqual(await recipientView(), { includeTranscript: true, segments: 2 });
    const reader = await publicReader(f.db, url);
    assert.equal(reader?.showTranscript, true);
    assert.equal(reader?.segments.length, 2);

    await call(f, "POST", { includeTranscript: false });
    assert.deepEqual(await recipientView(), { includeTranscript: false, segments: 0 });
    assert.deepEqual(await publicReader(f.db, url), { segments: [], showTranscript: false });
  } finally {
    await f.close();
  }
});

test("general access on creates a never-expiring link, expiry can change, off revokes", async () => {
  const f = await fixture();
  try {
    const on = await call(f, "POST", { link: "on" });
    assert.match(on.body.link.url, /^http:\/\/localhost\/share\/[0-9a-f]{32}$/);
    assert.equal(on.body.link.expiresAt, null); // Never is the default
    assert.equal((await call(f, "POST", { link: "on" })).body.link.url, on.body.link.url);

    const before = Date.now();
    const week = await call(f, "POST", { expiresInDays: 7 });
    assert.equal(week.body.link.url, on.body.link.url);
    const expiresAt = Date.parse(week.body.link.expiresAt);
    assert.ok(expiresAt >= before + 7 * DAY_MS - 1000 && expiresAt <= Date.now() + 7 * DAY_MS + 1000);
    // Turning the link on again keeps the chosen expiry.
    assert.equal((await call(f, "POST", { link: "on" })).body.link.expiresAt, week.body.link.expiresAt);
    assert.equal((await call(f, "POST", { expiresInDays: 0 })).body.link.expiresAt, null);
    const oneDay = await call(f, "POST", { link: "on", expiresInDays: 1 });
    assert.ok(Date.parse(oneDay.body.link.expiresAt) > Date.now() + DAY_MS - 60_000);

    const off = await call(f, "POST", { link: "off" });
    assert.equal(off.status, 200);
    assert.equal(off.body.link, null);
    const columns = await shareColumns(f.db, f.meetingId);
    assert.equal(columns.share_token, null);
    assert.equal(columns.share_expires_at, null);
    assert.equal(await publicReader(f.db, on.body.link.url), null);

    // Back on: a brand-new URL with no expiry; the revoked one stays dead.
    const again = await call(f, "POST", { link: "on" });
    assert.notEqual(again.body.link.url, on.body.link.url);
    assert.equal(again.body.link.expiresAt, null);
    assert.equal(await publicReader(f.db, on.body.link.url), null);
    assert.ok(await publicReader(f.db, again.body.link.url));
  } finally {
    await f.close();
  }
});

test("an expired link reads as off and is never revived", async () => {
  const f = await fixture();
  try {
    const on = await call(f, "POST", { link: "on", expiresInDays: 1 });
    await f.db.execute(sql`update meetings set share_expires_at=now() - interval '1 minute' where id=${f.meetingId}::uuid`);
    assert.equal((await call(f, "GET")).body.link, null);
    const expiryOnly = await call(f, "POST", { expiresInDays: 30 });
    assert.equal(expiryOnly.status, 409);
    assert.equal(expiryOnly.body.code, "link_off");
    const fresh = await call(f, "POST", { link: "on" });
    assert.notEqual(fresh.body.link.url, on.body.link.url);
    assert.equal(fresh.body.link.expiresAt, null);
    assert.equal(await publicReader(f.db, on.body.link.url), null);
  } finally {
    await f.close();
  }
});

test("an older client's enable:true|false only turns the link on or off", async () => {
  const f = await fixture();
  try {
    await call(f, "POST", { includeTranscript: true });
    const enabled = await call(f, "POST", { enable: true });
    assert.equal(enabled.body.includeTranscript, true);
    assert.equal(enabled.body.link.expiresAt, null);
    assert.equal((await call(f, "POST", { enable: false })).body.link, null);
    assert.equal((await shareColumns(f.db, f.meetingId)).share_include_transcript, true);
    assert.deepEqual(parseShareSettingsUpdate({ enable: true }), { ok: true, update: { link: "on" } });
    // An explicit link wins over enable.
    assert.deepEqual(parseShareSettingsUpdate({ enable: true, link: "off" }), { ok: true, update: { link: "off" } });
  } finally {
    await f.close();
  }
});

test("invalid settings are rejected and change nothing", async () => {
  const f = await fixture();
  try {
    await call(f, "POST", { link: "on" });
    const before = await shareColumns(f.db, f.meetingId);
    const cases: Array<[unknown, string]> = [
      ["{", "invalid_body"],
      [[], "invalid_body"],
      [{}, "nothing_to_update"],
      [{ includeTranscript: "yes" }, "invalid_include_transcript"],
      [{ link: "maybe" }, "invalid_link"],
      [{ enable: "true" }, "invalid_link"],
      [{ expiresInDays: 3 }, "invalid_expiry"],
      [{ expiresInDays: null }, "invalid_expiry"],
      [{ link: "off", expiresInDays: 7 }, "invalid_expiry"],
      [{ includeTranscript: true, expiresInDays: 2 }, "invalid_expiry"],
    ];
    for (const [body, code] of cases) {
      const result = await call(f, "POST", body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(result.body.code, code, JSON.stringify(body));
      assert.equal(typeof result.body.error, "string");
    }
    assert.equal((await call(f, "PUT", {})).status, 405);
    assert.deepEqual(await shareColumns(f.db, f.meetingId), before);
    // A string day count from a form select is accepted.
    assert.equal((await call(f, "POST", { expiresInDays: "30" })).status, 200);
  } finally {
    await f.close();
  }
});

test("callers who may not manage the meeting get 404 on every method and nothing changes", async () => {
  const f = await fixture();
  try {
    const before = await shareColumns(f.db, f.meetingId);
    for (const [method, body] of [["GET", undefined], ["POST", { link: "on" }], ["POST", { includeTranscript: true }], ["POST", { link: "off" }]] as const) {
      const result = await call(f, method, body, null);
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, { error: "Meeting not found" });
    }
    assert.deepEqual(await shareColumns(f.db, f.meetingId), before);
    // A meeting id that does not exist is also 404, never a write.
    assert.equal((await call(f, "POST", { link: "on" }, randomUUID())).status, 404);
  } finally {
    await f.close();
  }
});

test("a no-op change does not write the meeting", async () => {
  const f = await fixture();
  try {
    const before = await shareColumns(f.db, f.meetingId);
    assert.equal((await call(f, "POST", { includeTranscript: false })).status, 200);
    assert.equal((await call(f, "POST", { link: "off" })).status, 200);
    assert.deepEqual(await shareColumns(f.db, f.meetingId), before);
    await call(f, "POST", { link: "on" });
    const on = await shareColumns(f.db, f.meetingId);
    assert.equal((await call(f, "POST", { enable: true })).status, 200);
    assert.deepEqual(await shareColumns(f.db, f.meetingId), on);
  } finally {
    await f.close();
  }
});

test("a meeting the v2 sync engine owns reports a clear conflict instead of a server error", async () => {
  const f = await fixture();
  try {
    const library = randomUUID();
    await f.db.execute(sql`insert into sync_libraries(id,organization_id) values(${library}::uuid,'team-org')`);
    await f.db.execute(sql`insert into sync_notes(id,library_id,organization_id) values(${f.meetingId}::uuid,${library}::uuid,'team-org')`);
    const result = await call(f, "POST", { includeTranscript: true });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "sync_upgrade_required");
    assert.equal((await call(f, "GET")).status, 200);
    assert.equal((await readMeetingShareState(f.db, { meetingId: f.meetingId, origin: ORIGIN }))?.includeTranscript, false);
  } finally {
    await f.close();
  }
});
