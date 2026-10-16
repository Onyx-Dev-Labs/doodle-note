import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  eq,
  folders,
  meetings,
  meetingTagLinks,
  meetingTags,
  organization,
} from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import { handleMeetingMove, type MeetingMoveAccess } from "../lib/meeting-move";

let mem: InMemoryDb;

const personalId = "move-personal";
const teamId = "move-team";
const meetingId = "00000000-0000-4000-8000-0000000000a1";
const personalFolderId = "00000000-0000-4000-8000-0000000000b1";
const otherPersonalFolderId = "00000000-0000-4000-8000-0000000000b2";
const teamFolderId = "00000000-0000-4000-8000-0000000000b3";
const tagId = "00000000-0000-4000-8000-0000000000c1";
const shareToken = "share-token-fixture";

const organizations = [
  { id: personalId, name: "Personal" },
  { id: teamId, name: "Team" },
];

before(async () => {
  mem = await createInMemoryDb();
  const now = new Date();
  await mem.db.insert(organization).values([
    { id: personalId, name: "Personal", slug: "move-personal", createdAt: now },
    { id: teamId, name: "Team", slug: "move-team", createdAt: now },
  ]);
  await mem.db.insert(folders).values([
    { id: personalFolderId, organizationId: personalId, name: "Customers" },
    { id: otherPersonalFolderId, organizationId: personalId, name: "Internal" },
    { id: teamFolderId, organizationId: teamId, name: "Team space" },
  ]);
  await mem.db.insert(meetings).values({
    id: meetingId,
    organizationId: personalId,
    title: "Move fixture",
    folderId: personalFolderId,
    shareToken,
  });
  await mem.db
    .insert(meetingTags)
    .values({ id: tagId, organizationId: personalId, name: "customer" });
  await mem.db.insert(meetingTagLinks).values({ meetingId, tagId });
});

after(async () => {
  await mem.close();
});

async function currentMeeting() {
  const rows = await mem.db
    .select()
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  return rows[0]!;
}

async function accessFor(): Promise<MeetingMoveAccess> {
  return { organizations, meeting: await currentMeeting() };
}

async function tagLinkCount() {
  return (
    await mem.db
      .select()
      .from(meetingTagLinks)
      .where(eq(meetingTagLinks.meetingId, meetingId))
  ).length;
}

function moveRequest(body: unknown) {
  return new Request(`http://localhost/api/meetings/${meetingId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/meetings/[id]/move", () => {
  beforeEach(async () => {
    // Every case starts from the same personal-workspace placement.
    await mem.db
      .update(meetings)
      .set({ folderId: personalFolderId })
      .where(eq(meetings.id, meetingId));
  });

  it("rejects moving to another workspace before any mutation", async () => {
    const response = await handleMeetingMove(
      moveRequest({ organizationId: teamId, folderId: teamFolderId }),
      await accessFor(),
      mem.db,
    );

    assert.equal(response.status, 409);
    const body = (await response.json()) as { error?: string };
    assert.equal(
      body.error,
      "Meetings can't be moved to another workspace. Share it with people instead.",
    );

    const meeting = await currentMeeting();
    assert.equal(meeting.organizationId, personalId);
    assert.equal(meeting.folderId, personalFolderId);
    assert.equal(meeting.shareToken, shareToken);
    assert.equal(await tagLinkCount(), 1, "tag links must survive a rejected move");
  });

  it("rejects a cross-workspace move even without a folder", async () => {
    const response = await handleMeetingMove(
      moveRequest({ organizationId: teamId, folderId: null }),
      await accessFor(),
      mem.db,
    );
    assert.equal(response.status, 409);
    assert.equal((await currentMeeting()).organizationId, personalId);
    assert.equal(await tagLinkCount(), 1);
  });

  it("moves between spaces inside the meeting's own workspace", async () => {
    const response = await handleMeetingMove(
      moveRequest({ organizationId: personalId, folderId: otherPersonalFolderId }),
      await accessFor(),
      mem.db,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, workspaceName: "Personal" });

    const meeting = await currentMeeting();
    assert.equal(meeting.organizationId, personalId);
    assert.equal(meeting.folderId, otherPersonalFolderId);
    assert.equal(meeting.shareToken, shareToken, "same-workspace moves keep public links");
    assert.equal(await tagLinkCount(), 1, "same-workspace moves keep tags");
  });

  it("treats an omitted workspace as the meeting's own and can unfile", async () => {
    const response = await handleMeetingMove(
      moveRequest({ folderId: null }),
      await accessFor(),
      mem.db,
    );
    assert.equal(response.status, 200);
    const meeting = await currentMeeting();
    assert.equal(meeting.organizationId, personalId);
    assert.equal(meeting.folderId, null);
  });

  it("still rejects a space that belongs to another workspace", async () => {
    const response = await handleMeetingMove(
      moveRequest({ organizationId: personalId, folderId: teamFolderId }),
      await accessFor(),
      mem.db,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Folder does not belong to that workspace",
    });
    assert.equal((await currentMeeting()).folderId, personalFolderId);
  });

  it("returns 404 when the caller cannot access the meeting", async () => {
    const response = await handleMeetingMove(
      moveRequest({ organizationId: personalId, folderId: otherPersonalFolderId }),
      null,
      mem.db,
    );
    assert.equal(response.status, 404);
    assert.equal((await currentMeeting()).folderId, personalFolderId);
  });

  it("rejects malformed JSON", async () => {
    const response = await handleMeetingMove(
      new Request(`http://localhost/api/meetings/${meetingId}/move`, {
        method: "POST",
        body: "{",
      }),
      await accessFor(),
      mem.db,
    );
    assert.equal(response.status, 400);
  });
});
