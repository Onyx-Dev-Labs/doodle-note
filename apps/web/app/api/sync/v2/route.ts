import { getDb } from '@repo/db';
import { authenticateEntitledSyncRequest } from '@/lib/sync-auth';
import { handleSyncV2, syncV2Enabled } from '@/lib/sync-v2';

async function handle(request:Request) {
  // Gate before DB initialization. Deploying source does not activate the protocol.
  if(!syncV2Enabled())return Response.json({error:'protocol_unavailable'},{status:404});
  const auth=await authenticateEntitledSyncRequest(request);
  if(auth.response)return auth.response;
  try { return await handleSyncV2(request,getDb(),auth.device.organizationId); }
  catch { return Response.json({error:'sync_unavailable'},{status:503}); }
}
export const GET=handle;
export const POST=handle;
