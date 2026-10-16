export interface WorkspaceBadgeOption {
  id: string;
  name: string;
  personal: boolean;
}

/**
 * Which workspace a library row belongs to (DEV-488). Pass an empty list when
 * badges are not meaningful (single-workspace users or a filtered view).
 */
export function WorkspaceBadge({
  organizationId,
  workspaces,
}: {
  organizationId: string;
  workspaces: WorkspaceBadgeOption[];
}) {
  const workspace = workspaces.find((option) => option.id === organizationId);
  if (!workspace) return null;
  return (
    <span
      className={`max-w-40 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${
        workspace.personal
          ? "bg-sage-fill text-sage-deep"
          : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
      }`}
      title={workspace.personal ? "Personal workspace — private to you" : `${workspace.name} workspace`}
    >
      {workspace.personal ? "Personal" : workspace.name}
    </span>
  );
}
