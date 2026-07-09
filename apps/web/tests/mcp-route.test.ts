import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { organization, user } from "@repo/db/auth-schema";
import { agentTokens, meetings, notes } from "@repo/db/schema";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

/**
 * Route-level test of the hosted MCP: real JSON-RPC requests through the
 * actual POST handler, against an in-memory database injected via getDb()'s
 * globalThis singleton (billing is disabled in tests — no Stripe env — so
 * entitlement passes).
 */

const TOKEN = `dnag_${"ab".repeat(32)}`;
const OTHER_TOKEN = `dnag_${"cd".repeat(32)}`;
const M1 = "11111111-1111-4111-8111-111111111111";

let mem: InMemoryDb;
let post: (request: Request) => Promise<Response>;

function rpc(body: unknown, token = TOKEN): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function call(method: string, params?: unknown, token = TOKEN) {
  const res = await post(rpc({ jsonrpc: "2.0", id: 1, method, params }, token));
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

before(async () => {
  mem = await createInMemoryDb();
  (globalThis as { __repoDbClient?: unknown }).__repoDbClient = mem.db;
  // Import AFTER the singleton is injected so the route sees the test db.
  const route = await import("../app/api/mcp/route");
  post = route.POST;

  const { createHash } = await import("node:crypto");
  const db = mem.db;
  await db.insert(user).values([
    {
      id: "u1",
      name: "Sean",
      email: "sean@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "u2",
      name: "Other",
      email: "other@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await db.insert(organization).values([
    { id: "org-a", name: "A", slug: "a", createdAt: new Date() },
    { id: "org-b", name: "B", slug: "b", createdAt: new Date() },
  ]);
  await db.insert(agentTokens).values([
    {
      tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
      userId: "u1",
      organizationId: "org-a",
      name: "Test agent",
    },
    {
      tokenHash: createHash("sha256").update(OTHER_TOKEN).digest("hex"),
      userId: "u2",
      organizationId: "org-b",
      name: "Other workspace agent",
    },
  ]);
  await db.insert(meetings).values({
    id: M1,
    organizationId: "org-a",
    title: "Budget review",
    kind: "meeting",
    createdAt: new Date("2026-07-01T10:00:00Z"),
  });
  await db.insert(notes).values({
    meetingId: M1,
    enhancedContent: { format: "markdown", markdown: "## Approved" },
  });
});

after(async () => {
  await mem.close();
});

test("rejects missing or malformed bearer tokens with 401", async () => {
  const res = await post(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  assert.equal(res.status, 401);
  const wrongPrefix = await call("ping", undefined, `dnsy_${"ab".repeat(32)}`);
  assert.equal(wrongPrefix.status, 401);
});

test("initialize negotiates a supported protocol version", async () => {
  const { status, body } = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  assert.equal(status, 200);
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal(body.result.serverInfo.name, "doodle-note");
  assert.deepEqual(body.result.capabilities, { tools: {} });
});

test("notifications are acknowledged with 202 and no body", async () => {
  const res = await post(
    rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assert.equal(res.status, 202);
});

test("tools/list returns the shared contract's five tools", async () => {
  const { body } = await call("tools/list");
  assert.deepEqual(
    body.result.tools.map((t: { name: string }) => t.name),
    [
      "list_recent_meetings",
      "search_meetings",
      "get_meeting",
      "get_meeting_notes",
      "get_meeting_transcript",
    ],
  );
});

test("tools/call runs a tool against the token's workspace", async () => {
  const { body } = await call("tools/call", {
    name: "get_meeting_notes",
    arguments: { meeting_id: M1 },
  });
  assert.equal(body.result.isError, undefined);
  const payload = JSON.parse(body.result.content[0].text);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.notes.enhanced_markdown, "## Approved");
});

test("a token from another workspace cannot read the meeting", async () => {
  const { body } = await call(
    "tools/call",
    { name: "get_meeting_notes", arguments: { meeting_id: M1 } },
    OTHER_TOKEN,
  );
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /No meeting found/);
});

test("unknown methods get a JSON-RPC -32601", async () => {
  const { body } = await call("resources/list");
  assert.equal(body.error.code, -32601);
});

test("tool validation errors surface as isError content, not crashes", async () => {
  const { body } = await call("tools/call", {
    name: "search_meetings",
    arguments: {},
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /query is required/);
});
