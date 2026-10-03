import { authenticateEntitledSyncRequest } from "@/lib/sync-auth";
import {
  handleMobileReader,
  readerError,
  readerHeaders,
} from "@/lib/mobile-reader";
import { syncV2Enabled } from "@/lib/sync-v2";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  if (!syncV2Enabled()) return readerError(404, "reader_unavailable");
  try {
    const auth = await authenticateEntitledSyncRequest(request);
    if (auth.response) {
      for (const [k, v] of Object.entries(readerHeaders))
        auth.response.headers.set(k, v);
      return auth.response;
    }
    return await handleMobileReader(request, auth.device.organizationId);
  } catch {
    return readerError(503, "reader_unavailable");
  }
}
export { handle as GET, handle as POST };
