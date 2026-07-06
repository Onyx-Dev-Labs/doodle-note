import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { and, asc, eq, getDb, meetings, notes, transcriptSegments } from "@repo/db";

import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function markdownOf(content: unknown): string | null {
  if (
    content &&
    typeof content === "object" &&
    "markdown" in content &&
    typeof (content as { markdown: unknown }).markdown === "string"
  ) {
    return (content as { markdown: string }).markdown;
  }
  return null;
}

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const personal = await ensurePersonalWorkspace(session.user.id);
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });
  const memberOrgIds = new Set([
    ...organizations.map((org) => org.id),
    personal.id,
  ]);

  const db = getDb();
  const meetingRows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);
  const meeting = meetingRows[0];
  // Only meetings in a workspace this user belongs to.
  if (!meeting || !memberOrgIds.has(meeting.organizationId)) notFound();

  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.meetingId, id))
    .limit(1);
  const note = noteRows[0];
  const enhanced = markdownOf(note?.enhancedContent);
  const raw = markdownOf(note?.rawContent);

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.meetingId, id)))
    .orderBy(asc(transcriptSegments.startMs))
    .limit(5000);

  const when = meeting.startedAt ?? meeting.createdAt;

  return (
    <main className="flex flex-1 flex-col">
      <Link href="/app" className="text-sm text-stone hover:text-ink">
        ← All meetings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        {meeting.title || "Untitled meeting"}
      </h1>
      {when && (
        <p className="mt-1 text-sm text-stone">
          {when.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}

      {(enhanced ?? raw) ? (
        <section className="prose-notes mt-6 rounded-xl border border-sand bg-white p-6">
          <ReactMarkdown>{enhanced ?? raw ?? ""}</ReactMarkdown>
        </section>
      ) : (
        <p className="mt-6 rounded-xl border border-sand bg-card-soft p-6 text-sm text-stone">
          No notes were synced for this meeting.
        </p>
      )}

      {segments.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-ink">Transcript</h2>
          <div className="mt-3 space-y-3 rounded-xl border border-sand bg-card-soft p-5">
            {segments.map((segment) => (
              <p key={segment.id} className="text-sm leading-relaxed">
                <span
                  className={
                    segment.speaker === "You"
                      ? "font-semibold text-sage-deep"
                      : "font-semibold text-ink"
                  }
                >
                  {segment.speaker}
                </span>
                <span className="ml-2 text-xs text-stone">
                  {timestamp(segment.startMs)}
                </span>
                <span className="mt-0.5 block text-bark">{segment.text}</span>
              </p>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
