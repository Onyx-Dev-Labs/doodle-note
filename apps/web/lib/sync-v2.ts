import { createHmac, timingSafeEqual } from 'node:crypto';
import { applySync, pullSync, SYNC_CAPABILITIES, SYNC_MAX_BYTES, type Db } from '@repo/db';

export function syncV2Enabled(env=process.env): boolean { return env.DOODLENOTE_SYNC_V2_ENABLED==='true'; }
function secret(env=process.env): string {
  const value=env.DOODLENOTE_SYNC_CURSOR_SECRET;
  if(!value||value.length<32) throw new Error('sync_configuration');
  return value;
}
export function encodeCursor(organizationId:string, libraryId:string, after:string, key=secret()) {
  const data=Buffer.from(JSON.stringify({v:2,organizationId,libraryId,after})).toString('base64url');
  return data+'.'+createHmac('sha256',key).update(data).digest('base64url');
}
export function decodeCursor(cursor:string, organizationId:string, libraryId:string, key=secret()):string {
  if(cursor.length>1000)throw new Error('invalid_cursor');
  const [data,signature,...extra]=cursor.split('.');
  const expected=createHmac('sha256',key).update(data).digest();
  const actual=Buffer.from(signature??'','base64url');
  if(extra.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('invalid_cursor');
  const decoded=JSON.parse(Buffer.from(data,'base64url').toString());
  if(decoded.v!==2||decoded.organizationId!==organizationId||decoded.libraryId!==libraryId||!/^\d{1,16}$/.test(decoded.after))throw new Error('invalid_cursor');
  return decoded.after;
}
export async function readBoundedJSON(request:Request) {
  const reader=request.body?.getReader(); if(!reader)throw new Error('invalid_body');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;) { const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>SYNC_MAX_BYTES){await reader.cancel();throw new Error('payload_limit');}chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function handleSyncV2(request:Request, db:Db, organizationId:string) {
  // Validate configuration before data mutations, including empty-cursor requests.
  const key=secret();
  const url=new URL(request.url);
  if(request.method==='GET' && !url.searchParams.has('libraryId')) return Response.json({protocolVersion:2,capabilities:SYNC_CAPABILITIES,maxBatchItems:20,maxPayloadBytes:SYNC_MAX_BYTES});
  if(request.method==='GET') {
    const libraryId=url.searchParams.get('libraryId')!;
    let after='0';
    try { if(url.searchParams.has('cursor')) after=decodeCursor(url.searchParams.get('cursor')!,organizationId,libraryId,key); }
    catch { return Response.json({error:'invalid_cursor'},{status:400}); }
    try {
      const result=await pullSync(db,organizationId,libraryId,after);
      return Response.json({protocolVersion:2,...result,cursor:encodeCursor(organizationId,libraryId,result.after,key)});
    } catch { return Response.json({error:'invalid_library_or_cursor'},{status:400}); }
  }
  let body:unknown;
  try { body=await readBoundedJSON(request); } catch { return Response.json({error:'invalid_or_oversized_body'},{status:400}); }
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='operations'))return Response.json({error:'invalid_batch'},{status:400});
  const operations=(body as {operations?:unknown}).operations;
  if(!Array.isArray(operations)||operations.length<1||operations.length>20)return Response.json({error:'invalid_batch'},{status:400});
  const results=[];
  for(let index=0;index<operations.length;index++) {
    try {results.push({index,receipt:await applySync(db,organizationId,operations[index])});}
    catch {results.push({index,error:'invalid_or_rejected_operation'});}
  }
  return Response.json({protocolVersion:2,results});
}
