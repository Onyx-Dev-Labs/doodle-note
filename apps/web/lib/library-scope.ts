import {
  and,
  eq,
  folders,
  inArray,
  member,
  meetings,
  meetingTagLinks,
  meetingTags,
  sql,
  type Db,
} from "@repo/db";

/**
 * Organization scoping for the meetings library (DEV-488).
 *
 * The library lists meetings from EVERY workspace the signed-in user is a
 * member of — Personal plus any team workspaces — without changing the active
 * workspace (which still drives device linking, agent tokens, members and
 * invitations). An optional `?workspace=<orgId>` narrows the list to one
 * membership; anything else is ignored and the library falls back to all
 * memberships.
 *
 * Tags and spaces (folders) belong to a single workspace, so their filter
 * options are only offered when exactly one workspace is in scope (an explicit
 * selection, or a user who only has Personal). In the "All workspaces" view a
 * `tag`/`space` param that is already in the URL still filters safely: tags
 * match by name inside each meeting's own workspace and spaces match by id,
 * both within the membership scope.
 */

export interface LibraryWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface LibraryScope {
  /** Workspaces whose meetings are listed. Always a subset of memberships. */
  organizationIds: string[];
  /** The workspace chosen with `?workspace=`, when it is a valid membership. */
  selected: LibraryWorkspace | null;
  /**
   * The single workspace in scope, if there is exactly one (explicitly
   * selected, or the user's only membership). Workspace-specific filters
   * (spaces, tags) are offered only for this workspace.
   */
  single: LibraryWorkspace | null;
  /** The user belongs to more than one workspace (badges/filter are useful). */
  multiWorkspace: boolean;
}

export function resolveLibraryScope(
  organizations: readonly LibraryWorkspace[],
  requestedWorkspace?: string | null,
): LibraryScope {
  const requested =
    typeof requestedWorkspace === "string" ? requestedWorkspace.trim() : "";
  const selected =
    (requested &&
      organizations.find((organization) => organization.id === requested)) ||
    null;
  const organizationIds = selected
    ? [selected.id]
    : organizations.map((organization) => organization.id);
  const single =
    selected ?? (organizations.length === 1 ? organizations[0]! : null);
  return {
    organizationIds,
    selected,
    single,
    multiWorkspace: organizations.length > 1,
  };
}

/**
 * WHERE condition restricting `meetings` to the scoped workspaces. Uses
 * `meetings_organization_id_idx` via `IN (...)`, and re-checks membership
 * against the `member` table (Better Auth's source of truth) in the same
 * query, so a workspace the user has left is never listed even if a stale
 * organization list is passed in.
 */
export function libraryMeetingScope(
  userId: string,
  organizationIds: readonly string[],
) {
  if (organizationIds.length === 0) return sql`false`;
  return and(
    inArray(meetings.organizationId, [...organizationIds]),
    sql`${meetings.organizationId} in (select ${member.organizationId} from ${member} where ${member.userId} = ${userId})`,
  )!;
}

/** Meeting carries the named tag of its own workspace. */
export function meetingHasTag(tag: string) {
  return sql`exists (select 1 from ${meetingTagLinks} mtl join ${meetingTags} mt on mt.id = mtl.tag_id where mtl.meeting_id = ${meetings.id} and mt.organization_id = ${meetings.organizationId} and mt.name = ${tag})`;
}

export interface LibraryFilterOptions {
  folders: Array<{ id: string; name: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}

/**
 * Space and tag options for ONE workspace. Returns nothing when no single
 * workspace is in scope ("All workspaces" with several memberships), so the
 * library never mixes one workspace's folders or tags into another's view.
 */
export async function loadLibraryFilterOptions(
  db: Db,
  organizationId: string | null,
): Promise<LibraryFilterOptions> {
  if (!organizationId) return { folders: [], tags: [] };
  const [folderRows, tagRows] = await Promise.all([
    db
      .select({
        id: folders.id,
        name: folders.name,
        count: sql<number>`count(${meetings.id})::int`,
      })
      .from(folders)
      .leftJoin(meetings, eq(meetings.folderId, folders.id))
      .where(eq(folders.organizationId, organizationId))
      .groupBy(folders.id, folders.name)
      .orderBy(folders.name),
    db
      .select({
        name: meetingTags.name,
        count: sql<number>`count(${meetingTagLinks.id})::int`,
      })
      .from(meetingTags)
      .leftJoin(meetingTagLinks, eq(meetingTagLinks.tagId, meetingTags.id))
      .where(eq(meetingTags.organizationId, organizationId))
      .groupBy(meetingTags.id, meetingTags.name)
      .orderBy(meetingTags.name),
  ]);
  return { folders: folderRows, tags: tagRows };
}
