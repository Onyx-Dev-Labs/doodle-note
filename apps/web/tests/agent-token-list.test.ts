import assert from "node:assert/strict";
import { test } from "node:test";
import { organization, user } from "@repo/db/auth-schema";
import { agentTokens } from "@repo/db/schema";
import { createInMemoryDb } from "@repo/db/testing";
import { listWorkspaceAgentTokens } from "../lib/agent-token-list";

test("agent setup lists only the user's tokens in the selected workspace and no secrets", async () => {
  const mem = await createInMemoryDb();
  const singleton = globalThis as { __repoDbClient?: unknown };
  const previous = singleton.__repoDbClient;
  singleton.__repoDbClient = mem.db;
  try {
    await mem.db.insert(user).values([
      { id: "u1", name: "Fixture One", email: "one@example.test" },
      { id: "u2", name: "Fixture Two", email: "two@example.test" },
    ]);
    await mem.db.insert(organization).values([
      { id: "w1", name: "Fixture A", slug: "fixture-a", createdAt: new Date() },
      { id: "w2", name: "Fixture B", slug: "fixture-b", createdAt: new Date() },
    ]);
    await mem.db.insert(agentTokens).values([
      {
        id: "00000000-0000-4000-8000-000000000001",
        userId: "u1",
        organizationId: "w1",
        name: "Composio A",
        tokenHash: "fixture-hash-a",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        userId: "u1",
        organizationId: "w2",
        name: "Composio B",
        tokenHash: "fixture-hash-b",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        userId: "u2",
        organizationId: "w1",
        name: "Someone else",
        tokenHash: "fixture-hash-c",
      },
    ]);
    const rows = await listWorkspaceAgentTokens("u1", "w1");
    assert.deepEqual(
      rows.map((row) => row.id),
      ["00000000-0000-4000-8000-000000000001"],
    );
    assert.equal(JSON.stringify(rows).includes("tokenHash"), false);
    assert.deepEqual(
      (await listWorkspaceAgentTokens("u1", "w2")).map((row) => row.id),
      ["00000000-0000-4000-8000-000000000002"],
    );
    assert.deepEqual(await listWorkspaceAgentTokens("u1", "unknown"), []);
  } finally {
    singleton.__repoDbClient = previous;
    await mem.close();
  }
});
