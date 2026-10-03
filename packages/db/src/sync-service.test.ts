import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { createInMemoryDb } from './testing';
import { applySync, pullSync, writeLegacy } from './sync-service';
import { validateSyncOperation, type SyncOperation, type SyncSnapshot } from './sync-contract';

function snapshot(text='original'):SyncSnapshot {
  const id=randomUUID();
  return {title:'Meeting',kind:'meeting',createdAt:'2026-09-06T00:00:00Z',language:'da-DK',text,
    sourceRevisionId:id,sourceVersions:[{id,title:'Meeting',text,passages:[],speakers:[]}],selectedSummaryId:null,
    passages:[],speakers:[],summaries:[],inkAttachments:[]};
}
function operation(libraryId:string=randomUUID(),noteId:string=randomUUID()):SyncOperation {
  return {protocolVersion:2,libraryId,noteId,operationId:randomUUID(),expectedRevision:null,expectedLifecycleGeneration:null,kind:'upsert',snapshot:snapshot()};
}
interface Receipt {status:string;headRevision:string;revision:string;lifecycleGeneration:string;deletionId:string;state:string}
async function setup() {
  const instance=await createInMemoryDb();
  await instance.db.execute(sql`insert into organization(id,name,slug,created_at) values ('a','A','a',now()),('b','B','b',now())`);
  return instance;
}
function next(op:SyncOperation,r:Receipt,kind:SyncOperation['kind']='upsert'):SyncOperation {
  return {...op,operationId:randomUUID(),kind,expectedRevision:r.headRevision,expectedLifecycleGeneration:r.lifecycleGeneration,
    ...(kind==='upsert'?{snapshot:snapshot('edited')}:{snapshot:undefined}),...(r.deletionId?{deletionId:r.deletionId}:{})};
}

test('real migrated database: conflicts, replay, tenant and lineage barriers',async()=>{
  const {db,close}=await setup();try {
    const op=operation();const initial=await applySync(db,'a',op) as Receipt;assert.equal(initial.status,'ok');
    assert.deepEqual(await applySync(db,'a',op),initial);
    assert.equal((await applySync(db,'b',op) as Receipt).status,'not_found');
    const edit=next(op,initial);const edited=await applySync(db,'a',edit) as Receipt;assert.equal(edited.status,'ok');
    const stale=next(op,initial);const conflict=await applySync(db,'a',stale) as Receipt;assert.equal(conflict.status,'conflict');
    assert.equal(conflict.headRevision,edited.headRevision);
    assert.equal((await applySync(db,'a',{...stale,snapshot:snapshot('different')}) as Receipt).status,'operation_reused');
    assert.equal((await applySync(db,'a',{...next(op,edited),expectedRevision:randomUUID()}) as Receipt).status,'unknown_revision');
    const page1=await pullSync(db,'a',op.libraryId,'0',1);assert.equal(page1.changes.length,1);assert.equal(page1.hasMore,true);
    const page2=await pullSync(db,'a',op.libraryId,page1.after,2);assert.equal(page2.changes.length,2);assert.equal(page2.changes[1]!.kind,'conflict');
    await assert.rejects(pullSync(db,'b',op.libraryId));
    const immutable=next(op,edited);immutable.snapshot={...edit.snapshot!,text:'changed',sourceVersions:[{...edit.snapshot!.sourceVersions[0]!,text:'changed'}]};
    assert.equal((await applySync(db,'a',immutable) as Receipt).status,'immutable_version_conflict');
  }finally {await close();}
});
test('Trash, explicit restore, expiry and purge erase all snapshots and block old replays',async()=>{
  const {db,close}=await setup();try {
    const op=operation();const initial=await applySync(db,'a',op) as Receipt;
    assert.equal((await applySync(db,'a',{...next(op,initial,'purge'),deletionId:randomUUID()}) as Receipt).status,'lifecycle_conflict');
    const trash=await applySync(db,'a',next(op,initial,'trash')) as Receipt;assert.equal(trash.state,'trashed');
    assert.equal((await applySync(db,'a',next(op,initial)) as Receipt).status,'lifecycle_conflict');
    const restored=await applySync(db,'a',next(op,trash,'restore')) as Receipt;assert.equal(restored.state,'active');
    const again=await applySync(db,'a',next(op,restored,'trash')) as Receipt;
    const purge=await applySync(db,'a',next(op,again,'purge')) as Receipt;assert.equal(purge.state,'purged');
    assert.equal((await applySync(db,'a',op) as Receipt).status,'purged');
    const feed=await pullSync(db,'a',op.libraryId);assert.ok(feed.changes.every(r=>r.snapshot===null&&r.state==='purged'));
    const exp=operation(op.libraryId);const created=await applySync(db,'a',exp) as Receipt;
    await applySync(db,'a',next(exp,created,'trash'));
    await db.execute(sql`update sync_notes set expires_at=now()-interval '1 second' where id=${exp.noteId}::uuid`);
    const expired=await pullSync(db,'a',op.libraryId);assert.ok(expired.changes.filter(r=>r.note_id===exp.noteId).every(r=>r.snapshot===null&&r.state==='purged'));
  }finally {await close();}
});
test('legacy adoption retains full original; old writers/deletes cannot bypass protection',async()=>{
  const {db,close}=await setup();try {
    const op=operation();
    const legacy={id:op.noteId,title:'Legacy',kind:'meeting',createdAt:'2026-09-06T00:00:00Z',segments:[{channel:'mic',speaker:'You',text:'old',startMs:0,endMs:10}],rawContent:{markdown:'notes'},enhancedContent:{markdown:'summary'}};
    await writeLegacy(db,'a',legacy);
    const receipt=await applySync(db,'a',op) as Receipt;assert.equal(receipt.status,'conflict');
    const feed=await pullSync(db,'a',op.libraryId);assert.equal(feed.changes[0]!.kind,'legacy');
    assert.equal((feed.changes[0]!.snapshot as {legacySegments:unknown[]}).legacySegments.length,1);
    await assert.rejects(writeLegacy(db,'a',legacy));
    await assert.rejects(db.execute(sql`update notes set raw_content='{}' where meeting_id=${op.noteId}::uuid`));
    await assert.rejects(db.execute(sql`delete from meetings where id=${op.noteId}::uuid`));
    const fresh=operation();await writeLegacy(db,'a',{...legacy,id:fresh.noteId});
    await db.execute(sql`delete from meetings where id=${fresh.noteId}::uuid`);
    assert.equal((await applySync(db,'a',fresh) as Receipt).status,'not_found'); // different library cannot move a purge receipt
    await assert.rejects(writeLegacy(db,'a',{...legacy,id:fresh.noteId}));
  }finally {await close();}
});
test('legacy SQL failure rolls back row, notes and transcript; cross-owner rejected',async()=>{
  const {db,close}=await setup();try {
    const id=randomUUID();const item={id,title:'before',kind:'meeting',createdAt:'2026-09-06',segments:[{channel:'mic',speaker:'You',text:'original',startMs:0,endMs:1}]};
    await writeLegacy(db,'a',item);
    await assert.rejects(writeLegacy(db,'a',{...item,title:'after',segments:[{channel:'mic',speaker:'x',text:'bad',startMs:'not-number',endMs:1}]}));
    const row=await db.execute(sql`select title from meetings where id=${id}::uuid`);assert.equal(row.rows[0]!.title,'before');
    await assert.rejects(writeLegacy(db,'b',item));
    const segments=await db.execute(sql`select text from transcript_segments where meeting_id=${id}::uuid`);assert.equal(segments.rows[0]!.text,'original');
  }finally {await close();}
});
test('strict payloads retain typed paragraph anchors and reject arbitrary fields, cycles, dangling sources, oversized transcripts',()=>{
  const op=operation();const s=op.snapshot!;const sid=randomUUID();s.summaries=[{id:sid,createdAt:s.createdAt,origin:'generated',format:'meeting',language:'da-DK',markdown:'Summary',sources:[{libraryId:op.libraryId,noteId:op.noteId,revisionId:s.sourceRevisionId,kind:'personalParagraph',paragraphIndex:0}]}];s.selectedSummaryId=sid;
  assert.equal(validateSyncOperation(op),op);
  assert.throws(()=>validateSyncOperation({...op,snapshot:{...s,audio:'forbidden'}}));
  assert.throws(()=>validateSyncOperation({...op,snapshot:{...s,summaries:[{...s.summaries[0],parentId:sid}]}}));
  assert.throws(()=>validateSyncOperation({...op,snapshot:{...s,selectedSummaryId:randomUUID()}}));
  assert.throws(()=>validateSyncOperation({...op,snapshot:{...s,passages:Array(20001).fill({})}}));
});

test('6001-segment legacy and v2 round trips preserve the final sentinel',async()=>{
 const {db,close}=await setup();try {
  const legacyId=randomUUID();const segments=Array.from({length:6001},(_,i)=>({channel:'mic',speaker:'You',text:i===6000?'final-sentinel':'word',startMs:i*10,endMs:i*10+9}));
  await writeLegacy(db,'a',{id:legacyId,title:'long',kind:'meeting',createdAt:'2026-09-06',segments});
  const stored=await db.execute(sql`select text from transcript_segments where meeting_id=${legacyId}::uuid order by start_ms`);assert.equal(stored.rows.length,6001);assert.equal(stored.rows[6000]!.text,'final-sentinel');
  const operation=opLong();await applySync(db,'a',operation);const page=await pullSync(db,'a',operation.libraryId);
  const restored=page.changes[0]!.snapshot as SyncSnapshot;assert.equal(restored.passages.length,6001);assert.equal(restored.passages[6000]!.text,'final-sentinel');
 }finally{await close();}
});
function opLong(){const op=operation();const s=op.snapshot!;s.passages=Array.from({length:6001},(_,i)=>({id:randomUUID(),sourceId:op.noteId,startMs:i*10,endMs:i*10+9,text:i===6000?'final-sentinel':'word'}));s.sourceVersions[0]!.passages=s.passages;return op;}

test('retained prior typed source resolves summary after a new text revision; dangling anchors rejected',()=>{
 const op=operation();const s=op.snapshot!;const old=s.sourceVersions[0]!;
 s.sourceRevisionId=randomUUID();s.text='new paragraph';s.sourceVersions.push({id:s.sourceRevisionId,title:s.title,text:s.text,passages:[],speakers:[]});
 s.summaries=[{id:randomUUID(),createdAt:s.createdAt,origin:'generated',format:'meeting',language:s.language,markdown:'Old summary',sources:[{libraryId:op.libraryId,noteId:op.noteId,revisionId:old.id,kind:'personalParagraph',paragraphIndex:0}]}];
 assert.equal(validateSyncOperation(op).snapshot!.sourceVersions[0]!.text,'original');
 const bad=structuredClone(op);bad.snapshot!.summaries[0]!.sources[0]!.revisionId=randomUUID();assert.throws(()=>validateSyncOperation(bad));
 const badParagraph=structuredClone(op);badParagraph.snapshot!.summaries[0]!.sources[0]!.paragraphIndex=4;assert.throws(()=>validateSyncOperation(badParagraph));
 const badPassage=structuredClone(op);badPassage.snapshot!.summaries[0]!.sources=[{libraryId:op.libraryId,noteId:op.noteId,revisionId:old.id,kind:'transcript',passageId:randomUUID()}];assert.throws(()=>validateSyncOperation(badPassage));
});

test('organization cascade removes protected and legacy data without tombstone recreation',async()=>{
 const {db,close}=await setup();try {
  const op=operation();await applySync(db,'a',op);
  await writeLegacy(db,'a',{id:randomUUID(),title:'legacy',kind:'note',createdAt:'2026-09-06',segments:[]});
  await db.execute(sql`delete from organization where id='a'`);
  const rows=await db.execute(sql`select count(*)::integer as count from sync_notes where organization_id='a'`);assert.equal(rows.rows[0]!.count,0);
 }finally{await close();}
});

test('UUID case aliases cannot bypass immutable source identity or duplicate detection',()=>{
 const op=operation();const upper=structuredClone(op);upper.snapshot!.sourceRevisionId=upper.snapshot!.sourceRevisionId.toUpperCase();upper.snapshot!.sourceVersions[0]!.id=upper.snapshot!.sourceRevisionId;
 assert.throws(()=>validateSyncOperation(upper));
 const duplicate=structuredClone(op);duplicate.snapshot!.sourceVersions.push({...duplicate.snapshot!.sourceVersions[0]!,id:duplicate.snapshot!.sourceVersions[0]!.id.toUpperCase()});
 assert.throws(()=>validateSyncOperation(duplicate));
});

test('object key order does not alter retained source equality',()=>{
 const op=operation();const p={id:randomUUID(),sourceId:op.noteId,startMs:0,endMs:10,text:'text'};
 op.snapshot!.passages=[p];op.snapshot!.sourceVersions[0]!.passages=[{text:p.text,endMs:p.endMs,startMs:p.startMs,sourceId:p.sourceId,id:p.id}];
 assert.equal(validateSyncOperation(op),op);
});
test('invalid initial folder creates no hidden note or legacy adoption',async()=>{
 const {db,close}=await setup();try {
  for(const adopted of [false,true]) {
   const op=operation();op.snapshot!.folderId=randomUUID();
   const item={id:op.noteId,title:'legacy',kind:'note',createdAt:'2026-09-06',segments:[]};
   if(adopted)await writeLegacy(db,'a',item);
   assert.equal((await applySync(db,'a',op) as Receipt).status,'invalid_folder');
   const count=await db.execute(sql`select count(*)::integer as count from sync_notes where id=${op.noteId}::uuid`);assert.equal(count.rows[0]!.count,0);
   if(adopted)await writeLegacy(db,'a',{...item,title:'still editable'});
   delete op.snapshot!.folderId;
   assert.equal((await applySync(db,'a',op) as Receipt).status,adopted?'conflict':'ok');
  }
 }finally{await close();}
});
