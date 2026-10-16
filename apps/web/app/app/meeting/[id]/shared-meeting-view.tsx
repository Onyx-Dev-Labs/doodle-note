import Link from "next/link";

import type { SharedMeetingRead } from "@/lib/meeting-recipients";
import { MeetingBody } from "../../../meeting-body";
import { SharedMeetingActions } from "./shared-meeting-actions";

type VisibleShare = Exclude<SharedMeetingRead, { status: "not_found" }>;

function SharedBy({ name, email }: { name: string; email: string }) {
  return (
    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
      Shared by {name && name !== email ? `${name} (${email})` : email}
    </span>
  );
}

/**
 * The recipient's read-only view of a meeting shared with them. No folders,
 * tags, workspace, sharing, or public-link controls are rendered or loaded.
 */
export function SharedMeetingView({ share }: { share: VisibleShare }) {
  if (share.status !== "ok") {
    return (
      <main className="flex flex-1 flex-col">
        <Link href="/app/shared" className="w-fit rounded-md text-sm text-stone hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">← Shared with me</Link>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SharedBy name={share.sharedByName} email={share.sharedByEmail} />
        </div>
        <section className="mt-6 max-w-xl rounded-2xl border border-sand bg-card p-6">
          {share.status === "needs_subscription" ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Upgrade to open shared meetings</h1>
              <p className="mt-2 text-sm leading-relaxed text-bark">
                This meeting was shared with you. Reading meetings shared with you needs an active DoodleNote plan on your own account.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/pricing" className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream hover:opacity-85">See plans</Link>
                <Link href="/app/settings/billing" className="rounded-lg border border-sand bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-sage-fill">Billing settings</Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Shared meetings are temporarily unavailable</h1>
              <p className="mt-2 text-sm leading-relaxed text-bark">Billing is not configured on this server. Try again later.</p>
            </>
          )}
        </section>
      </main>
    );
  }

  const { meeting } = share;
  const title = meeting.title || "Untitled meeting";
  const when = meeting.startedAt ?? meeting.createdAt;
  return (
    <main className="flex flex-1 flex-col">
      <Link href="/app/shared" className="w-fit rounded-md text-sm text-stone hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">← Shared with me</Link>
      <div className="mt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SharedBy name={share.sharedByName} email={share.sharedByEmail} />
            <span className="rounded-full bg-card px-2.5 py-1 text-xs text-stone">View only</span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
          {when && <p className="mt-1.5 text-sm text-stone">{when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
        </div>
      </div>

      <div className="mt-3 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <MeetingBody
          markdown={share.markdown}
          segments={share.segments}
          emptyText="No notes were synced for this meeting."
          interactive={share.includeTranscript}
          showTranscript={share.includeTranscript}
        />
        <aside className="lg:order-last">
          <SharedMeetingActions
            title={title}
            markdown={share.markdown}
            segments={share.segments.map(({ speaker, startMs, text }) => ({ speaker, startMs, text }))}
          />
          <div className="mt-4 rounded-xl border border-sand bg-card-soft p-4 text-sm leading-relaxed text-stone">
            <p className="font-medium text-ink">Shared with you</p>
            <p className="mt-1">
              {share.includeTranscript
                ? "You can read the notes and transcript."
                : "You can read the notes. The owner did not include the transcript."}{" "}
              Only the owner can edit or share this meeting.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
