import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { and, eq } from "@repo/db";
import { member, organization, user } from "@repo/db/auth-schema";
import {
  folders,
  meetings,
  meetingTagLinks,
  meetingTags,
} from "@repo/db/schema";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import {
  libraryMeetingScope,
  loadLibraryFilterOptions,
  meetingHasTag,
  resolveLibraryScope,
} from "../lib/library-scope";

let mem: InMemoryDb;

const USER = "u-sean";
const OTHER_USER = "u-other";
const PERSONAL = "org-personal";
const TEAM = "org-team";
const FORMER = "org-former"; // the user was removed / left
const STRANGER = "org-stranger"; // the user was never a member

const M_PERSONAL = "11111111-1111-4111-8111-111111111111";
const M_TEAM = "22222222-2222-4222-8222-222222222222";
const M_FORMER = "33333333-3333-4333-8333-333333333333";
const M_STRANGER = "44444444-4444-4444-8444-444444444444";
const M_TEAM_2 = "55555555-5555-4555-8555-555555555555";
const F_PERSONAL = "66666666-6666-4666-8666-666666666666";
const F_TEAM = "77777777-7777-4777-8777-777777777777";

const workspaces = [
  { id: PERSONAL, name: "Personal", slug: "personal-aaaa" },
  { id: TEAM, name: "Acme", slug: "acme-1" },
];

before(async () => {
  mem = await createInMemoryDb();
  const db = mem.db;
  const now = new Date();
  await db.insert(user).values([
    { id: USER, name: "Sean", email: "sean@example.com", emailVerified: true, createdAt: now, updatedAt: now },
    { id: OTHER_USER, name: "Other", email: "other@example.com", emailVerified: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: PERSONAL, name: "Personal", slug: "personal-aaaa", createdAt: now },
    { id: TEAM, name: "Acme", slug: "acme-1", createdAt: now },
    { id: FORMER, name: "Old team", slug: "old-1", createdAt: now },
    { id: STRANGER, name: "Stranger", slug: "stranger-1", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "m1", organizationId: PERSONAL, userId: USER, role: "owner", createdAt: now },
    { id: "m2", organizationId: TEAM, userId: USER, role: "member", createdAt: now },
    { id: "m3", organizationId: FORMER, userId: USER, role: "member", createdAt: now },
    { id: "m4", organizationId: TEAM, userId: OTHER_USER, role: "owner", createdAt: now },
    { id: "m5", organizationId: FORMER, userId: OTHER_USER, role: "owner", createdAt: now },
    { id: "m6", organizationId: STRANGER, userId: OTHER_USER, role: "owner", createdAt: now },
  ]);
  await db.insert(folders).values([
    { id: F_PERSONAL, organizationId: PERSONAL, name: "Private stuff" },
    { id: F_TEAM, organizationId: TEAM, name: "Customers" },
  ]);
  await db.insert(meetings).values([
    { id: M_PERSONAL, organizationId: PERSONAL, title: "My 1:1", kind: "meeting", folderId: F_PERSONAL },
    { id: M_TEAM, organizationId: TEAM, title: "Team sync", kind: "meeting", folderId: F_TEAM },
    { id: M_TEAM_2, organizationId: TEAM, title: "Team retro", kind: "meeting" },
    { id: M_FORMER, organizationId: FORMER, title: "Old team plans", kind: "meeting" },
    { id: M_STRANGER, organizationId: STRANGER, title: "Not yours", kind: "meeting" },
  ]);
  const tagRows = await db
    .insert(meetingTags)
    .values([
      { organizationId: PERSONAL, name: "follow-up" },
      { organizationId: TEAM, name: "follow-up" },
      { organizationId: TEAM, name: "customer" },
      { organizationId: STRANGER, name: "follow-up" },
    ])
    .returning({ id: meetingTags.id, organizationId: meetingTags.organizationId, name: meetingTags.name });
  const tagId = (org: string, name: string) =>
    tagRows.find((row) => row.organizationId === org && row.name === name)!.id;
  await db.insert(meetingTagLinks).values([
    { meetingId: M_PERSONAL, tagId: tagId(PERSONAL, "follow-up") },
    { meetingId: M_TEAM, tagId: tagId(TEAM, "follow-up") },
    { meetingId: M_TEAM_2, tagId: tagId(TEAM, "customer") },
    { meetingId: M_STRANGER, tagId: tagId(STRANGER, "follow-up") },
  ]);

  // The user leaves the former team: Better Auth deletes the member row.
  await db.delete(member).where(eq(member.id, "m3"));
});

after(async () => {
  await mem.close();
});

async function listIds(organizationIds: string[], extra?: ReturnType<typeof meetingHasTag>) {
  const scope = libraryMeetingScope(USER, organizationIds);
  const rows = await mem.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(extra ? and(scope, extra) : scope)
    .orderBy(meetings.title);
  return rows.map((row) => row.id).sort();
}

test("default scope lists Personal and team workspaces without switching", async () => {
  const scope = resolveLibraryScope(workspaces, undefined);
  assert.deepEqual(scope.organizationIds, [PERSONAL, TEAM]);
  assert.equal(scope.selected, null);
  assert.equal(scope.single, null);
  assert.equal(scope.multiWorkspace, true);
  assert.deepEqual(await listIds(scope.organizationIds), [M_PERSONAL, M_TEAM, M_TEAM_2].sort());
});

test("workspace filter narrows to one membership", async () => {
  const scope = resolveLibraryScope(workspaces, TEAM);
  assert.deepEqual(scope.organizationIds, [TEAM]);
  assert.equal(scope.selected?.id, TEAM);
  assert.equal(scope.single?.id, TEAM);
  assert.deepEqual(await listIds(scope.organizationIds), [M_TEAM, M_TEAM_2].sort());
});

test("invalid or non-member workspace filter is ignored safely", async () => {
  for (const requested of [STRANGER, FORMER, "", "   ", "not-an-org", "' or 1=1 --"]) {
    const scope = resolveLibraryScope(workspaces, requested);
    assert.equal(scope.selected, null, requested);
    assert.deepEqual(scope.organizationIds, [PERSONAL, TEAM], requested);
    const ids = await listIds(scope.organizationIds);
    assert.ok(!ids.includes(M_STRANGER), requested);
    assert.ok(!ids.includes(M_FORMER), requested);
  }
});

test("non-member organizations are never listed, even if passed in", async () => {
  // A stale or tampered organization list must not widen the scope: the query
  // re-checks membership against the member table.
  const ids = await listIds([PERSONAL, TEAM, STRANGER, FORMER]);
  assert.deepEqual(ids, [M_PERSONAL, M_TEAM, M_TEAM_2].sort());
  assert.deepEqual(await listIds([STRANGER]), []);
  assert.deepEqual(await listIds([]), []);
});

test("a workspace the user has left is not listed", async () => {
  assert.deepEqual(await listIds([FORMER]), []);
  // Another member of that workspace still sees it.
  const rows = await mem.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(libraryMeetingScope(OTHER_USER, [FORMER]));
  assert.deepEqual(rows.map((row) => row.id), [M_FORMER]);
});

test("single-workspace users keep workspace-specific filters", () => {
  const scope = resolveLibraryScope([workspaces[0]!], undefined);
  assert.equal(scope.multiWorkspace, false);
  assert.equal(scope.selected, null);
  assert.equal(scope.single?.id, PERSONAL);
  assert.deepEqual(scope.organizationIds, [PERSONAL]);
});

test("tag and space options only come from the selected workspace", async () => {
  const team = await loadLibraryFilterOptions(mem.db, TEAM);
  assert.deepEqual(team.folders.map((folder) => folder.name), ["Customers"]);
  assert.deepEqual(team.tags, [
    { name: "customer", count: 1 },
    { name: "follow-up", count: 1 },
  ]);
  const personal = await loadLibraryFilterOptions(mem.db, PERSONAL);
  assert.deepEqual(personal.folders.map((folder) => folder.name), ["Private stuff"]);
  assert.deepEqual(personal.tags, [{ name: "follow-up", count: 1 }]);
  // "All workspaces" offers no workspace-specific options.
  assert.deepEqual(await loadLibraryFilterOptions(mem.db, null), { folders: [], tags: [] });
});

test("tag filter matches each meeting's own workspace tag within scope", async () => {
  const all = resolveLibraryScope(workspaces, undefined);
  assert.deepEqual(
    await listIds(all.organizationIds, meetingHasTag("follow-up")),
    [M_PERSONAL, M_TEAM].sort(),
  );
  const team = resolveLibraryScope(workspaces, TEAM);
  assert.deepEqual(await listIds(team.organizationIds, meetingHasTag("follow-up")), [M_TEAM]);
  assert.deepEqual(await listIds(team.organizationIds, meetingHasTag("customer")), [M_TEAM_2]);
  assert.deepEqual(await listIds(all.organizationIds, meetingHasTag("missing")), []);
});
