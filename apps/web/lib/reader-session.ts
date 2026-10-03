import { readerError } from "./mobile-reader";
export interface ReaderSession {
  userId: string;
  activeOrganizationId: string;
  organizationIds: string[];
}
/** Membership and entitlement are resolved by server callbacks, never request JSON. */
export async function handleSessionReader(
  request: Request,
  dependencies: {
    session: () => Promise<ReaderSession | null>;
    entitled: (userId: string) => Promise<boolean>;
    read: (organizationId: string) => Promise<Response>;
  },
) {
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return readerError(403, "request_rejected");
  const session = await dependencies.session();
  if (!session) return readerError(401, "sign_in_required");
  if (!(await dependencies.entitled(session.userId)))
    return readerError(402, "sync_subscription_required");
  const org =
    new URL(request.url).searchParams.get("organizationId") ??
    session.activeOrganizationId;
  if (!session.organizationIds.includes(org))
    return readerError(404, "workspace_unavailable");
  return dependencies.read(org);
}
