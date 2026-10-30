import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { downloadLeadEvents, downloadLeads, eq, sql, subscriptions, user } from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import { createDownloadLeadPostHandler } from "../app/api/download-leads/route";
import { GET as downloadRedirect } from "../app/download/[platform]/route";
import { POST as claimRoute } from "../app/api/integrations/download-leads/claim/route";
import { POST as ackRoute } from "../app/api/integrations/download-leads/ack/route";
import { MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION } from "../lib/download-consent";
import { createDownloadGrant, verifyDownloadGrant } from "../lib/download-grant";
import {
  acknowledgeDownloadEvents,
  CLAIM_LEASE_MS,
  claimDownloadEvents,
  normalizeLeadEmail,
  recordDownloadRequest,
  retryDelayMs,
  type ClaimedDownloadRequestEvent,
} from "../lib/download-leads";

const T0 = new Date("2026-10-29T15:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let mem: InMemoryDb;

before(async () => {
  process.env.BETTER_AUTH_SECRET = "fixture-better-auth-secret";
  mem = await createInMemoryDb();
});

after(async () => {
  await mem.close();
});

beforeEach(async () => {
  await mem.db.execute(sql`truncate download_leads, subscriptions, "user" cascade`);
});

async function events(email: string) {
  const [lead] = await mem.db.select().from(downloadLeads).where(eq(downloadLeads.email, email));
  if (!lead) return [];
  return mem.db
    .select()
    .from(downloadLeadEvents)
    .where(eq(downloadLeadEvents.leadId, lead.id))
    .orderBy(downloadLeadEvents.createdAt);
}

describe("download lead storage", () => {
  it("normalizes email and rejects implausible addresses", () => {
    assert.equal(normalizeLeadEmail("  Ada@Example.COM "), "ada@example.com");
    assert.equal(normalizeLeadEmail("not-an-email"), null);
    assert.equal(normalizeLeadEmail(`${"a".repeat(250)}@x.io`), null);
  });

  it("stores a new lead and a pending sync event in one write", async () => {
    const recorded = await recordDownloadRequest(
      { email: "ada@example.com", platform: "mac", marketingConsent: true, now: T0 },
      mem.db,
    );

    assert.equal(recorded.newLead, true);
    assert.ok(recorded.eventId);
    const [lead] = await mem.db.select().from(downloadLeads);
    assert.equal(lead.email, "ada@example.com");
    assert.equal(lead.source, "website_download");
    assert.equal(lead.firstPlatform, "mac");
    assert.equal(lead.latestPlatform, "mac");
    assert.equal(lead.firstRequestedAt.toISOString(), T0.toISOString());
    assert.equal(lead.latestRequestedAt.toISOString(), T0.toISOString());
    assert.equal(lead.marketingConsent, true);
    assert.equal(lead.marketingConsentAt?.toISOString(), T0.toISOString());
    assert.equal(lead.marketingConsentVersion, MARKETING_CONSENT_VERSION);
    assert.equal(lead.marketingConsentText, MARKETING_CONSENT_TEXT);

    const [event] = await events("ada@example.com");
    assert.equal(event.id, recorded.eventId);
    assert.equal(event.eventType, "free_download_requested");
    assert.equal(event.platform, "mac");
    assert.equal(event.syncStatus, "pending");
    assert.equal(event.attempts, 0);
  });

  it("deduplicates repeats without resetting first-download or consent history", async () => {
    await recordDownloadRequest({ email: "ada@example.com", platform: "mac", marketingConsent: true, now: T0 }, mem.db);
    const repeat = await recordDownloadRequest(
      { email: "ada@example.com", platform: "mac", marketingConsent: true, now: at(5) },
      mem.db,
    );
    const otherPlatform = await recordDownloadRequest(
      { email: "ADA@example.com ".trim().toLowerCase(), platform: "win", marketingConsent: false, now: at(10) },
      mem.db,
    );

    assert.equal(repeat.newLead, false);
    assert.equal(repeat.eventId, null, "same lead, platform and day collapses into one event");
    assert.ok(otherPlatform.eventId);
    const leads = await mem.db.select().from(downloadLeads);
    assert.equal(leads.length, 1);
    assert.equal(leads[0].requestCount, 3);
    assert.equal(leads[0].firstPlatform, "mac");
    assert.equal(leads[0].latestPlatform, "win");
    assert.equal(leads[0].firstRequestedAt.toISOString(), T0.toISOString());
    assert.equal(leads[0].latestRequestedAt.toISOString(), at(10).toISOString());
    assert.equal(leads[0].marketingConsent, true, "an unticked box later does not withdraw permission");
    assert.equal(leads[0].marketingConsentAt?.toISOString(), T0.toISOString());
    assert.equal((await events("ada@example.com")).length, 2);
  });

  it("records leads without permission but never queues them for MailCheap", async () => {
    await recordDownloadRequest({ email: "sam@example.com", platform: "win", marketingConsent: false, now: T0 }, mem.db);
    let [event] = await events("sam@example.com");
    assert.equal(event.syncStatus, "skipped");
    assert.equal(event.syncOutcome, "no_marketing_permission");
    assert.deepEqual(await claimDownloadEvents({ now: at(1) }, mem.db), []);

    await recordDownloadRequest({ email: "sam@example.com", platform: "win", marketingConsent: true, now: at(2) }, mem.db);
    const all = await events("sam@example.com");
    assert.equal(all.length, 2, "granting permission the same day still queues a sync");
    [, event] = all;
    assert.equal(event.syncStatus, "pending");
  });
});

describe("download event claims and acknowledgements", () => {
  it("leases one event per lead and marks account-owned addresses ineligible", async () => {
    await mem.db.insert(user).values([
      { id: "paying-user", name: "Paying", email: "paying@example.com", emailVerified: true, createdAt: T0, updatedAt: T0 },
      { id: "signed-up-user", name: "Signed Up", email: "Signed-Up@example.com", emailVerified: true, createdAt: T0, updatedAt: T0 },
    ]);
    await mem.db
      .insert(subscriptions)
      .values({ userId: "paying-user", stripeCustomerId: "cus_TestPaying", status: "active" });
    await recordDownloadRequest({ email: "paying@example.com", platform: "mac", marketingConsent: true, now: T0 }, mem.db);
    await recordDownloadRequest({ email: "signed-up@example.com", platform: "win", marketingConsent: true, now: T0 }, mem.db);
    await recordDownloadRequest({ email: "new@example.com", platform: "mac", marketingConsent: true, now: T0 }, mem.db);
    await recordDownloadRequest({ email: "new@example.com", platform: "win", marketingConsent: true, now: at(1) }, mem.db);

    const claimed = (await claimDownloadEvents({ now: at(2) }, mem.db)) as ClaimedDownloadRequestEvent[];
    assert.equal(claimed.length, 3, "the second event of new@ waits for the first");
    const paying = claimed.find((event) => event.email === "paying@example.com")!;
    const signedUp = claimed.find((event) => event.email === "signed-up@example.com")!;
    const lead = claimed.find((event) => event.email === "new@example.com")!;
    assert.deepEqual(paying.account, {
      exists: true,
      userId: "paying-user",
      stripeCustomerId: "cus_TestPaying",
      cloudSyncStatus: "active",
    });
    assert.equal(paying.freeDownloadLifecycleEligible, false);
    assert.deepEqual(
      signedUp.account,
      { exists: true, userId: "signed-up-user", stripeCustomerId: null, cloudSyncStatus: "none" },
      "an account that never started checkout matches by normalized email",
    );
    assert.equal(signedUp.freeDownloadLifecycleEligible, false);
    assert.deepEqual(lead.account, { exists: false, userId: null, stripeCustomerId: null, cloudSyncStatus: null });
    assert.equal(lead.freeDownloadLifecycleEligible, true);
    assert.equal(lead.platform, "mac");
    assert.equal(lead.source, "website_download");
    assert.equal(lead.marketingConsent.version, MARKETING_CONSENT_VERSION);
    assert.equal(lead.attempt, 1);

    assert.deepEqual(await claimDownloadEvents({ now: at(3) }, mem.db), [], "held leases are not handed out again");
    const expired = await claimDownloadEvents({ now: new Date(at(2).getTime() + CLAIM_LEASE_MS + 1) }, mem.db);
    assert.equal(expired.length, 3, "an abandoned lease is claimed again");
    assert.equal(expired.find((event) => event.email === "new@example.com")!.attempt, 2);
  });

  it("only the current claim can acknowledge, and retries back off", async () => {
    const { eventId } = await recordDownloadRequest(
      { email: "ada@example.com", platform: "mac", marketingConsent: true, now: T0 },
      mem.db,
    );
    const [first] = await claimDownloadEvents({ now: at(1) }, mem.db);
    const stale = await acknowledgeDownloadEvents(
      [{ eventId: eventId!, claimToken: "00000000-0000-4000-8000-000000000000", result: "synced", outcome: "created_free_download" }],
      { now: at(2) },
      mem.db,
    );
    assert.deepEqual(stale, { acknowledged: [], stale: [eventId] });

    await acknowledgeDownloadEvents(
      [{ eventId: eventId!, claimToken: first.claimToken, result: "retry", error: "MailCheap answered 503" }],
      { now: at(2) },
      mem.db,
    );
    let [event] = await events("ada@example.com");
    assert.equal(event.syncStatus, "pending");
    assert.equal(event.lastError, "MailCheap answered 503");
    assert.equal(event.claimToken, null);
    assert.equal(event.nextAttemptAt.getTime(), at(2).getTime() + retryDelayMs(1));
    assert.deepEqual(await claimDownloadEvents({ now: at(4) }, mem.db), [], "not before the backoff");

    const [second] = await claimDownloadEvents({ now: at(8) }, mem.db);
    assert.equal(second.attempt, 2);
    await acknowledgeDownloadEvents(
      [{ eventId: eventId!, claimToken: second.claimToken, result: "synced", outcome: "created_free_download", mailcheapContactId: "mc_1" }],
      { now: at(9) },
      mem.db,
    );
    [event] = await events("ada@example.com");
    assert.equal(event.syncStatus, "synced");
    assert.equal(event.syncOutcome, "created_free_download");
    assert.equal(event.mailcheapContactId, "mc_1");
    assert.equal(event.lastError, null);
    assert.deepEqual(
      await acknowledgeDownloadEvents(
        [{ eventId: eventId!, claimToken: second.claimToken, result: "retry", error: "late duplicate" }],
        { now: at(10) },
        mem.db,
      ),
      { acknowledged: [], stale: [eventId] },
      "a synced event cannot be reopened",
    );
  });

  it("caps the retry delay", () => {
    assert.equal(retryDelayMs(1), 5 * 60_000);
    assert.equal(retryDelayMs(3), 20 * 60_000);
    assert.equal(retryDelayMs(30), 6 * 60 * 60_000);
  });
});

describe("download form endpoint", () => {
  function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://www.doodlenote.ai/api/download-leads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.doodlenote.ai",
        "x-forwarded-for": "203.0.113.7",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it("stores the request before releasing the chosen installer", async () => {
    const recorded: unknown[] = [];
    const handler = createDownloadLeadPostHandler({
      now: () => T0.getTime(),
      allowRequest: () => true,
      record: async (request) => {
        recorded.push(request);
        return recordDownloadRequest(request, mem.db);
      },
    });
    const response = await handler(post({ email: " Ada@Example.com ", platform: "win", marketingConsent: true }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, downloadUrl: "/download/win" });
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^dn_download_grant=v1\.[^;]+; Path=\/download; Max-Age=1800; HttpOnly; SameSite=Lax; Secure$/);
    assert.deepEqual(recorded, [{ email: "ada@example.com", platform: "win", marketingConsent: true, now: T0 }]);
    assert.equal((await events("ada@example.com"))[0].platform, "win");
  });

  it("withholds the installer when the request can't be stored", async () => {
    const handler = createDownloadLeadPostHandler({
      allowRequest: () => true,
      record: async () => {
        throw new Error("database unavailable");
      },
    });
    const response = await handler(post({ email: "ada@example.com", platform: "mac", marketingConsent: true }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("rejects invalid, unconsented, cross-site, and bot submissions without a grant", async () => {
    const record = async () => {
      throw new Error("must not store");
    };
    const handler = createDownloadLeadPostHandler({ allowRequest: () => true, record });
    const invalid = await handler(post({ email: "nope", platform: "mac", marketingConsent: true }));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Enter a valid email address." });
    for (const marketingConsent of [undefined, false, "on"]) {
      const unconsented = await handler(post({ email: "ada@example.com", platform: "mac", marketingConsent }));
      assert.equal(unconsented.status, 400);
      assert.deepEqual(await unconsented.json(), {
        error: "Tick the box to agree to DoodleNote emails before downloading.",
      });
      assert.equal(unconsented.headers.get("set-cookie"), null);
    }
    assert.equal((await handler(post({ email: "ada@example.com", platform: "linux", marketingConsent: true }))).status, 400);
    assert.equal(
      (await handler(post({ email: "ada@example.com", platform: "mac", marketingConsent: true }, { origin: "https://evil.example" }))).status,
      403,
    );
    const bot = await handler(post({ email: "ada@example.com", platform: "mac", website: "spam" }));
    assert.equal(bot.status, 200);
    assert.equal(bot.headers.get("set-cookie"), null);
    const limited = createDownloadLeadPostHandler({ allowRequest: () => false, record });
    assert.equal((await limited(post({ email: "ada@example.com", platform: "mac", marketingConsent: true }))).status, 429);
  });
});

describe("gated installer redirect", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function download(platform: string, cookie?: string) {
    return downloadRedirect(
      new Request(`https://www.doodlenote.ai/download/${platform}`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ platform }) },
    );
  }

  it("sends visitors without a grant to the form, keeping the platform", async () => {
    const response = await download("win");
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://www.doodlenote.ai/download?platform=win");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("redirects a granted visitor to the current installer", async () => {
    globalThis.fetch = (async () => new Response("version: 0.4.35\n")) as typeof fetch;
    const response = await download("mac", `other=1; dn_download_grant=${createDownloadGrant()}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://www.doodlenote.ai/updates/DoodleNote-0.4.35-arm64.dmg");
  });

  it("rejects expired, forged, and unknown-platform requests", async () => {
    const expired = createDownloadGrant(Date.now() - 31 * 60_000);
    assert.equal(verifyDownloadGrant(expired), false);
    assert.equal(verifyDownloadGrant(createDownloadGrant(Date.now(), "another-secret")), false);
    assert.equal((await download("mac", `dn_download_grant=${expired}`)).status, 307);
    assert.equal((await download("linux", `dn_download_grant=${createDownloadGrant()}`)).status, 404);
  });
});

describe("n8n sync endpoints", () => {
  afterEach(() => {
    delete process.env.DOWNLOAD_LEADS_SYNC_SECRET;
  });

  const call = (route: (request: Request) => Promise<Response>, path: string, authorization?: string) =>
    route(
      new Request(`https://www.doodlenote.ai/api/integrations/download-leads/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization && { authorization }) },
        body: JSON.stringify(path === "ack" ? { results: [] } : { limit: 5 }),
      }),
    );

  it("fail closed without the secret and reject wrong bearers", async () => {
    assert.equal((await call(claimRoute, "claim", "Bearer anything")).status, 503);
    assert.equal((await call(ackRoute, "ack", "Bearer anything")).status, 503);
    process.env.DOWNLOAD_LEADS_SYNC_SECRET = "fixture-sync-secret";
    assert.equal((await call(claimRoute, "claim")).status, 401);
    assert.equal((await call(ackRoute, "ack", "Bearer wrong")).status, 401);
    assert.equal((await call(ackRoute, "ack", "Bearer fixture-sync-secret")).status, 400, "an empty result list is refused");
  });
});
