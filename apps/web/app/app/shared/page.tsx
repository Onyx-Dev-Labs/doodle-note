import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@repo/db";

import { getAppWorkspace } from "@/lib/app-workspace";
import { entitlementFor } from "@/lib/billing";
import { listMeetingsSharedWithUser } from "@/lib/meeting-recipients";
import { resolveAuthEmailEnabled } from "@/lib/runtime-config";

export const metadata = { title: "Shared with me — DoodleNote" };

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

/**
 * Meetings other people shared with the signed-in user by email, across every
 * workspace. Lists only the shared meetings themselves — never the owner's
 * folders, tags, or other meetings. Owners find their own public links at
 * /app?shared=1.
 */
export default async function SharedWithMePage() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  const identity = workspace.session.user;

  const [rows, entitlement] = await Promise.all([
    listMeetingsSharedWithUser(getDb(), {
      identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified },
      requireVerifiedEmail: resolveAuthEmailEnabled(),
    }),
    entitlementFor(identity.id),
  ]);

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone">View only</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">Shared with me</h1>
        </div>
        <span className="rounded-full border border-sand bg-card px-3 py-1 text-xs text-stone">
          {rows.length} {rows.length === 1 ? "meeting" : "meetings"}
        </span>
      </div>

      {!entitlement.entitled && rows.length > 0 && (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Opening meetings shared with you needs an active DoodleNote plan.{" "}
          <Link href="/pricing" className="font-medium underline">See plans</Link>
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-sand bg-card-soft px-6 py-12 text-center">
          <p className="font-hand text-3xl text-stone">nothing shared with you yet</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-bark">
            When someone shares a meeting with {identity.email}, it appears here.
          </p>
        </div>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
          {rows.map((meeting) => {
            const when = meeting.startedAt ?? meeting.createdAt;
            const durationMin =
              meeting.startedAt && meeting.endedAt
                ? Math.max(1, Math.round((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 60_000))
                : null;
            return (
              <li key={meeting.meetingId} className="border-b border-sand p-2 last:border-b-0">
                <Link
                  href={`/app/meeting/${meeting.meetingId}`}
                  className="group block rounded-lg px-2 py-2 transition-colors hover:bg-sage-fill/50 focus-visible:outline-2 focus-visible:outline-sage-deep sm:flex sm:items-center sm:justify-between sm:gap-5"
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
                  <span className="mt-2 block truncate text-xs text-stone sm:mt-0 sm:max-w-64 sm:text-right">
                    Shared by {meeting.sharedByEmail}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-sm text-stone">
        Looking for meetings you shared by public link?{" "}
        <Link href="/app?shared=1" className="font-medium text-sage-deep hover:underline">
          View your shared links →
        </Link>
      </p>
    </main>
  );
}
