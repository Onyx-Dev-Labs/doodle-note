import { handleSessionReader } from "@/lib/reader-session";
import { getAppWorkspace } from "@/lib/app-workspace";
import { entitlementFor } from "@/lib/billing";
import { handleMobileReader, readerError } from "@/lib/mobile-reader";
import { syncV2Enabled } from "@/lib/sync-v2";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  if (!syncV2Enabled()) return readerError(404, "reader_unavailable");
  try {
    return await handleSessionReader(request, {
      session: async () => {
        const workspace = await getAppWorkspace(request.headers);
        return workspace
          ? {
              userId: workspace.session.user.id,
              activeOrganizationId: workspace.activeOrganization.id,
              organizationIds: workspace.organizations.map((org) => org.id),
            }
          : null;
      },
      entitled: async (userId) => (await entitlementFor(userId)).entitled,
      read: (organizationId) => handleMobileReader(request, organizationId),
    });
  } catch {
    return readerError(503, "reader_unavailable");
  }
}
export { handle as GET, handle as POST };
