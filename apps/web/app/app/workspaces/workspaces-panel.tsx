"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    setPending(true);
    const result = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create workspace");
      return;
    }
    setNewName("");
    router.refresh();
  }

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

      <form onSubmit={handleCreate} className="mt-4 flex items-start gap-2">
        <div className="flex-1">
          <input
            type="text"
            placeholder="New workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-stone focus:border-sage"
          />
          {newName.trim() && (
            <p className="mt-1 text-xs text-stone">slug: {slugify(newName)}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending || !newName.trim()}
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </form>
    </main>
  );
}
