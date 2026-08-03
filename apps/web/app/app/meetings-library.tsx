import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  folders,
  getDb,
  ilike,
  meetings,
  meetingTagLinks,
  meetingTags,
  notes,
  or,
  sql,
  transcriptSegments,
} from "@repo/db";

import { getAppWorkspace } from "@/lib/app-workspace";
import { inputClass } from "../ui";
import { MeetingStarButton } from "./meeting-star-button";

export interface LibrarySearchParams {
  q?: string;
  space?: string;
  type?: string;
  date?: string;
  person?: string;
  tag?: string;
  starred?: string;
  shared?: string;
}

function formatWhen(date: Date | null): string {
  if (!date) return "Date unavailable";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function withQuery(
  pathname: string,
  entries: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function MeetingsLibrary({
  searchParams,
  sharedOnly = false,
}: {
  searchParams: LibrarySearchParams;
  sharedOnly?: boolean;
}) {
  const requestHeaders = await headers();
  const workspace = await getAppWorkspace(requestHeaders);
  if (!workspace) redirect("/login");

  const query = (searchParams.q ?? "").trim().slice(0, 200);
  const space = (searchParams.space ?? "").slice(0, 80);
  const kind = ["meeting", "note"].includes(searchParams.type ?? "")
    ? searchParams.type!
    : "";
  const date = ["7", "30"].includes(searchParams.date ?? "")
    ? searchParams.date!
    : "";
  const person = (searchParams.person ?? "").trim().slice(0, 80);
  const tag = (searchParams.tag ?? "").trim().slice(0, 32);
  const starred = searchParams.starred === "1";
  const shared = sharedOnly || searchParams.shared === "1";
  const pathname = sharedOnly ? "/app/shared" : "/app";
  const db = getDb();
  const scope = eq(meetings.organizationId, workspace.activeOrganization.id);
  const conditions = [scope];

  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(meetings.title, pattern),
        sql`${notes.rawContent}->>'markdown' ilike ${pattern}`,
        sql`${notes.enhancedContent}->>'markdown' ilike ${pattern}`,
        sql`exists (select 1 from transcript_segments ts where ts.meeting_id = ${meetings.id} and ts.text ilike ${pattern})`,
      )!,
    );
  }
  if (space === "unfiled") conditions.push(sql`${meetings.folderId} is null`);
  else if (/^[0-9a-f-]{36}$/i.test(space)) conditions.push(eq(meetings.folderId, space));
  if (kind) conditions.push(eq(meetings.kind, kind as "meeting" | "note"));
  if (date) {
    conditions.push(
      sql`coalesce(${meetings.startedAt}, ${meetings.createdAt}) >= current_timestamp - (${Number(date)} * interval '1 day')`,
    );
  }
  if (person) {
    conditions.push(
      sql`exists (select 1 from transcript_segments tsp where tsp.meeting_id = ${meetings.id} and tsp.speaker = ${person})`,
    );
  }
  if (tag) {
    conditions.push(
      sql`exists (select 1 from meeting_tag_links mtl join meeting_tags mt on mt.id = mtl.tag_id where mtl.meeting_id = ${meetings.id} and mt.organization_id = ${workspace.activeOrganization.id} and mt.name = ${tag})`,
    );
  }
  if (starred) {
    conditions.push(
      sql`exists (select 1 from meeting_stars ms where ms.meeting_id = ${meetings.id} and ms.user_id = ${workspace.session.user.id})`,
    );
  }
  if (shared) conditions.push(sql`${meetings.shareToken} is not null`);

  const [rows, folderRows, tagRows, participantRows] = await Promise.all([
    db
      .select({
        id: meetings.id,
        title: meetings.title,
        kind: meetings.kind,
        status: meetings.status,
        folderId: meetings.folderId,
        shareToken: meetings.shareToken,
        shareExpired: sql<boolean>`${meetings.shareExpiresAt} is not null and ${meetings.shareExpiresAt} <= current_timestamp`,
        startedAt: meetings.startedAt,
        createdAt: meetings.createdAt,
        endedAt: meetings.endedAt,
        hasNotes: sql<boolean>`${notes.id} is not null`,
        isStarred: sql<boolean>`exists (select 1 from meeting_stars ms where ms.meeting_id = ${meetings.id} and ms.user_id = ${workspace.session.user.id})`,
        tags: sql<string>`coalesce((select string_agg(mt.name, ', ' order by mt.name) from meeting_tag_links mtl join meeting_tags mt on mt.id = mtl.tag_id where mtl.meeting_id = ${meetings.id}), '')`,
      })
      .from(meetings)
      .leftJoin(notes, eq(notes.meetingId, meetings.id))
      .where(and(...conditions))
      .orderBy(desc(sql`coalesce(${meetings.startedAt}, ${meetings.createdAt})`))
      .limit(300),
    db
      .select({
        id: folders.id,
        name: folders.name,
        count: sql<number>`count(${meetings.id})::int`,
      })
      .from(folders)
      .leftJoin(meetings, eq(meetings.folderId, folders.id))
      .where(eq(folders.organizationId, workspace.activeOrganization.id))
      .groupBy(folders.id, folders.name)
      .orderBy(folders.name),
    db
      .select({
        name: meetingTags.name,
        count: sql<number>`count(${meetingTagLinks.id})::int`,
      })
      .from(meetingTags)
      .leftJoin(meetingTagLinks, eq(meetingTagLinks.tagId, meetingTags.id))
      .where(eq(meetingTags.organizationId, workspace.activeOrganization.id))
      .groupBy(meetingTags.id, meetingTags.name)
      .orderBy(meetingTags.name),
    db
      .select({ speaker: transcriptSegments.speaker })
      .from(transcriptSegments)
      .innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
      .where(scope)
      .groupBy(transcriptSegments.speaker)
      .orderBy(transcriptSegments.speaker)
      .limit(30),
  ]);

  const totalCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(scope);
  const activeFilters = Boolean(
    query || space || kind || date || person || tag || starred || (shared && !sharedOnly),
  );

  return (
    <main className="grid flex-1 gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone">
            {workspace.activeOrganization.name}
          </p>
          <nav aria-label="Meeting spaces" className="mt-3 space-y-1">
            <Link
              href={pathname}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                !space && !starred && !shared
                  ? "bg-sage-fill font-medium text-ink"
                  : "text-bark hover:bg-card"
              }`}
            >
              <span>All meetings</span>
              <span className="text-xs text-stone">{totalCount[0]?.count ?? 0}</span>
            </Link>
            <Link
              href={withQuery(pathname, { starred: "1" })}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                starred ? "bg-sage-fill font-medium text-ink" : "text-bark hover:bg-card"
              }`}
            >
              <span aria-hidden="true">☆</span> Starred
            </Link>
            {!sharedOnly && (
              <Link
                href={withQuery(pathname, { shared: "1" })}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  shared ? "bg-sage-fill font-medium text-ink" : "text-bark hover:bg-card"
                }`}
              >
                <span aria-hidden="true">↗</span> Shared links
              </Link>
            )}
          </nav>

          <p className="mt-7 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone">
            Spaces
          </p>
          <nav aria-label="Folders" className="mt-2 space-y-1">
            <Link
              href={withQuery(pathname, { space: "unfiled" })}
              className={`block rounded-lg px-3 py-2 text-sm ${
                space === "unfiled" ? "bg-sage-fill font-medium text-ink" : "text-bark hover:bg-card"
              }`}
            >
              Unfiled
            </Link>
            {folderRows.map((folder) => (
              <Link
                key={folder.id}
                href={withQuery(pathname, { space: folder.id })}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  space === folder.id ? "bg-sage-fill font-medium text-ink" : "text-bark hover:bg-card"
                }`}
              >
                <span className="truncate">{folder.name}</span>
                <span className="text-xs text-stone">{folder.count}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-8 rounded-xl border border-sand bg-card-soft p-3">
            <p className="text-xs font-medium text-ink">Cloud copy</p>
            <p className="mt-1 text-xs leading-relaxed text-stone">
              Meetings in this library are synced. Manage linked devices in
              settings.
            </p>
            <Link
              href="/app/settings/sync"
              className="mt-2 inline-block text-xs font-medium text-sage-deep hover:underline"
            >
              View sync status →
            </Link>
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone">
              {workspace.activeOrganization.id === workspace.personal.id
                ? "Private to you"
                : "Shared workspace"}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">
              {sharedOnly ? "Shared meetings" : "Meetings"}
            </h1>
          </div>
          <span className="rounded-full border border-sand bg-card px-3 py-1 text-xs text-stone">
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </span>
        </div>

        <form method="get" className="mt-6 rounded-xl border border-sand bg-card p-3">
          <label className="block text-xs font-medium text-bark" htmlFor="meeting-search">
            Search meetings
          </label>
          <input
            id="meeting-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Titles, notes, and transcripts"
            className={`mt-1 ${inputClass}`}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-xs font-medium text-bark">
              Type
              <select name="type" defaultValue={kind} className={`mt-1 ${inputClass}`}>
                <option value="">All types</option>
                <option value="meeting">Meetings</option>
                <option value="note">Quick notes</option>
              </select>
            </label>
            <label className="text-xs font-medium text-bark">
              Date
              <select name="date" defaultValue={date} className={`mt-1 ${inputClass}`}>
                <option value="">Any time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
            <label className="text-xs font-medium text-bark">
              Participant
              <select name="person" defaultValue={person} className={`mt-1 ${inputClass}`}>
                <option value="">Anyone</option>
                {participantRows.map(({ speaker }) => (
                  <option key={speaker} value={speaker}>{speaker}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-bark">
              Tag
              <select name="tag" defaultValue={tag} className={`mt-1 ${inputClass}`}>
                <option value="">Any tag</option>
                {tagRows.map((row) => (
                  <option key={row.name} value={row.name}>{row.name} ({row.count})</option>
                ))}
              </select>
            </label>
          </div>
          {space && <input type="hidden" name="space" value={space} />}
          {starred && <input type="hidden" name="starred" value="1" />}
          {shared && !sharedOnly && <input type="hidden" name="shared" value="1" />}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep"
            >
              Apply filters
            </button>
            {activeFilters && (
              <Link href={pathname} className="text-sm text-stone hover:text-ink hover:underline">
                Clear
              </Link>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="mt-14 rounded-2xl border border-dashed border-sand bg-card-soft px-6 py-12 text-center">
            <p className="font-hand text-3xl text-stone">
              {activeFilters ? "nothing matches that view" : "nothing jotted here yet"}
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-bark">
              {activeFilters
                ? "Try clearing a filter or searching a different phrase."
                : "Connect a DoodleNote device and your meetings, transcripts, and notes will appear here."}
            </p>
            {!activeFilters && (
              <Link
                href="/app/settings/sync"
                className="mt-5 inline-block rounded-lg border border-sand bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-sage-fill"
              >
                Set up cloud sync
              </Link>
            )}
          </div>
        ) : (
          <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
            {rows.map((meeting) => {
              const when = meeting.startedAt ?? meeting.createdAt;
              const durationMin =
                meeting.startedAt && meeting.endedAt
                  ? Math.max(1, Math.round((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 60_000))
                  : null;
              const tags = meeting.tags ? meeting.tags.split(", ").filter(Boolean) : [];
              const expired = meeting.shareExpired;
              return (
                <li key={meeting.id} className="flex items-center gap-2 border-b border-sand p-2 last:border-b-0">
                  <MeetingStarButton meetingId={meeting.id} starred={meeting.isStarred} />
                  <Link
                    href={`/app/meeting/${meeting.id}`}
                    className="group min-w-0 flex-1 rounded-lg px-2 py-2 transition-colors hover:bg-sage-fill/50 focus-visible:outline-2 focus-visible:outline-sage-deep sm:flex sm:items-center sm:justify-between sm:gap-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-sage-deep">
                        {meeting.title || "Untitled meeting"}
                      </span>
                      <span className="mt-1 block text-xs text-stone">
                        {formatWhen(when)}
                        {durationMin ? ` · ${durationMin} min` : ""}
                        {meeting.kind === "note" ? " · Quick note" : ""}
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:justify-end">
                      {tags.slice(0, 3).map((meetingTag) => (
                        <span key={meetingTag} className="rounded-full bg-card-soft px-2 py-0.5 text-[11px] text-stone">
                          {meetingTag}
                        </span>
                      ))}
                      {meeting.hasNotes && (
                        <span className="rounded-full bg-sage-fill px-2 py-0.5 text-[11px] font-medium text-sage-deep">Notes</span>
                      )}
                      {meeting.shareToken && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${expired ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"}`}>
                          {expired ? "Share expired" : "Shared"}
                        </span>
                      )}
                      <span className="rounded-full bg-card-soft px-2 py-0.5 text-[11px] text-stone">Synced</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
