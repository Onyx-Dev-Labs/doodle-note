import { getDb } from '@repo/db';
import { authenticateEntitledSyncRequest } from '@/lib/sync-auth';
import { syncV2Enabled } from '@/lib/sync-v2';
import { handleLegacySync } from '@/lib/legacy-sync';
export const dynamic='force-dynamic';
async function handle(request: Request) {
  const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Authorization'};
  if (!syncV2Enabled()) return Response.json({error:'not_found'},{status:404,headers});
  try {
    const auth=await authenticateEntitledSyncRequest(request);
    if(auth.response) {
      for(const [key,value] of Object.entries(headers))auth.response.headers.set(key,value);
      return auth.response;
    }
    return await handleLegacySync(request,getDb(),auth.device.organizationId);
  } catch { return Response.json({error:'legacy_sync_unavailable'},{status:503,headers}); }
}
export {handle as GET,handle as POST};
