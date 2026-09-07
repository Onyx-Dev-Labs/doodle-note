import { adoptLegacy, discoverLegacy, legacySyncAvailable, type Db } from '@repo/db';
import { decodeReaderCursor, encodeReaderCursor } from './reader-cursor';
import { readBoundedJSON } from './sync-v2';

export async function handleLegacySync(request: Request, db: Db, organizationId: string) {
  const headers = {'Cache-Control':'private, no-store, max-age=0', Vary:'Authorization'};
  if (!(await legacySyncAvailable(db))) return Response.json({error:'adoption_unavailable'}, {status:503, headers});
  if (request.method === 'POST') {
    const receipt=await adoptLegacy(db, organizationId, await readBoundedJSON(request));
    return Response.json(receipt, {headers});
  }
  const url=new URL(request.url);
  const after=url.searchParams.has('cursor')
    ? decodeReaderCursor(organizationId, 'legacy-discovery', url.searchParams.get('cursor')!) : undefined;
  const result=await discoverLegacy(db, organizationId, after);
  return Response.json({...result, next:result.next ? encodeReaderCursor(organizationId,'legacy-discovery',result.next):null}, {headers});
}
