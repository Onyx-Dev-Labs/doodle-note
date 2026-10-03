import { cleanupPrivateInk } from "./private-ink-cleanup";
import type { PrivateInkStore } from "./private-ink-store";
import { del, list } from "@vercel/blob";
import {
  agentTokens,
  and,
  eq,
  folders,
  getDb,
  member,
  meetingStars,
  meetings,
  meetingTags,
  organization,
  sql,
  syncDevices,
  type Db,
} from "@repo/db";

export interface CloudDataPurgeResult {
  personalWorkspaceCount: number;
  meetingCount: number;
}

interface PurgePersonalCloudDataInput {
  userId: string;
  db?: Db;
  privateInkProvider?: PrivateInkStore;
  deleteAttachmentPrefix?: (prefix: string) => Promise<void>;
}

export async function deleteCloudAttachments(prefix: string): Promise<void> {
  let cursor: string | undefined;
  const urls: string[] = [];
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    urls.push(...page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  for (let offset = 0; offset < urls.length; offset += 1000) {
    await del(urls.slice(offset, offset + 1000));
  }
}

/**
 * Delete only cloud data that is exclusively owned by this subscriber.
 * Shared-workspace content belongs to the workspace and must survive one
 * member's cancellation, but that member's device and agent credentials are
 * revoked across every workspace.
 */
export async function purgePersonalCloudData({
  userId,
  db = getDb(),
  deleteAttachmentPrefix = deleteCloudAttachments,
  privateInkProvider,
}: PurgePersonalCloudDataInput): Promise<CloudDataPurgeResult> {
  const personalWorkspaces = await db
    .select({ id: organization.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        eq(member.role, "owner"),
        sql`${organization.slug} like 'personal-%'`,
      ),
    );

  for (const workspace of personalWorkspaces) {
    await deleteAttachmentPrefix(`attachments/${workspace.id}/`);
  }

  await db.delete(syncDevices).where(eq(syncDevices.userId, userId));
  await db.delete(agentTokens).where(eq(agentTokens.userId, userId));
  await db.delete(meetingStars).where(eq(meetingStars.userId, userId));

  let meetingCount = 0;
  for (const workspace of personalWorkspaces) {
    // Catalog lookup is safe before migration and during a flag-off rollback.
    // Once installed, the function also erases native-only/history content and
    // retains minimal resurrection barriers before old projections are deleted.
    const capability = await db.execute(sql`select to_regprocedure('sync_purge_workspace(text)') is not null as available`);
    const capabilityRows = Array.isArray(capability) ? capability : capability.rows;
    if(capabilityRows[0]?.available) {
      const result=await db.execute(sql`select sync_purge_workspace(${workspace.id}) as count`);
      const rows=Array.isArray(result)?result:result.rows;
      meetingCount+=Number(rows[0]?.count??0);
    } else {
      const deletedMeetings = await db.delete(meetings).where(eq(meetings.organizationId, workspace.id)).returning();
      meetingCount += deletedMeetings.length;
    }
    const privateCleanup = await cleanupPrivateInk(db, workspace.id, privateInkProvider);
    if (privateCleanup.failed || privateCleanup.pending) {
      throw new Error("Private asset cleanup pending");
    }
    await db.delete(folders).where(eq(folders.organizationId, workspace.id));
    await db
      .delete(meetingTags)
      .where(eq(meetingTags.organizationId, workspace.id));
  }

  return {
    personalWorkspaceCount: personalWorkspaces.length,
    meetingCount,
  };
}
