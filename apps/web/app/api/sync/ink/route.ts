import { getDb } from "@repo/db";
import { authenticateEntitledSyncRequest } from "@/lib/sync-auth";
import { handlePrivateInk } from "@/lib/private-ink";
import { privateInkEnabled, privateInkStore } from "@/lib/private-ink-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function handle(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
  if (!privateInkEnabled())
    return Response.json({ error: "not_found" }, { status: 404, headers });
  try {
    const auth = await authenticateEntitledSyncRequest(request);
    if (auth.response) {
      for (const [key, value] of Object.entries(headers))
        auth.response.headers.set(key, value);
      return auth.response;
    }
    return await handlePrivateInk(
      request,
      getDb(),
      auth.device.organizationId,
      privateInkStore(),
    );
  } catch {
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers },
    );
  }
}
export { handle as GET, handle as POST, handle as PUT };
