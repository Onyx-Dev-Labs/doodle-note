"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export function WorkspacesPanel({
  userEmail,
  activeOrganizationId,
  organizations,
}: {
  userEmail: string;
  activeOrganizationId: string | null;
  organizations: Workspace[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSetActive(organizationId: string) {
    setError(null);
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) {
      setError(result.error.message ?? "Could not switch workspace");
      return;
    }
    router.refresh();
  }

  return (
    <main className="flex flex-1 flex-col">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Workspaces
      </h1>
      <p className="mt-1 text-sm text-stone">
        Signed in as {userEmail}. The active workspace scopes your meetings
        and notes.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {organizations.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-sand bg-card-soft px-4 py-6 text-center text-sm text-stone">
          No workspaces yet — create your first one below.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-sand rounded-xl border border-sand bg-white">
          {organizations.map((org) => {
            const isActive = org.id === activeOrganizationId;
            return (
              <li
                key={org.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {org.name}
                  </p>
                  <p className="truncate text-xs text-stone">{org.slug}</p>
                </div>
                {isActive ? (
                  <span className="rounded-full bg-sage-fill px-2.5 py-0.5 text-xs font-medium text-sage-deep">
                    Active
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetActive(org.id)}
                    className="rounded-md border border-sand bg-white px-2.5 py-1 text-xs text-ink transition-colors hover:bg-sage-fill"
                  >
                    Set active
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-dashed border-sand bg-card-soft px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">Team workspaces</span>
          <span className="rounded-full bg-sage-fill px-2 py-0.5 text-xs font-medium text-sage-deep">
            coming soon
          </span>
        </div>
        <p className="mt-1 text-sm text-stone">
          Invite your team to a shared meeting library — everyone&rsquo;s
          synced meetings, searchable in one place.
        </p>
      </div>
    </main>
  );
}
