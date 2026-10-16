import Link from "next/link";

/**
 * Empty library for a team workspace that has no meetings yet (DEV-488).
 * Meetings are created in a workspace by devices linked to it (or imports);
 * existing meetings are never moved between workspaces.
 */
export function TeamWorkspaceEmptyState({ name }: { name: string }) {
  return (
    <div className="mt-14 rounded-2xl border border-dashed border-sand bg-card-soft px-6 py-12 text-center">
      <p className="font-hand text-3xl text-stone">no meetings in {name} yet</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-bark">
        Meetings appear here when a DoodleNote device linked to {name} records
        or imports them — pick {name} as the workspace when you connect the
        desktop app to the cloud. Meetings already in Personal or another
        workspace stay where they are; they are not moved here.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/app/settings/sync"
          className="inline-block rounded-lg border border-sand bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-sage-fill"
        >
          Sync &amp; devices
        </Link>
        <Link
          href="/app/settings/workspace"
          className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-sage-deep hover:underline"
        >
          Manage team &amp; invites
        </Link>
      </div>
    </div>
  );
}
