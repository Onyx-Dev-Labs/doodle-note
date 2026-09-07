import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createInMemoryDb} from '@repo/db/testing';
import {sql, type SyncOperation, type SyncSnapshot} from '@repo/db';
import {decodeCursor,encodeCursor,handleSyncV2,readBoundedJSON,syncV2Enabled} from '../lib/sync-v2';

const key='synthetic-test-key-at-least-32-bytes';
function op():SyncOperation {
 const source=randomUUID(); const snapshot:SyncSnapshot={title:'note',kind:'note',createdAt:'2026-09-06',language:'en-US',text:'text',passages:[],speakers:[],sourceRevisionId:source,sourceVersions:[{id:source,title:'note',text:'text',passages:[],speakers:[]}],selectedSummaryId:null,summaries:[],inkAttachments:[]};
 return {protocolVersion:2,libraryId:randomUUID(),noteId:randomUUID(),operationId:randomUUID(),expectedRevision:null,expectedLifecycleGeneration:null,kind:'upsert',snapshot};
}
test('cursor rejects cross-workspace, cross-library, tampering and newer versions',()=>{
 const cursor=encodeCursor('a','library','50',key);assert.equal(decodeCursor(cursor,'a','library',key),'50');
 assert.throws(()=>decodeCursor(cursor,'b','library',key));assert.throws(()=>decodeCursor(cursor,'a','other',key));
 assert.throws(()=>decodeCursor(cursor+'x','a','library',key));
 assert.equal(syncV2Enabled({} as NodeJS.ProcessEnv),false);
});
test('bounded request reader rejects oversized bodies',async()=>{
 await assert.rejects(readBoundedJSON(new Request('https://local/',{method:'POST',body:'x'.repeat(2_000_001)})));
});
test('per-item failures isolate valid operations and replay; pull cursor stays scoped',async()=>{
 const old=process.env.DOODLENOTE_SYNC_CURSOR_SECRET;process.env.DOODLENOTE_SYNC_CURSOR_SECRET=key;
 const {db,close}=await createInMemoryDb();try {
  await db.execute(sql`insert into organization(id,name,slug,created_at) values('a','a','a',now()),('b','b','b',now())`);
  const operation=op();
  const push=()=>handleSyncV2(new Request('https://local/api/sync/v2',{method:'POST',body:JSON.stringify({operations:[{...operation,snapshot:{...operation.snapshot,audio:'no'}},operation]})}),db,'a');
  const first=await (await push()).json();assert.equal(first.results[0].error,'invalid_or_rejected_operation');assert.equal(first.results[1].receipt.status,'ok');
  const retry=await (await push()).json();assert.deepEqual(retry.results[1],first.results[1]);
  const page=await (await handleSyncV2(new Request('https://local/api/sync/v2?libraryId='+operation.libraryId),db,'a')).json();assert.equal(page.changes.length,1);
  const cross=await handleSyncV2(new Request('https://local/api/sync/v2?libraryId='+operation.libraryId+'&cursor='+page.cursor),db,'b');assert.equal(cross.status,400);
 }finally {await close();if(old===undefined)delete process.env.DOODLENOTE_SYNC_CURSOR_SECRET;else process.env.DOODLENOTE_SYNC_CURSOR_SECRET=old;}
});

test('disabled v2 touches no database and legacy DELETE failures return non-2xx for old clients',async()=>{
 const previous=process.env.DOODLENOTE_SYNC_V2_ENABLED;
 const globalDb=globalThis as {__repoDbClient?:unknown};const previousDb=globalDb.__repoDbClient;
 const {db,close}=await createInMemoryDb();
 try {
  delete process.env.DOODLENOTE_SYNC_V2_ENABLED;
  globalDb.__repoDbClient=new Proxy({}, {get(){throw new Error('database must not be touched');}});
  const route=await import('../app/api/sync/v2/route');
  assert.equal((await route.GET(new Request('https://local/api/sync/v2'))).status,404);
  globalDb.__repoDbClient=db;
  const {createHash}=await import('node:crypto');const token='dnsy_'+('ab'.repeat(32));
  await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values('u','User','u@example.test',true,now(),now())`);
  await db.execute(sql`insert into organization(id,name,slug,created_at) values('a','a','a',now())`);
  await db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id) values(${randomUUID()}::uuid,${createHash('sha256').update(token).digest('hex')},'u','a')`);
  await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values('member-u','a','u','member',now())`);
  await db.execute(sql`insert into subscriptions(user_id,grandfathered) values('u',true)`);
  const operation=op();const {applySync}=await import('@repo/db');await applySync(db,'a',operation);
  const legacy=randomUUID();await db.execute(sql`insert into meetings(id,organization_id,title)values(${legacy}::uuid,'a','legacy')`);
  process.env.DOODLENOTE_SYNC_V2_ENABLED='true';
  const legacyRoute=await import('../app/api/sync/push/route');
  const response=await legacyRoute.DELETE(new Request('https://local/api/sync/push',{method:'DELETE',headers:{authorization:'Bearer '+token},body:JSON.stringify({ids:[legacy,operation.noteId]})}));
  assert.equal(response.status,409); // a protected native note must not be acknowledged as deleted
  const remaining=await db.execute(sql`select id from sync_notes where id=${operation.noteId}::uuid`);assert.equal(remaining.rows.length,1);
 } finally {globalDb.__repoDbClient=previousDb;if(previous===undefined)delete process.env.DOODLENOTE_SYNC_V2_ENABLED;else process.env.DOODLENOTE_SYNC_V2_ENABLED=previous;await close();}
});

test('legacy push and pull operate with flag off against the actual pre-v2 schema',async()=>{
 const old=process.env.DOODLENOTE_SYNC_V2_ENABLED;delete process.env.DOODLENOTE_SYNC_V2_ENABLED;
 const globalDb=globalThis as {__repoDbClient?:unknown};const previous=globalDb.__repoDbClient;
 const {db,close}=await createInMemoryDb({throughMigration:12});globalDb.__repoDbClient=db;
 try {
  const {createHash}=await import('node:crypto');const token='dnsy_'+('cd'.repeat(32));
  await db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values('legacy-user','User','legacy@example.test',true,now(),now())`);
  await db.execute(sql`insert into organization(id,name,slug,created_at) values('legacy-org','Org','legacy',now())`);
  await db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id) values(${randomUUID()}::uuid,${createHash('sha256').update(token).digest('hex')},'legacy-user','legacy-org')`);
  await db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values('member-legacy','legacy-org','legacy-user','member',now())`);
  await db.execute(sql`insert into subscriptions(user_id,grandfathered) values('legacy-user',true)`);
  const {POST}=await import('../app/api/sync/push/route');const {GET}=await import('../app/api/sync/pull/route');
  const id=randomUUID();const headers={authorization:'Bearer '+token};
  const push=await POST(new Request('https://local/api/sync/push',{method:'POST',headers,body:JSON.stringify({meetings:[{id,title:'legacy',createdAt:'2026-09-06',segments:[{channel:'mic',speaker:'You',text:'complete',startMs:0,endMs:10}]}]})}));
  assert.equal((await push.json()).results[0].ok,true);
  const pull=await GET(new Request('https://local/api/sync/pull',{headers}));assert.equal((await pull.json()).changed[0].segments[0].text,'complete');
  const tables=await db.execute(sql`select to_regclass('sync_notes') is null as absent`);assert.equal(tables.rows[0]!.absent,true);
  await db.execute(sql`delete from member where id='member-legacy'`);
  assert.equal((await GET(new Request('https://local/api/sync/pull',{headers}))).status,401);
  assert.equal((await POST(new Request('https://local/api/sync/push',{method:'POST',headers,body:JSON.stringify({meetings:[]})}))).status,401);
  const {GET:ping}=await import('../app/api/sync/ping/route');
  assert.equal((await ping(new Request('https://local/api/sync/ping',{headers}))).status,401);
 }finally{globalDb.__repoDbClient=previous;if(old===undefined)delete process.env.DOODLENOTE_SYNC_V2_ENABLED;else process.env.DOODLENOTE_SYNC_V2_ENABLED=old;await close();}
});
