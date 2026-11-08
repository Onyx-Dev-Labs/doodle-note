import assert from "node:assert/strict";
import { test } from "node:test";

import { member, organization, user } from "@repo/db/auth-schema";
import { createInMemoryDb } from "@repo/db/testing";

import { isPersonalWorkspaceSlug } from "../lib/personal-workspace-slug";

test("reserved personal- slugs are recognised regardless of case or padding", () => {
  assert.equal(isPersonalWorkspaceSlug("personal-abc123"), true);
  assert.equal(isPersonalWorkspaceSlug("  Personal-Abc"), true);
  assert.equal(isPersonalWorkspaceSlug("personal"), false);
  assert.equal(isPersonalWorkspaceSlug("my-personal-team"), false);
  assert.equal(isPersonalWorkspaceSlug(undefined), false);
});

test("an invitee to someone else's personal- workspace still gets a private workspace of their own", async () => {
  const mem = await createInMemoryDb();
  const singleton = globalThis as { __repoDbClient?: unknown };
  const previous = singleton.__repoDbClient;
  singleton.__repoDbClient = mem.db;
  try {
    const { ensurePersonalWorkspace } = await import("../lib/workspace");
    const now = new Date();
    await mem.db.insert(user).values([
      { id: "owner", name: "Owner", email: "owner@example.test" },
      { id: "victim", name: "Victim", email: "victim@example.test" },
    ]);
    await mem.db.insert(organization).values({ id: "team", name: "Team", slug: "personal-team", createdAt: now });
    await mem.db.insert(member).values([
      { id: "m1", organizationId: "team", userId: "owner", role: "owner", createdAt: now },
      { id: "m2", organizationId: "team", userId: "victim", role: "member", createdAt: now },
    ]);

    const workspace = await ensurePersonalWorkspace("victim");
    assert.notEqual(workspace.id, "team");
    assert.match(workspace.slug, /^personal-/);
    // Idempotent for the real owner of the spoofed team, and stable for the victim.
    assert.equal((await ensurePersonalWorkspace("victim")).id, workspace.id);
  } finally {
    singleton.__repoDbClient = previous;
    await mem.close();
  }
});
