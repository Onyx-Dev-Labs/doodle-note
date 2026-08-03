"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { buttonPrimary, inputClass } from "../../../ui";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
}

export function WorkspacePanel({
  activeOrganizationId,
  organizations,
}: {
  activeOrganizationId: string;
  organizations: Workspace[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setActive(organizationId: string) {
    setError(null);
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) {
      setError(result.error.message ?? "Could not switch workspace");
      return;
    }
    router.refresh();
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName) return;
    setError(null);
    setPending(true);
    const slugBase = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "workspace";
    const result = await authClient.organization.create({
      name: workspaceName,
      slug: `${slugBase}-${crypto.randomUUID().slice(0, 6)}`,
    });
    setPending(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not create the workspace");
      return;
    }
    await authClient.organization.setActive({ organizationId: result.data.id });
    setName("");
    router.refresh();
  }

  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">Workspace</h2>
      <p className="mt-1 text-sm leading-relaxed text-stone">Personal is private. Team workspaces are shared with their members; meetings only enter one when you deliberately move or sync them there.</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <ul className="mt-5 overflow-hidden rounded-xl border border-sand bg-card">
        {organizations.map((organization) => {
          const active = organization.id === activeOrganizationId;
          return (
            <li key={organization.id} className="flex items-center justify-between gap-4 border-b border-sand p-4 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{organization.name}</p>
                <p className="mt-0.5 text-xs text-stone">{organization.personal ? "Private to you" : "Shared with workspace members"}</p>
              </div>
              {active ? (
                <span className="rounded-full bg-sage-fill px-2.5 py-1 text-xs font-medium text-sage-deep">Active</span>
              ) : (
                <button type="button" onClick={() => void setActive(organization.id)} className="shrink-0 rounded-lg border border-sand px-3 py-2 text-sm font-medium text-ink hover:bg-sage-fill">Switch</button>
              )}
            </li>
          );
        })}
      </ul>

      <form onSubmit={createWorkspace} className="mt-8 rounded-xl border border-sand bg-card p-4">
        <h3 className="font-display text-base font-semibold text-ink">Create a team workspace</h3>
        <label className="mt-3 block text-xs font-medium text-bark" htmlFor="workspace-name">Workspace name</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Acme team" className={inputClass} />
          <button type="submit" disabled={pending || !name.trim()} className={`shrink-0 ${buttonPrimary}`}>{pending ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </section>
  );
}
