/**
 * The slug prefix that marks a user's private Personal workspace. Only
 * `ensurePersonalWorkspace` may mint these; user-created workspaces must never
 * use it, or they could be mistaken for (and treated as) someone's private space.
 */
export const PERSONAL_SLUG_PREFIX = "personal-";

export function isPersonalWorkspaceSlug(slug: string | null | undefined): boolean {
  return (slug ?? "").trim().toLowerCase().startsWith(PERSONAL_SLUG_PREFIX);
}
