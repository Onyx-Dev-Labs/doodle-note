import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { organization, user } from "@repo/db/auth-schema";
import { meetings, notes, transcriptSegments } from "@repo/db/schema";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import { CloudMeetingSource } from "../lib/cloud-meeting-source";

let mem: InMemoryDb;
let source: CloudMeetingSource;

const ORG_A = "org-a";
const ORG_B = "org-b";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const NOTE1 = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

before(async () => {
  mem = await createInMemoryDb();
  const db = mem.db;
  await db.insert(user).values({
    id: "u1",
    name: "Sean",
    email: "sean@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(organization).values([
    { id: ORG_A, name: "Workspace A", slug: "workspace-a", createdAt: new Date() },
    { id: ORG_B, name: "Workspace B", slug: "workspace-b", createdAt: new Date() },
  ]);
  await db.insert(meetings).values([
    {
      id: M1,
      organizationId: ORG_A,
      title: "Budget review",
      kind: "meeting",
      createdAt: new Date("2026-07-01T10:00:00Z"),
      startedAt: new Date("2026-07-01T10:00:00Z"),
      endedAt: new Date("2026-07-01T10:30:00Z"),
      calendarEventId: "cal-1",
    },
    {
      id: M2,
      organizationId: ORG_A,
      title: "Standup",
      kind: "meeting",
      createdAt: new Date("2026-07-02T10:00:00Z"),
    },
    {
      id: NOTE1,
      organizationId: ORG_A,
      title: "Quick idea",
      kind: "note",
      createdAt: new Date("2026-07-03T10:00:00Z"),
    },
    {
      id: OTHER,
      organizationId: ORG_B,
      title: "Other workspace secret budget",
      kind: "meeting",
      createdAt: new Date("2026-07-04T10:00:00Z"),
    },
  ]);
  await db.insert(notes).values([
    {
      meetingId: M1,
      rawContent: { format: "markdown", markdown: "- ask about budget" },
      enhancedContent: { format: "markdown", markdown: "## Decisions\n- approved" },
    },
    {
      meetingId: OTHER,
      rawContent: { format: "markdown", markdown: "secret budget notes" },
    },
  ]);
  await db.insert(transcriptSegments).values([
    {
      meetingId: M1,
      channel: "system",
      speaker: "Them",
      text: "the budget looks fine",
      startMs: 0,
      endMs: 2000,
    },
    {
      meetingId: M1,
      channel: "mic",
      speaker: "You",
      text: "great, approved",
      startMs: 2000,
      endMs: 3000,
    },
  ]);
  // The class takes the app's Db union type; PGlite's drizzle client is
  // runtime-compatible (same schema, same query builder).
  source = new CloudMeetingSource(db as never, ORG_A);
});

after(async () => {
  await mem.close();
});

test("listRecent is newest-first, org-scoped, with kind and flags", async () => {
  const list = await source.listRecent(10);
  assert.deepEqual(
    list.map((m) => m.meeting_id),
    [NOTE1, M2, M1],
  );
  assert.equal(list[0]?.kind, "note");
  const m1 = list[2]!;
  assert.equal(m1.kind, "meeting");
  assert.equal(m1.has_notes, true);
  assert.equal(m1.has_transcript, true);
  assert.equal(m1.duration_min, 30);
  assert.equal(m1.calendar_event_id, "cal-1");
  assert.equal(list[1]?.has_notes, false);
  assert.equal(list[1]?.has_transcript, false);
});

test("another workspace's meetings are invisible to every tool", async () => {
  assert.equal(await source.getMeeting(OTHER), null);
  assert.equal(await source.getNotes(OTHER), null);
  assert.equal(await source.getTranscript(OTHER), null);
  const hits = await source.search("secret", 10);
  assert.deepEqual(hits, []);
});

test("search reports strongest field: title > notes > transcript", async () => {
  const titleHit = await source.search("standup", 10);
  assert.equal(titleHit[0]?.matched_field, "title");

  const notesHit = await source.search("approved", 10);
  // M1 matches "approved" in notes (enhanced) — notes outranks transcript.
  assert.equal(notesHit[0]?.meeting_id, M1);
  assert.equal(notesHit[0]?.matched_field, "notes");

  const transcriptHit = await source.search("looks fine", 10);
  assert.equal(transcriptHit[0]?.meeting_id, M1);
  assert.equal(transcriptHit[0]?.matched_field, "transcript");
});

test("search escapes LIKE wildcards", async () => {
  assert.deepEqual(await source.search("100%", 10), []);
  assert.deepEqual(await source.search("_", 10), []);
});

test("getNotes returns markdown from both envelopes", async () => {
  const n = await source.getNotes(M1);
  assert.ok(n);
  assert.equal(n.raw_notes_markdown, "- ask about budget");
  assert.equal(n.enhanced_markdown, "## Decisions\n- approved");
});

test("getTranscript orders by startMs and renders speaker lines", async () => {
  const t = await source.getTranscript(M1);
  assert.ok(t);
  assert.equal(t.text, "Them: the budget looks fine\nYou: great, approved");
  assert.equal(t.segments.length, 2);
  assert.equal(t.duration_min, 30);
});

test("malformed meeting ids return null instead of erroring", async () => {
  assert.equal(await source.getMeeting("not-a-uuid"), null);
  assert.equal(await source.getMeeting("'; drop table meetings;--"), null);
});
