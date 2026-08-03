import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  and,
  asc,
  eq,
  folders,
  getDb,
  inArray,
  meetings,
  meetingTagLinks,
  meetingTags,
  notes,
  transcriptSegments,
} from "@repo/db";

import { getAppWorkspace } from "@/lib/app-workspace";
import { markdownOf } from "@/lib/meeting-content";
import { MeetingBody } from "../../../meeting-body";
import { MeetingActions } from "./meeting-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const requestHeaders = await headers();
  const workspace = await getAppWorkspace(requestHeaders);
  if (!workspace) redirect("/login");
  const memberOrgIds = workspace.organizations.map((organization) => organization.id);

  const db = getDb();
  const meetingRows = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  const meeting = meetingRows[0];
  if (!meeting || !memberOrgIds.includes(meeting.organizationId)) notFound();

  const [noteRows, segments, tagRows, folderRows] = await Promise.all([
    db.select().from(notes).where(eq(notes.meetingId, id)).limit(1),
    db.select().from(transcriptSegments).where(and(eq(transcriptSegments.meetingId, id))).orderBy(asc(transcriptSegments.startMs)).limit(5000),
    db
      .select({ name: meetingTags.name })
      .from(meetingTagLinks)
      .innerJoin(meetingTags, eq(meetingTags.id, meetingTagLinks.tagId))
      .where(eq(meetingTagLinks.meetingId, id))
      .orderBy(meetingTags.name),
    memberOrgIds.length > 0
      ? db.select({ id: folders.id, organizationId: folders.organizationId, name: folders.name }).from(folders).where(inArray(folders.organizationId, memberOrgIds)).orderBy(folders.name)
      : Promise.resolve([]),
  ]);
  const enhanced = markdownOf(noteRows[0]?.enhancedContent);
  const raw = markdownOf(noteRows[0]?.rawContent);
  const markdown = enhanced ?? raw;
  const when = meeting.startedAt ?? meeting.createdAt;
  const meetingOrganization = workspace.organizations.find((organization) => organization.id === meeting.organizationId);

  return (
    <main className="flex flex-1 flex-col">
      <Link href="/app" className="w-fit rounded-md text-sm text-stone hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">← All meetings</Link>
      <div className="mt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meeting.organizationId === workspace.personal.id ? "bg-sage-fill text-sage-deep" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"}`}>
              {meeting.organizationId === workspace.personal.id ? "Private" : meetingOrganization?.name ?? "Shared workspace"}
            </span>
            {meeting.shareToken && <span className="rounded-full bg-card px-2.5 py-1 text-xs text-stone">Public link active</span>}
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{meeting.title || "Untitled meeting"}</h1>
          {when && <p className="mt-1.5 text-sm text-stone">{when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
        </div>
      </div>

      <div className="mt-3 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <MeetingBody markdown={markdown} segments={segments} emptyText="No notes were synced for this meeting." interactive />
        <aside className="lg:order-last">
          <MeetingActions
            meetingId={meeting.id}
            title={meeting.title || "Untitled meeting"}
            markdown={markdown}
            segments={segments.map(({ speaker, startMs, text }) => ({ speaker, startMs, text }))}
            shareToken={meeting.shareToken}
            shareExpiresAt={meeting.shareExpiresAt?.toISOString() ?? null}
            shareIncludeTranscript={meeting.shareIncludeTranscript}
            organizationId={meeting.organizationId}
            folderId={meeting.folderId}
            organizations={workspace.organizations.map((organization) => ({ id: organization.id, name: organization.name, personal: organization.id === workspace.personal.id }))}
            folders={folderRows}
            tags={tagRows.map((tag) => tag.name)}
          />
          <div className="mt-4 rounded-xl border border-sand bg-card-soft p-4 text-sm leading-relaxed text-stone">
            <p className="font-medium text-ink">Cloud status</p>
            <p className="mt-1">This is the cloud copy synced from your linked device.</p>
            <Link href="/app/settings/sync" className="mt-2 inline-block font-medium text-sage-deep hover:underline">Manage devices →</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
