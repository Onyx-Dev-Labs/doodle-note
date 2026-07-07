import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, getDb, meetings, notes, transcriptSegments } from "@repo/db";

import { auth } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";
import { markdownOf, MeetingBody } from "../../../meeting-body";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
        {meeting.title || "Untitled meeting"}
      </h1>
      {when && (
        <p className="mt-1.5 text-sm text-stone">
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

      <MeetingBody
        markdown={enhanced ?? raw}
        segments={segments}
        emptyText="No notes were synced for this meeting."
      />
    </main>
  );
}
