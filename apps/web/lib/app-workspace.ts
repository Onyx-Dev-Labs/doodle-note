import "server-only";

import { auth } from "./auth";
import { ensurePersonalWorkspace } from "./workspace";

export async function getAppWorkspace(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const personal = await ensurePersonalWorkspace(session.user.id);
  const listed = await auth.api.listOrganizations({ headers: requestHeaders });
  const byId = new Map<
    string,
    { id: string; name: string; slug: string }
  >(
    listed.map((organization) => [
      organization.id,
      {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
    ]),
  );
  if (!byId.has(personal.id)) byId.set(personal.id, personal);

  const organizations = [...byId.values()].sort((a, b) => {
    if (a.id === personal.id) return -1;
    if (b.id === personal.id) return 1;
    return a.name.localeCompare(b.name);
  });
  const activeOrganization =
    organizations.find(
      (organization) =>
        organization.id === session.session.activeOrganizationId,
    ) ?? personal;

  return { session, personal, organizations, activeOrganization };
}
