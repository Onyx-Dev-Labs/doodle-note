import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  agentTokens,
  eq,
  folders,
  member,
  meetingStars,
  meetings,
  meetingTagLinks,
  meetingTags,
  notes,
  organization,
  subscriptions,
  syncDevices,
  transcriptSegments,
  user,
} from "@repo/db";
import { createInMemoryDb, type InMemoryDb } from "@repo/db/testing";

import { purgePersonalCloudData } from "../lib/cloud-data-purge";

let mem: InMemoryDb;

const userId = "canceling-user";
const collaboratorId = "collaborator";
const personalId = "personal-workspace";
const sharedId = "shared-workspace";
const personalMeetingId = "00000000-0000-4000-8000-000000000001";
const sharedMeetingId = "00000000-0000-4000-8000-000000000002";
const personalFolderId = "00000000-0000-4000-8000-000000000011";
const sharedFolderId = "00000000-0000-4000-8000-000000000012";
const personalTagId = "00000000-0000-4000-8000-000000000021";
const sharedTagId = "00000000-0000-4000-8000-000000000022";

before(async () => {
  mem = await createInMemoryDb();
  const now = new Date();
  await mem.db.insert(user).values([
    {
      id: userId,
      name: "Canceling User",
      email: "canceling@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: collaboratorId,
      name: "Collaborator",
      email: "collaborator@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await mem.db.insert(organization).values([
    { id: personalId, name: "Personal", slug: "personal-fixture", createdAt: now },
    { id: sharedId, name: "Shared", slug: "shared-fixture", createdAt: now },
  ]);
  await mem.db.insert(member).values([
    { id: "member-personal", organizationId: personalId, userId, role: "owner", createdAt: now },
    { id: "member-shared", organizationId: sharedId, userId, role: "member", createdAt: now },
    { id: "member-collaborator", organizationId: sharedId, userId: collaboratorId, role: "owner", createdAt: now },
  ]);
  await mem.db.insert(folders).values([
    { id: personalFolderId, organizationId: personalId, name: "Private" },
    { id: sharedFolderId, organizationId: sharedId, name: "Team" },
  ]);
  await mem.db.insert(meetings).values([
    { id: personalMeetingId, organizationId: personalId, title: "Private meeting", folderId: personalFolderId },
    { id: sharedMeetingId, organizationId: sharedId, title: "Shared meeting", folderId: sharedFolderId },
  ]);
  await mem.db.insert(transcriptSegments).values([
    { meetingId: personalMeetingId, channel: "mic", speaker: "You", text: "private", startMs: 0, endMs: 10 },
    { meetingId: sharedMeetingId, channel: "mic", speaker: "You", text: "shared", startMs: 0, endMs: 10 },
  ]);
  await mem.db.insert(notes).values([
    { meetingId: personalMeetingId, rawContent: { format: "markdown", markdown: "private" } },
    { meetingId: sharedMeetingId, rawContent: { format: "markdown", markdown: "shared" } },
  ]);
  await mem.db.insert(meetingTags).values([
    { id: personalTagId, organizationId: personalId, name: "private" },
    { id: sharedTagId, organizationId: sharedId, name: "shared" },
  ]);
  await mem.db.insert(meetingTagLinks).values([
    { meetingId: personalMeetingId, tagId: personalTagId },
    { meetingId: sharedMeetingId, tagId: sharedTagId },
  ]);
  await mem.db.insert(meetingStars).values([
    { meetingId: personalMeetingId, userId },
    { meetingId: sharedMeetingId, userId },
    { meetingId: sharedMeetingId, userId: collaboratorId },
  ]);
  await mem.db.insert(syncDevices).values([
    { tokenHash: "user-personal-token", userId, organizationId: personalId, deviceName: "Mac" },
    { tokenHash: "user-shared-token", userId, organizationId: sharedId, deviceName: "Mac" },
    { tokenHash: "collaborator-token", userId: collaboratorId, organizationId: sharedId, deviceName: "Mac" },
  ]);
  await mem.db.insert(agentTokens).values([
    { tokenHash: "user-agent-token", userId, organizationId: personalId, name: "Agent" },
    { tokenHash: "collaborator-agent-token", userId: collaboratorId, organizationId: sharedId, name: "Agent" },
  ]);
  await mem.db.insert(subscriptions).values({
    userId,
    stripeCustomerId: "cus_fixture",
    stripeSubscriptionId: "sub_fixture",
    status: "canceled",
  });
});

after(async () => {
  await mem.close();
});

describe("personal Cloud Sync data purge", () => {
  it("deletes personal cloud copies and user credentials while retaining the account and shared data", async () => {
    const deletedPrefixes: string[] = [];
    const result = await purgePersonalCloudData({
      db: mem.db,
      userId,
      deleteAttachmentPrefix: async (prefix) => {
        deletedPrefixes.push(prefix);
      },
    });

    assert.deepEqual(deletedPrefixes, [`attachments/${personalId}/`]);
    assert.equal(result.personalWorkspaceCount, 1);
    assert.equal(result.meetingCount, 1);

    assert.equal((await mem.db.select().from(meetings).where(eq(meetings.id, personalMeetingId))).length, 0);
    assert.equal((await mem.db.select().from(folders).where(eq(folders.id, personalFolderId))).length, 0);
    assert.equal((await mem.db.select().from(meetingTags).where(eq(meetingTags.id, personalTagId))).length, 0);
    assert.equal((await mem.db.select().from(meetings).where(eq(meetings.id, sharedMeetingId))).length, 1);
    assert.equal((await mem.db.select().from(folders).where(eq(folders.id, sharedFolderId))).length, 1);
    assert.equal((await mem.db.select().from(meetingTags).where(eq(meetingTags.id, sharedTagId))).length, 1);

    assert.equal((await mem.db.select().from(syncDevices).where(eq(syncDevices.userId, userId))).length, 0);
    assert.equal((await mem.db.select().from(agentTokens).where(eq(agentTokens.userId, userId))).length, 0);
    assert.equal((await mem.db.select().from(meetingStars).where(eq(meetingStars.userId, userId))).length, 0);
    assert.equal((await mem.db.select().from(syncDevices).where(eq(syncDevices.userId, collaboratorId))).length, 1);
    assert.equal((await mem.db.select().from(agentTokens).where(eq(agentTokens.userId, collaboratorId))).length, 1);
    assert.equal((await mem.db.select().from(meetingStars).where(eq(meetingStars.userId, collaboratorId))).length, 1);

    assert.equal((await mem.db.select().from(user).where(eq(user.id, userId))).length, 1);
    assert.equal((await mem.db.select().from(organization).where(eq(organization.id, personalId))).length, 1);
    assert.equal((await mem.db.select().from(member).where(eq(member.userId, userId))).length, 2);
    assert.equal((await mem.db.select().from(subscriptions).where(eq(subscriptions.userId, userId))).length, 1);
  });
});
