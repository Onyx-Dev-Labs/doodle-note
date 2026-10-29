import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { downloadLeadEvents, downloadLeadLinks, eq, sql, subscriptions, user } from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import { createConnectPostHandler } from "../app/api/download-leads/connect/route";
import { POST as lookupRoute } from "../app/api/integrations/download-leads/lookup/route";
import { POST as claimRoute } from "../app/api/integrations/download-leads/claim/route";
import {
  createDownloadLeadLinkToken,
  DOWNLOAD_LEAD_LINK_TTL_SECONDS,
  downloadLeadLinkState,
  linkDownloadLead,
  verifyDownloadLeadLinkToken,
} from "../lib/download-lead-link";
import {
  acknowledgeDownloadEvents,
  claimDownloadEvents,
  lookupDownloadLeads,
  recordDownloadRequest,
  type ClaimedDownloadLinkedEvent,
  type ClaimedDownloadRequestEvent,
} from "../lib/download-leads";

const SECRET = "fixture-better-auth-secret";
const SYNC_SECRET = "fixture-sync-secret";
const T0 = new Date("2026-10-29T15:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let mem: InMemoryDb;

before(async () => {
  process.env.BETTER_AUTH_SECRET = SECRET;
  process.env.DOWNLOAD_LEADS_SYNC_SECRET = SYNC_SECRET;
  mem = await createInMemoryDb();
  (globalThis as { __repoDbClient?: unknown }).__repoDbClient = mem.db;
});

after(async () => {
  delete (globalThis as { __repoDbClient?: unknown }).__repoDbClient;
  delete process.env.DOWNLOAD_LEADS_SYNC_SECRET;
  await mem.close();
});

beforeEach(async () => {
  await mem.db.execute(sql`truncate download_leads, subscriptions, "user" cascade`);
});

async function account(id: string, email: string, subscription?: { stripeCustomerId: string; status: string }) {
  await mem.db.insert(user).values({ id, name: id, email, emailVerified: true, createdAt: T0, updatedAt: T0 });
  if (subscription) await mem.db.insert(subscriptions).values({ userId: id, ...subscription });
}

async function download(email: string, now = T0) {
  return recordDownloadRequest({ email, platform: "mac", marketingConsent: true, now }, mem.db);
}

function tokenFor(lead: { leadId: string }, email: string, now = T0) {
  return createDownloadLeadLinkToken({ leadId: lead.leadId, email }, now.getTime(), SECRET);
}

async function linkedEvents() {
  return mem.db
    .select()
    .from(downloadLeadEvents)
    .where(eq(downloadLeadEvents.eventType, "download_lead_linked"));
}

describe("download lead link token", () => {
  it("proves the address it was issued for, and nothing else", () => {
    const lead = { leadId: "c94e20f8-901f-4c10-9b6c-a499f57a34e0", email: "alex@example.com" };
    const token = createDownloadLeadLinkToken(lead, T0.getTime(), SECRET);
    assert.ok(!token.includes("alex"), "the address is signed, not carried");
    assert.equal(verifyDownloadLeadLinkToken(token, lead.email, T0.getTime(), SECRET), lead.leadId);
    assert.equal(verifyDownloadLeadLinkToken(token, "other@example.com", T0.getTime(), SECRET), null);
    assert.equal(verifyDownloadLeadLinkToken(token, lead.email, T0.getTime(), "another-secret"), null);
    const forged = token.replace(lead.leadId, "7b9f5d74-6b18-4c38-8451-ad51f0bdf98f");
    assert.equal(verifyDownloadLeadLinkToken(forged, lead.email, T0.getTime(), SECRET), null);
    const expiry = T0.getTime() + DOWNLOAD_LEAD_LINK_TTL_SECONDS * 1000;
    assert.equal(verifyDownloadLeadLinkToken(token, lead.email, expiry - 1000, SECRET), lead.leadId);
    assert.equal(verifyDownloadLeadLinkToken(token, lead.email, expiry, SECRET), null);
    assert.equal(verifyDownloadLeadLinkToken("v1.nope", lead.email, T0.getTime(), SECRET), null);
  });
});

describe("linking a download lead to an account", () => {
  it("links a different download address once both identities are proven, and queues one event", async () => {
    await account("jordan", "jordan@work.example", { stripeCustomerId: "cus_Jordan", status: "active" });
    const lead = await download("jordan.personal@example.com");
    const token = tokenFor(lead, "jordan.personal@example.com");

    assert.equal((await downloadLeadLinkState(token, "jordan", { now: at(1) }, mem.db)).kind, "ready");
    const first = await linkDownloadLead({ token, userId: "jordan", now: at(1) }, mem.db);
    assert.deepEqual(first, { kind: "linked", leadId: lead.leadId, email: "jordan.personal@example.com", created: true });
    const again = await linkDownloadLead({ token, userId: "jordan", now: at(2) }, mem.db);
    assert.equal(again.kind === "linked" && again.created, false, "confirming twice is a no-op");

    const links = await mem.db.select().from(downloadLeadLinks);
    assert.equal(links.length, 1);
    assert.equal(links[0].userId, "jordan");
    assert.equal(links[0].method, "email_confirmation");
    assert.equal(links[0].verifiedAt.toISOString(), at(1).toISOString());
    const events = await linkedEvents();
    assert.equal(events.length, 1, "exactly one linked event per link");
    assert.equal(events[0].platform, null);
    assert.equal(events[0].syncStatus, "pending");
  });

  it("never links from a session alone or from a link for another address", async () => {
    await account("jordan", "jordan@work.example");
    const lead = await download("alex@example.com");
    for (const token of [undefined, "", "v1.garbage", tokenFor(lead, "jordan@work.example")]) {
      assert.deepEqual(await linkDownloadLead({ token, userId: "jordan", now: at(1) }, mem.db), { kind: "invalid" });
    }
    const expired = tokenFor(lead, "alex@example.com", new Date(T0.getTime() - DOWNLOAD_LEAD_LINK_TTL_SECONDS * 1000));
    assert.deepEqual(await linkDownloadLead({ token: expired, userId: "jordan", now: at(1) }, mem.db), { kind: "invalid" });
    assert.equal((await mem.db.select().from(downloadLeadLinks)).length, 0);
    assert.equal((await linkedEvents()).length, 0);
  });

  it("keeps the first link, and refuses an address that belongs to another account", async () => {
    await account("jordan", "jordan@work.example");
    await account("sam", "sam@example.com");
    await account("alex", "alex@example.com");
    const lead = await download("shared@example.com");
    const token = tokenFor(lead, "shared@example.com");
    await linkDownloadLead({ token, userId: "jordan", now: at(1) }, mem.db);
    assert.deepEqual(await linkDownloadLead({ token, userId: "sam", now: at(2) }, mem.db), {
      kind: "linked_to_other_account",
      email: "shared@example.com",
    });

    const owned = await download("alex@example.com");
    assert.deepEqual(
      await linkDownloadLead({ token: tokenFor(owned, "alex@example.com"), userId: "jordan", now: at(3) }, mem.db),
      { kind: "email_owned_by_other_account", email: "alex@example.com" },
      "an account's own address is linked by signing in to that account",
    );
    const self = await linkDownloadLead({ token: tokenFor(owned, "alex@example.com"), userId: "alex", now: at(4) }, mem.db);
    assert.equal(self.kind, "linked", "the same-address owner may confirm it too");
    assert.equal((await linkedEvents()).length, 2);
  });
});

describe("connect endpoint", () => {
  function post(body: unknown, origin = "https://www.doodlenote.ai") {
    return new Request("https://www.doodlenote.ai/api/download-leads/connect", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  }

  it("needs a session, the site's own origin, and a valid email link", async () => {
    await account("jordan", "jordan@work.example");
    const lead = await download("jordan.personal@example.com");
    const token = tokenFor(lead, "jordan.personal@example.com");
    const link = (input: { token: unknown; userId: string }) => linkDownloadLead({ ...input, now: at(1) }, mem.db);

    const signedOut = createConnectPostHandler({ currentUserId: async () => null, link });
    assert.equal((await signedOut(post({ token }))).status, 401);
    const handler = createConnectPostHandler({ currentUserId: async () => "jordan", link });
    assert.equal((await handler(post({ token }, "https://evil.example"))).status, 403);
    assert.equal((await handler(post({ token: "v1.bad" }))).status, 400);
    assert.equal((await mem.db.select().from(downloadLeadLinks)).length, 0);

    const ok = await handler(post({ token }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, email: "jordan.personal@example.com", created: true });
    const other = createConnectPostHandler({ currentUserId: async () => "sam", link });
    await account("sam", "sam@example.com");
    assert.equal((await other(post({ token }))).status, 409);
  });
});

describe("linked events and lookup for n8n", () => {
  it("hands out linked events only when asked, after the lead's download is synced", async () => {
    await account("jordan", "jordan@work.example", { stripeCustomerId: "cus_Jordan", status: "trialing" });
    const lead = await download("jordan.personal@example.com");
    await linkDownloadLead({ token: tokenFor(lead, "jordan.personal@example.com"), userId: "jordan", now: at(1) }, mem.db);

    assert.deepEqual(
      await claimDownloadEvents({ now: at(2), eventTypes: ["download_lead_linked"], secret: SECRET }, mem.db),
      [],
      "waits for the earlier download event",
    );
    const [downloadEvent] = (await claimDownloadEvents({ now: at(2), secret: SECRET }, mem.db)) as ClaimedDownloadRequestEvent[];
    assert.equal(downloadEvent.eventType, "free_download_requested", "the default claim never returns linked events");
    assert.match(downloadEvent.accountLinkUrl, /^https:\/\/www\.doodlenote\.ai\/download\/connect\?token=v1\./);
    const token = new URL(downloadEvent.accountLinkUrl).searchParams.get("token");
    assert.equal(verifyDownloadLeadLinkToken(token, "jordan.personal@example.com", at(2).getTime(), SECRET), lead.leadId);
    await acknowledgeDownloadEvents(
      [{ eventId: downloadEvent.eventId, claimToken: downloadEvent.claimToken, result: "synced", outcome: "created_free_download" }],
      { now: at(3) },
      mem.db,
    );

    const [linked] = (await claimDownloadEvents(
      { now: at(4), eventTypes: ["download_lead_linked"] },
      mem.db,
    )) as ClaimedDownloadLinkedEvent[];
    assert.equal(linked.eventType, "download_lead_linked");
    assert.equal(linked.email, "jordan.personal@example.com");
    assert.equal(linked.account.exists, false, "no account uses the download address itself");
    assert.deepEqual(linked.link, {
      userId: "jordan",
      accountEmail: "jordan@work.example",
      stripeCustomerId: "cus_Jordan",
      cloudSyncStatus: "trialing",
      method: "email_confirmation",
      verifiedAt: at(1).toISOString(),
    });
    assert.ok(!("accountLinkUrl" in linked));
  });

  it("looks up both directions: download address to account, and account to its download addresses", async () => {
    await account("jordan", "jordan@work.example", { stripeCustomerId: "cus_Jordan", status: "active" });
    const lead = await download("jordan.personal@example.com");
    await download("solo@example.com");
    await linkDownloadLead({ token: tokenFor(lead, "jordan.personal@example.com"), userId: "jordan", now: at(1) }, mem.db);

    const [personal, work, solo, nobody, invalid] = await lookupDownloadLeads(
      [" Jordan.Personal@Example.com", "jordan@work.example", "solo@example.com", "nobody@example.com", "not-an-email"],
      { now: at(2), secret: SECRET },
      mem.db,
    );
    assert.equal(personal.email, "jordan.personal@example.com");
    assert.equal(personal.lead?.leadId, lead.leadId);
    assert.equal(personal.lead?.link?.userId, "jordan");
    assert.equal(personal.lead?.link?.stripeCustomerId, "cus_Jordan");
    assert.equal(personal.account.exists, false);

    assert.equal(work.lead, null);
    assert.deepEqual(work.account, { exists: true, userId: "jordan", stripeCustomerId: "cus_Jordan", cloudSyncStatus: "active" });
    assert.deepEqual(work.linkedDownloadEmails, [
      { leadId: lead.leadId, email: "jordan.personal@example.com", verifiedAt: at(1).toISOString() },
    ]);

    assert.equal(solo.lead?.link, null);
    assert.match(solo.lead!.accountLinkUrl, /\/download\/connect\?token=/);
    assert.deepEqual(nobody, {
      email: "nobody@example.com",
      valid: true,
      lead: null,
      account: { exists: false, userId: null, stripeCustomerId: null, cloudSyncStatus: null },
      linkedDownloadEmails: [],
    });
    assert.equal(invalid.valid, false);
  });

  it("guards the endpoints with the sync secret and validates their input", async () => {
    const call = (route: (request: Request) => Promise<Response>, path: string, body: unknown, bearer = SYNC_SECRET) =>
      route(
        new Request(`https://www.doodlenote.ai/api/integrations/download-leads/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          body: JSON.stringify(body),
        }),
      );
    assert.equal((await call(lookupRoute, "lookup", { emails: ["a@example.com"] }, "wrong")).status, 401);
    assert.equal((await call(lookupRoute, "lookup", { emails: [] })).status, 400);
    assert.equal((await call(lookupRoute, "lookup", { emails: Array(101).fill("a@example.com") })).status, 400);
    const lookup = await call(lookupRoute, "lookup", { emails: ["a@example.com"] });
    assert.equal(lookup.status, 200);
    assert.equal(((await lookup.json()) as { results: unknown[] }).results.length, 1);

    assert.equal((await call(claimRoute, "claim", { eventTypes: ["bogus"] })).status, 400);
    assert.equal((await call(claimRoute, "claim", { eventTypes: [] })).status, 400);
    assert.equal((await call(claimRoute, "claim", { eventTypes: ["download_lead_linked"] })).status, 200);
  });
});
