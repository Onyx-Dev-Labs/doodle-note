/**
 * End to end: website form -> Neon (PGlite here) -> n8n workflow -> MailCheap.
 *
 * Runs the generated n8n workflow JSON itself: its Code nodes and HTTP node
 * expressions execute as written, against the real claim/ack route handlers
 * and a MailCheap fake whose contact rules follow MailCheap's
 * lib/actions/contacts.js and lib/contacts.js (upsertContact,
 * fillMissingProfile, updateContactDetails, tag_contacts). It does not
 * exercise a live n8n or MailCheap instance.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";

import { downloadLeadEvents, downloadLeads, sql, subscriptions, user } from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

type Json = Record<string, unknown>;
type Node = {
  name: string;
  type: string;
  parameters: Json;
  credentials?: { httpHeaderAuth: { name: string } };
};

const SYNC_SECRET = "fixture-download-sync-secret";
const MAILCHEAP_KEY = "fixture-mailcheap-key";
const WORKFLOW_PATH = new URL("../integrations/n8n/download-lead-sync.workflow.json", import.meta.url);

let mem: InMemoryDb;
let routes: {
  claim: (request: Request) => Promise<Response>;
  ack: (request: Request) => Promise<Response>;
  submit: (request: Request) => Promise<Response>;
  download: (request: Request, context: { params: Promise<{ platform: string }> }) => Promise<Response>;
};

/** MailCheap's contact API, reduced to the rules the sync depends on. */
class FakeMailCheap {
  contacts = new Map<string, Json & { id: string; email: string; status: string; fields: Json; tags: string[] }>();
  /** Addresses MailCheap keeps blocked even without a contact (deleted after unsubscribing, bounced). */
  suppressed = new Map<string, string>();
  fields = new Set(["doodlenote_lifecycle", "doodlenote_first_download", "doodlenote_download_platform", "doodlenote_sequence_step"]);
  welcomeEnabled = true;
  welcomeEmails = 0;
  outage: "network" | 503 | null = null;
  /** Runs just before POST /contacts, to stage a contact appearing after the sync's lookup. */
  beforeCreate: ((email: string) => void) | null = null;
  calls: string[] = [];
  private nextId = 1;

  private view(contact: Json) {
    return { ...contact, fields: { ...(contact.fields as Json) }, tags: [...(contact.tags as string[])] };
  }

  private error(status: number, code: string, message: string) {
    return Response.json({ error: { code, message } }, { status });
  }

  private find(ref: string) {
    const value = decodeURIComponent(ref).toLowerCase();
    return [...this.contacts.values()].find((contact) => contact.id === value || contact.email === value);
  }

  private badField(fields: Json = {}) {
    return Object.keys(fields).find((key) => !this.fields.has(key));
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.calls.push(`${request.method} ${url.pathname}`);
    if (this.outage === "network") throw new TypeError("fetch failed: ECONNREFUSED");
    if (this.outage === 503) return this.error(503, "unavailable", "Service unavailable");
    if (request.headers.get("authorization") !== `Bearer ${MAILCHEAP_KEY}`) {
      return this.error(401, "unauthorized", "Send a valid API key");
    }
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = request.method === "GET" ? {} : ((await request.json()) as Json);

    if (request.method === "GET" && path.startsWith("/contacts/")) {
      const contact = this.find(path.slice("/contacts/".length));
      return contact ? Response.json(this.view(contact)) : this.error(404, "not_found", "Contact not found");
    }
    if (request.method === "POST" && path === "/contacts") {
      const email = String(body.email).toLowerCase();
      this.beforeCreate?.(email);
      if (email.endsWith("@gmial.com")) return this.error(400, "validation_failed", "email: did you mean gmail.com?");
      const bad = this.badField(body.fields as Json);
      if (bad) return this.error(400, "validation_failed", `fields.${bad}: no such field`);
      const existing = this.find(email);
      if (existing) {
        // fillMissingProfile: only empty fields, new tags; status stays unless resubscribe.
        for (const [key, value] of Object.entries((body.fields as Json) ?? {})) {
          if (existing.fields[key] === undefined) existing.fields[key] = value;
        }
        for (const tag of (body.tags as string[]) ?? []) if (!existing.tags.includes(tag)) existing.tags.push(tag);
        if (body.resubscribe === true && existing.status === "unsubscribed") existing.status = "active";
        return Response.json({ id: existing.id, email, status: existing.status, created: false });
      }
      const contact = {
        id: `mc_${this.nextId++}`,
        email,
        status: this.suppressed.get(email) ?? "active",
        source: String(body.source),
        subscribedAt: new Date().toISOString(),
        fields: { ...((body.fields as Json) ?? {}) },
        tags: [...((body.tags as string[]) ?? [])],
      };
      this.contacts.set(email, contact);
      if (this.welcomeEnabled && contact.status === "active") this.welcomeEmails += 1;
      return Response.json({ id: contact.id, email, status: contact.status, created: true }, { status: 201 });
    }
    const details = /^\/contacts\/([^/]+)\/details$/.exec(path);
    if (request.method === "PATCH" && details) {
      const contact = this.find(details[1]);
      if (!contact) return this.error(404, "not_found", "Contact not found");
      const bad = this.badField(body.fields as Json);
      if (bad) return this.error(400, "validation_failed", `fields.${bad}: no such field`);
      Object.assign(contact.fields, body.fields ?? {});
      return Response.json(this.view(contact));
    }
    if (request.method === "POST" && path === "/contacts/tag") {
      const tags = body.tags as string[];
      if (!tags?.length) return this.error(400, "validation_failed", "tags: at least one");
      let changed = 0;
      for (const ref of body.contacts as string[]) {
        const contact = this.find(ref);
        const added = tags.filter((tag) => !contact?.tags.includes(tag));
        if (contact && added.length) {
          contact.tags.push(...added);
          changed += 1;
        }
      }
      return Response.json({ matched: (body.contacts as string[]).length, changed });
    }
    return this.error(404, "not_found", `No ${request.method} ${path}`);
  }

  count(method: string, path: string) {
    return this.calls.filter((call) => call === `${method} ${path}`).length;
  }
}

/**
 * Executes the workflow the way n8n does for this graph: Config, claim and
 * split run once; each event item then follows its route, with $('Node').item
 * resolving to that item's output of the named node.
 */
function createN8nRunner(mailcheap: FakeMailCheap, options: { ackOutage?: boolean } = {}) {
  const workflow = JSON.parse(readFileSync(WORKFLOW_PATH, "utf8")) as {
    nodes: Node[];
    connections: Record<string, { main: Array<Array<{ node: string }>> }>;
  };
  const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
  const credentials: Record<string, string> = {
    "DoodleNote download lead sync": `Bearer ${SYNC_SECRET}`,
    "MailCheap API": `Bearer ${MAILCHEAP_KEY}`,
  };

  async function send(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.host === "mailcheap.ai") return mailcheap.handle(request);
    if (url.pathname.endsWith("/claim")) return routes.claim(request);
    if (url.pathname.endsWith("/ack")) {
      if (options.ackOutage) throw new TypeError("fetch failed: DoodleNote unreachable");
      return routes.ack(request);
    }
    throw new Error(`Unexpected request ${request.url}`);
  }

  return async function run() {
    const once = new Map<string, Json>();
    const acks: Json[] = [];

    function scope(item: Map<string, Json>, current: Json) {
      const $ = (name: string) => ({
        item: { json: item.get(name) ?? once.get(name) },
        first: () => ({ json: once.get(name) ?? item.get(name) }),
      });
      return { $json: current, $, $input: { first: () => ({ json: current }) } };
    }

    function evaluate(template: unknown, context: ReturnType<typeof scope>): unknown {
      if (typeof template !== "string" || !template.startsWith("=")) return template;
      const expression = (code: string) =>
        new Function("$json", "$", "$input", `return (${code});`)(context.$json, context.$, context.$input);
      const whole = /^=\{\{([\s\S]+)\}\}$/.exec(template);
      if (whole && !whole[1].includes("}}")) return expression(whole[1]);
      return template.slice(1).replace(/\{\{([\s\S]+?)\}\}/g, (_, code) => String(expression(code)));
    }

    async function execute(node: Node, context: ReturnType<typeof scope>): Promise<Json | Json[]> {
      if (node.type === "n8n-nodes-base.code") {
        return new Function("$json", "$", "$input", node.parameters.jsCode as string)(
          context.$json,
          context.$,
          context.$input,
        );
      }
      if (node.type === "n8n-nodes-base.httpRequest") {
        const body = node.parameters.jsonBody ? String(evaluate(node.parameters.jsonBody, context)) : undefined;
        try {
          const response = await send(
            new Request(String(evaluate(node.parameters.url, context)), {
              method: String(node.parameters.method),
              headers: {
                authorization: credentials[node.credentials!.httpHeaderAuth.name],
                ...(body && { "content-type": "application/json" }),
              },
              body,
            }),
          );
          const text = await response.text();
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {}
          return { statusCode: response.status, body: parsed, headers: {} };
        } catch (error) {
          return { error: { message: (error as Error).message } }; // onError: continueRegularOutput
        }
      }
      throw new Error(`Unsupported node ${node.type}`);
    }

    const next = (name: string, output = 0) => workflow.connections[name]?.main[output]?.[0]?.node;

    // Trigger -> Config -> Claim -> Split events run once.
    for (const name of ["Config", "Claim download events"]) {
      const previous = name === "Config" ? {} : once.get("Config")!;
      const result = await execute(nodes.get(name)!, scope(new Map(), previous));
      once.set(name, Array.isArray(result) ? (result[0] as { json: Json }).json : result);
    }
    const split = (await execute(nodes.get("Split events")!, scope(new Map(), once.get("Claim download events")!))) as Array<{ json: Json }>;

    for (const { json: event } of split) {
      const item = new Map<string, Json>([["Split events", event]]);
      let current = event;
      let name: string | undefined = next("Split events");
      while (name) {
        const node = nodes.get(name)!;
        if (node.type === "n8n-nodes-base.switch") {
          const rules = (node.parameters.rules as { values: Array<{ conditions: { conditions: Array<{ rightValue: string }> } }> }).values;
          const index = rules.findIndex((rule) => current.action === rule.conditions.conditions[0].rightValue);
          name = next(name, index === -1 ? rules.length : index);
          continue;
        }
        const result = await execute(node, scope(item, current));
        current = (result as Json).json ? ((result as Json).json as Json) : (result as Json);
        item.set(name, current);
        if (name === "Report result to DoodleNote") acks.push((item.get("Check created contact") ?? item.get("Check updated contact") ?? item.get("Plan MailCheap change"))!.ack as Json);
        name = next(name);
      }
    }
    return { claimed: split.length, acks };
  };
}

async function submitDownload(email: string, platform: "mac" | "win", marketingConsent = true) {
  const response = await routes.submit(
    new Request("https://www.doodlenote.ai/api/download-leads", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.doodlenote.ai" },
      body: JSON.stringify({ email, platform, marketingConsent }),
    }),
  );
  assert.equal(response.status, 200, `download form accepted ${email}`);
  return response;
}

async function eventsFor(email: string) {
  return mem.db.execute(sql`
    select e.* from download_lead_events e join download_leads l on l.id = e.lead_id
    where l.email = ${email} order by e.created_at`).then((result) => result.rows as Json[]);
}

before(async () => {
  process.env.BETTER_AUTH_SECRET = "fixture-better-auth-secret";
  process.env.DOWNLOAD_LEADS_SYNC_SECRET = SYNC_SECRET;
  mem = await createInMemoryDb();
  (globalThis as { __repoDbClient?: unknown }).__repoDbClient = mem.db;
  const { createDownloadLeadPostHandler } = await import("../app/api/download-leads/route");
  routes = {
    claim: (await import("../app/api/integrations/download-leads/claim/route")).POST,
    ack: (await import("../app/api/integrations/download-leads/ack/route")).POST,
    submit: createDownloadLeadPostHandler({ allowRequest: () => true }),
    download: (await import("../app/download/[platform]/route")).GET,
  };
});

after(async () => {
  delete (globalThis as { __repoDbClient?: unknown }).__repoDbClient;
  await mem.close();
});

beforeEach(async () => {
  await mem.db.execute(sql`truncate download_leads, subscriptions, "user" cascade`);
});

describe("generated n8n workflow", () => {
  it("is up to date with the tested sync functions", () => {
    // Plain node, not tsx: the embedded Code node source must be byte-for-byte.
    const built = execFileSync(
      "node",
      [fileURLToPath(new URL("../scripts/build-download-lead-workflow.mjs", import.meta.url)), "--stdout"],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } },
    );
    assert.equal(readFileSync(WORKFLOW_PATH, "utf8"), built, "run node scripts/build-download-lead-workflow.mjs");
  });

  it("holds no credentials or secrets", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9]/);
    const nodes = (JSON.parse(text) as { nodes: Node[] }).nodes;
    for (const node of nodes.filter((candidate) => candidate.credentials)) {
      assert.deepEqual(Object.keys(node.credentials!.httpHeaderAuth).sort(), ["id", "name"]);
      assert.equal((node.credentials!.httpHeaderAuth as unknown as { id: string }).id, "");
    }
  });
});

describe("website download to MailCheap", () => {
  it("a new download reaches Neon, then MailCheap as free_download, and releases the installer", async () => {
    const mailcheap = new FakeMailCheap();
    const response = await submitDownload("New.Lead@Example.com", "mac");

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("version: 0.4.35\n")) as typeof fetch;
    try {
      const grant = response.headers.get("set-cookie")!.split(";")[0];
      const installer = await routes.download(
        new Request("https://www.doodlenote.ai/download/mac", { headers: { cookie: grant } }),
        { params: Promise.resolve({ platform: "mac" }) },
      );
      assert.equal(installer.status, 302);
      assert.equal(installer.headers.get("location"), "https://www.doodlenote.ai/updates/DoodleNote-0.4.35-arm64.dmg");
    } finally {
      globalThis.fetch = realFetch;
    }

    const [lead] = await mem.db.select().from(downloadLeads);
    assert.equal(lead.email, "new.lead@example.com");
    assert.equal((await eventsFor("new.lead@example.com"))[0].sync_status, "pending");

    const result = await createN8nRunner(mailcheap)();
    assert.equal(result.claimed, 1);
    assert.equal(result.acks[0].outcome, "created_free_download");

    const contact = mailcheap.contacts.get("new.lead@example.com")!;
    assert.equal(contact.status, "active");
    assert.equal(contact.source, "website_download");
    assert.equal(contact.fields.doodlenote_lifecycle, "free_download");
    assert.equal(contact.fields.doodlenote_first_download, lead.firstRequestedAt.toISOString().slice(0, 10));
    assert.equal(contact.fields.doodlenote_download_platform, "mac");
    assert.deepEqual(contact.tags, ["website-download", "download-mac"]);

    const [event] = await eventsFor("new.lead@example.com");
    assert.equal(event.sync_status, "synced");
    assert.equal(event.mailcheap_contact_id, contact.id);
    assert.equal((await createN8nRunner(mailcheap)()).claimed, 0, "nothing left to sync");
  });

  it("repeat downloads stay one contact and never restart its sequence", async () => {
    const mailcheap = new FakeMailCheap();
    await submitDownload("repeat@example.com", "mac");
    await createN8nRunner(mailcheap)();
    const contact = mailcheap.contacts.get("repeat@example.com")!;
    const { id, subscribedAt } = contact;
    contact.fields.doodlenote_sequence_step = 3; // the dispatcher has moved them along
    assert.equal(mailcheap.welcomeEmails, 1);

    await submitDownload("REPEAT@example.com", "mac");
    await submitDownload("repeat@example.com", "win");
    const second = await createN8nRunner(mailcheap)();

    assert.equal(second.claimed, 1, "the same-day mac repeat was deduplicated; win is new");
    assert.equal(second.acks[0].outcome, "updated_download_details");
    assert.equal(mailcheap.contacts.size, 1);
    assert.equal(mailcheap.count("POST", "/api/v1/contacts"), 1, "created exactly once");
    assert.equal(mailcheap.welcomeEmails, 1, "no second welcome email");
    const after = mailcheap.contacts.get("repeat@example.com")!;
    assert.equal(after.id, id);
    assert.equal(after.subscribedAt, subscribedAt);
    assert.equal(after.fields.doodlenote_lifecycle, "free_download");
    assert.equal(after.fields.doodlenote_sequence_step, 3);
    assert.equal(after.fields.doodlenote_download_platform, "mac", "first platform is kept");
    assert.deepEqual(after.tags, ["website-download", "download-mac", "download-win"]);
  });

  it("an existing paying customer stays classified as paying", async () => {
    const mailcheap = new FakeMailCheap();
    await mem.db.insert(user).values([
      { id: "paid-1", name: "Paid", email: "paid@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      { id: "trial-1", name: "Trial", email: "trial@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      { id: "trial-2", name: "Trial Too", email: "trial-new@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
    await mem.db.insert(subscriptions).values([
      { userId: "paid-1", status: "active" },
      { userId: "trial-1", status: "trialing" },
      { userId: "trial-2", status: "trialing" },
    ]);
    mailcheap.contacts.set("paid@example.com", {
      id: "mc_paid",
      email: "paid@example.com",
      status: "active",
      fields: { doodlenote_lifecycle: "paying_customer" },
      tags: ["customer"],
    });
    mailcheap.contacts.set("trial@example.com", {
      id: "mc_trial",
      email: "trial@example.com",
      status: "active",
      fields: { doodlenote_lifecycle: "trial_active" },
      tags: [],
    });

    await submitDownload("paid@example.com", "mac");
    await submitDownload("trial@example.com", "win");
    await submitDownload("trial-new@example.com", "mac");
    const result = await createN8nRunner(mailcheap)();

    assert.equal(result.claimed, 3);
    assert.equal(mailcheap.contacts.get("paid@example.com")!.fields.doodlenote_lifecycle, "paying_customer");
    assert.equal(mailcheap.contacts.get("trial@example.com")!.fields.doodlenote_lifecycle, "trial_active");
    const trial = mailcheap.contacts.get("trial-new@example.com")!;
    assert.equal(trial.fields.doodlenote_lifecycle, undefined, "an account holder is never labeled free_download");
    assert.equal(
      result.acks.find((ack) => ack.mailcheapContactId === trial.id)!.outcome,
      "created_without_lifecycle",
    );
  });

  it("a download lead who later pays is not pulled back to free_download by another download", async () => {
    const mailcheap = new FakeMailCheap();
    await submitDownload("convert@example.com", "mac");
    await createN8nRunner(mailcheap)();
    const contact = mailcheap.contacts.get("convert@example.com")!;
    assert.equal(contact.fields.doodlenote_lifecycle, "free_download");

    // They sign up and pay with the same email; the existing n8n automation
    // sees the paid Stripe invoice and moves the contact on.
    await mem.db.insert(user).values({
      id: "convert-1", name: "Convert", email: "convert@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
    await mem.db.insert(subscriptions).values({ userId: "convert-1", status: "active" });
    contact.fields.doodlenote_lifecycle = "paying_customer";

    await submitDownload("convert@example.com", "win");
    const again = await createN8nRunner(mailcheap)();
    assert.equal(again.claimed, 1);
    assert.equal(contact.fields.doodlenote_lifecycle, "paying_customer");
    assert.deepEqual(contact.tags, ["website-download", "download-mac", "download-win"]);
    assert.equal(mailcheap.contacts.size, 1);
  });

  it("an unsubscribed contact stays unsubscribed, and suppressed addresses stay blocked", async () => {
    const mailcheap = new FakeMailCheap();
    mailcheap.contacts.set("left@example.com", {
      id: "mc_left",
      email: "left@example.com",
      status: "unsubscribed",
      fields: {},
      tags: [],
    });
    mailcheap.suppressed.set("deleted@example.com", "unsubscribed");

    await submitDownload("left@example.com", "mac");
    await submitDownload("deleted@example.com", "win");
    const result = await createN8nRunner(mailcheap)();

    const left = mailcheap.contacts.get("left@example.com")!;
    assert.equal(left.status, "unsubscribed");
    assert.equal(left.fields.doodlenote_lifecycle, undefined, "not put into a sequence");
    assert.equal(mailcheap.contacts.get("deleted@example.com")!.status, "unsubscribed");
    assert.deepEqual(result.acks.map((ack) => ack.outcome).sort(), ["created_suppressed", "updated_download_details"]);
    assert.equal(mailcheap.welcomeEmails, 0);
    assert.ok(
      mailcheap.calls.every((call) => !call.includes("status")),
      "the sync never calls the status endpoint",
    );
  });

  it("never resubscribes a contact that unsubscribed between lookup and create", async () => {
    const mailcheap = new FakeMailCheap();
    mailcheap.beforeCreate = (email) => {
      mailcheap.contacts.set(email, { id: "mc_race", email, status: "unsubscribed", fields: {}, tags: [] });
    };
    await submitDownload("race@example.com", "mac");
    const result = await createN8nRunner(mailcheap)();

    assert.equal(mailcheap.contacts.get("race@example.com")!.status, "unsubscribed");
    assert.equal(result.acks[0].outcome, "existing_contact");
    assert.equal(mailcheap.welcomeEmails, 0);
  });

  it("queues through an outage and processes the retry exactly once", async () => {
    const mailcheap = new FakeMailCheap();
    mailcheap.outage = "network";
    await submitDownload("outage@example.com", "mac");

    const failed = await createN8nRunner(mailcheap)();
    assert.equal(failed.acks[0].result, "retry");
    let [event] = await eventsFor("outage@example.com");
    assert.equal(event.sync_status, "pending");
    assert.match(String(event.last_error), /ECONNREFUSED/);
    assert.equal(mailcheap.contacts.size, 0);
    assert.equal((await createN8nRunner(mailcheap)()).claimed, 0, "backoff holds the event");

    mailcheap.outage = 503;
    await mem.db.execute(sql`update download_lead_events set next_attempt_at = now()`);
    assert.equal((await createN8nRunner(mailcheap)()).acks[0].result, "retry");

    // Recovered MailCheap, but DoodleNote's ack endpoint is down after the write.
    mailcheap.outage = null;
    await mem.db.execute(sql`update download_lead_events set next_attempt_at = now()`);
    await createN8nRunner(mailcheap, { ackOutage: true })();
    assert.equal(mailcheap.contacts.size, 1);
    [event] = await eventsFor("outage@example.com");
    assert.equal(event.sync_status, "pending", "unacknowledged work stays queued");

    // The lease expires; the next run finds the contact and finishes without a second create.
    await mem.db.execute(sql`update download_lead_events set claimed_at = now() - interval '11 minutes'`);
    const recovered = await createN8nRunner(mailcheap)();
    assert.equal(recovered.acks[0].outcome, "unchanged");
    [event] = await eventsFor("outage@example.com");
    assert.equal(event.sync_status, "synced");
    assert.equal(Number(event.attempts), 4);
    assert.equal(mailcheap.count("POST", "/api/v1/contacts"), 1, "exactly one create across every retry");
    assert.equal(mailcheap.welcomeEmails, 1);
    assert.equal(mailcheap.contacts.get("outage@example.com")!.fields.doodlenote_lifecycle, "free_download");
    assert.equal((await createN8nRunner(mailcheap)()).claimed, 0);
  });

  it("parks a configuration error instead of dropping the event, and skips rejected addresses", async () => {
    const mailcheap = new FakeMailCheap();
    mailcheap.fields.delete("doodlenote_first_download");
    await submitDownload("config@example.com", "mac");
    await submitDownload("typo@gmial.com", "mac");

    const result = await createN8nRunner(mailcheap)();
    const byOutcome = Object.fromEntries(result.acks.map((ack) => [ack.result, ack]));
    assert.match(String(byOutcome.retry.error), /fields\.doodlenote_first_download: no such field/);
    assert.equal(byOutcome.skipped.outcome, "mailcheap_rejected_address");
    const [config] = await eventsFor("config@example.com");
    const [typo] = await eventsFor("typo@gmial.com");
    assert.equal(config.sync_status, "pending");
    assert.equal(typo.sync_status, "skipped");
    assert.equal((await mem.db.select().from(downloadLeadEvents)).length, 2);
  });
});
