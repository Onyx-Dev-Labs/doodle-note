"use client";

import Link from "next/link";
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

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Doodle Note
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">
            {userEmail}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-neutral-300 px-3 py-1.5 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Teams you belong to. The active workspace scopes your meetings and
            notes.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {organizations.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            No workspaces yet — create your first one below.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {organizations.map((org) => {
              const isActive = org.id === activeOrganizationId;
              return (
                <li
                  key={org.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{org.name}</p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {org.slug}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                      Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSetActive(org.id)}
                      className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Set active
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleCreate} className="flex items-start gap-2">
          <div className="flex-1">
            <input
              type="text"
              placeholder="New workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-500 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-400"
            />
            {newName.trim() && (
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                slug: {slugify(newName)}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={pending || !newName.trim()}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pending ? "Creating…" : "Create"}
          </button>
        </form>
      </section>
    </main>
  );
}
