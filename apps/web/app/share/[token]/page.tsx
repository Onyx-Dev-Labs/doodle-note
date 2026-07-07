import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { asc, eq, getDb, meetings, notes, transcriptSegments } from "@repo/db";

export const metadata = { title: "Shared meeting — DoodleNote" };

const TOKEN_RE = /^[0-9a-f]{32}$/;

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
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

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
    .where(eq(meetings.shareToken, token))
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

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(asc(transcriptSegments.startMs))
    .limit(5000);

  const when = meeting.startedAt ?? meeting.createdAt;

  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="border-b border-sand bg-card-soft">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/mascot.png" alt="" width={26} height={26} className="rounded-md" />
            <span className="text-sm font-bold tracking-tight">
              <span className="text-ink">Doodle</span>
              <span className="text-sage">Note</span>
            </span>
          </Link>
          <span className="text-xs text-stone">Shared meeting notes</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {meeting.title || "Untitled meeting"}
        </h1>
        {when && (
          <p className="mt-1 text-sm text-stone">
            {when.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}

        {(enhanced ?? raw) ? (
          <section className="prose-notes mt-6 rounded-xl border border-sand bg-card p-6">
            <ReactMarkdown>{enhanced ?? raw ?? ""}</ReactMarkdown>
          </section>
        ) : (
          <p className="mt-6 rounded-xl border border-sand bg-card-soft p-6 text-sm text-stone">
            No notes on this meeting yet.
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
                  <span className="ml-2 text-xs text-stone">{timestamp(segment.startMs)}</span>
                  <span className="mt-0.5 block text-bark">{segment.text}</span>
                </p>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-sand">
        <div className="mx-auto w-full max-w-3xl px-6 py-5 text-sm text-stone">
          Notes taken with{" "}
          <Link href="/" className="font-semibold text-sage-deep hover:underline">
            DoodleNote
          </Link>{" "}
          — AI meeting notes without the bot.
        </div>
      </footer>
    </div>
  );
}
