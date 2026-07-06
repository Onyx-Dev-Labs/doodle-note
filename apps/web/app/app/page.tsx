import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, getDb, ilike, meetings, notes, or, sql } from "@repo/db";

import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";

export const metadata = { title: "Meetings — DoodleNote" };

function formatWhen(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 200);
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const personal = await ensurePersonalWorkspace(session.user.id);
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });
  const activeOrg =
    organizations.find(
      (org) => org.id === session.session.activeOrganizationId,
    ) ??
    organizations[0] ??
    personal;

  const db = getDb();
  const pattern = `%${query}%`;
  const scope = eq(meetings.organizationId, activeOrg.id);
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
      endedAt: meetings.endedAt,
      hasNotes: sql<boolean>`${notes.id} is not null`,
    })
    .from(meetings)
    .leftJoin(notes, eq(notes.meetingId, meetings.id))
    .where(
      query.length === 0
        ? scope
        : and(
            scope,
            or(
              ilike(meetings.title, pattern),
              sql`${notes.rawContent}->>'markdown' ilike ${pattern}`,
              sql`${notes.enhancedContent}->>'markdown' ilike ${pattern}`,
              sql`exists (select 1 from transcript_segments ts where ts.meeting_id = ${meetings.id} and ts.text ilike ${pattern})`,
            ),
          ),
    )
    .orderBy(desc(sql`coalesce(${meetings.startedAt}, ${meetings.createdAt})`))
    .limit(200);

  return (
    <main className="flex flex-1 flex-col">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Meetings
        </h1>
        <span className="text-sm text-stone">{activeOrg.name}</span>
      </div>

      <form method="get" className="mt-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search titles, notes, and transcripts…"
          className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-stone focus:border-sage"
        />
      </form>

      {rows.length === 0 && query.length > 0 ? (
        <p className="mt-8 rounded-xl border border-sand bg-card-soft p-6 text-center text-sm text-stone">
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-10 rounded-xl border border-sand bg-card-soft p-8 text-center">
          <h2 className="text-base font-semibold text-ink">
            No meetings synced yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-bark">
            Open DoodleNote on your Mac and turn on{" "}
            <strong>Settings → Sync with cloud</strong>. Your meetings,
            transcripts, and notes will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-sand rounded-xl border border-sand bg-white">
          {rows.map((meeting) => {
            const when = meeting.startedAt ?? meeting.createdAt;
            const durationMin =
              meeting.startedAt && meeting.endedAt
                ? Math.max(
                    1,
                    Math.round(
                      (meeting.endedAt.getTime() -
                        meeting.startedAt.getTime()) /
                        60_000,
                    ),
                  )
                : null;
            return (
              <li key={meeting.id}>
                <Link
                  href={`/app/meeting/${meeting.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-sage-fill/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {meeting.title || "Untitled meeting"}
                    </p>
                    <p className="mt-0.5 text-xs text-stone">
                      {formatWhen(when)}
                      {durationMin ? ` · ${durationMin} min` : ""}
                    </p>
                  </div>
                  {meeting.hasNotes && (
                    <span className="shrink-0 rounded-full bg-sage-fill px-2.5 py-0.5 text-xs font-medium text-sage-deep">
                      Notes
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
