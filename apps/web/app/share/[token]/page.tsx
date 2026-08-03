import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, getDb, meetings, notes, sql, transcriptSegments } from "@repo/db";

import { MeetingBody } from "../../meeting-body";
import { markdownOf } from "@/lib/meeting-content";
import { navPillClass, SiteHeader, Wordmark } from "../../ui";

export const metadata = { title: "Shared meeting — DoodleNote" };

const TOKEN_RE = /^[0-9a-f]{32}$/;

/** Public, read-only view of a shared meeting. No auth — the token is the key. */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const db = getDb();
  const meetingRows = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.shareToken, token),
        sql`(${meetings.shareExpiresAt} is null or ${meetings.shareExpiresAt} > current_timestamp)`,
      ),
    )
    .limit(1);
  const meeting = meetingRows[0];
  if (!meeting) notFound();

  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.meetingId, meeting.id))
    .limit(1);
  const enhanced = markdownOf(noteRows[0]?.enhancedContent);
  const raw = markdownOf(noteRows[0]?.rawContent);

  const segments = meeting.shareIncludeTranscript
    ? await db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, meeting.id))
        .orderBy(asc(transcriptSegments.startMs))
        .limit(5000)
    : [];

  const when = meeting.startedAt ?? meeting.createdAt;

  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <SiteHeader
        nav={
          <Link href="/" className={navPillClass}>
            Get DoodleNote
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-20 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone">
          Shared meeting notes
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          {meeting.title || "Untitled meeting"}
        </h1>
        {when && (
          <p className="mt-1.5 text-sm text-stone">
            {when.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
        <p className="mt-3 rounded-lg bg-sage-fill px-3 py-2 text-xs text-sage-deep">
          Shared read-only
          {meeting.shareExpiresAt
            ? ` · Link expires ${meeting.shareExpiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : " · Link does not expire"}
          {!meeting.shareIncludeTranscript ? " · Transcript not included" : ""}
        </p>

        <MeetingBody
          markdown={enhanced ?? raw}
          segments={segments}
          emptyText="No notes on this meeting yet."
          showTranscript={meeting.shareIncludeTranscript}
        />
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-6 text-sm text-stone">
          <span>
            Notes taken with{" "}
            <Link href="/" className="font-medium text-sage-deep hover:underline">
              DoodleNote
            </Link>{" "}
            — AI meeting notes without the bot.
          </span>
          <Wordmark size="text-sm" />
        </div>
      </footer>
    </div>
  );
}
