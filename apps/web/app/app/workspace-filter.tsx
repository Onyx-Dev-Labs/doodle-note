import Link from "next/link";

export interface WorkspaceFilterOption {
  id: string;
  name: string;
  personal: boolean;
}

/**
 * Workspace pills above the library (DEV-488). Only rendered for users with
 * more than one workspace; switching here filters the list via `?workspace=`
 * and never changes the active workspace. Space and tag params are dropped
 * because they belong to a single workspace.
 */
export function WorkspaceFilter({
  basePath,
  workspaces,
  selectedId,
  preserve,
}: {
  basePath: string;
  workspaces: WorkspaceFilterOption[];
  selectedId: string | null;
  preserve: Record<string, string | undefined>;
}) {
  if (workspaces.length < 2) return null;

  function href(workspaceId: string | null) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preserve)) {
      if (value) params.set(key, value);
    }
    if (workspaceId) params.set("workspace", workspaceId);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep ${
      active
        ? "border-ink bg-ink text-cream"
        : "border-sand bg-card text-bark hover:bg-sage-fill hover:text-ink"
    }`;

  return (
    <nav aria-label="Workspaces" className="mt-5 flex items-center gap-1.5 overflow-x-auto pb-1">
      <Link href={href(null)} aria-current={selectedId === null ? "page" : undefined} className={pill(selectedId === null)}>
        All workspaces
      </Link>
      {workspaces.map((workspace) => (
        <Link
          key={workspace.id}
          href={href(workspace.id)}
          aria-current={selectedId === workspace.id ? "page" : undefined}
          className={pill(selectedId === workspace.id)}
        >
          {workspace.personal ? "Personal" : workspace.name}
        </Link>
      ))}
      <Link
        href="/app/settings/workspace#create-team"
        className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-sage-deep hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep"
      >
        + New team
      </Link>
    </nav>
  );
}
