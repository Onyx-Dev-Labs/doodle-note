import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {sql} from 'drizzle-orm';
import {createInMemoryDb} from './testing';
import {adoptLegacy,discoverLegacy,legacySyncAvailable} from './legacy-sync';
import {inkRows} from './ink-assets';

test('legacy discovery is scoped and paginated; explicit adoption preserves originals and is idempotent', async()=>{
  const f=await createInMemoryDb();
  try {
    await f.db.execute(sql`insert into organization(id,name,slug,created_at) values('a','A','a',now()),('b','B','b',now())`);
    const ids=Array.from({length:52},()=>randomUUID()).sort(), foreign=randomUUID(), library=randomUUID();
    for(const id of ids)await f.db.execute(sql`insert into meetings(id,organization_id,title) values(${id}::uuid,'a','Synthetic desktop meeting')`);
    await f.db.execute(sql`insert into meetings(id,organization_id,title) values(${foreign}::uuid,'b','Other workspace')`);
    await f.db.execute(sql`insert into notes(meeting_id,raw_content,enhanced_content) values(${ids[0]}::uuid,'{"format":"markdown","markdown":"Typed original"}','{"format":"markdown","markdown":"Generated original"}')`);
    const page=await discoverLegacy(f.db,'a');
    assert.equal(page.total,52);assert.equal(page.notes.length,50);assert.ok(page.next);
    const last=await discoverLegacy(f.db,'a',page.next!);assert.equal(last.notes.length,2);
    assert.equal((await discoverLegacy(f.db,'b')).notes.length,1);
    const operation={libraryId:library,noteId:ids[0],operationId:randomUUID()};
    const first=await adoptLegacy(f.db,'a',operation) as {status:string;headRevision:string};
    assert.equal(first.status,'ok');
    assert.deepEqual(await adoptLegacy(f.db,'a',operation),first);
    assert.equal((await adoptLegacy(f.db,'a',{...operation,operationId:randomUUID()}) as {status:string}).status,'already_adopted');
    assert.equal((await discoverLegacy(f.db,'a')).total,51);
    const snapshot=inkRows(await f.db.execute(sql`select snapshot from sync_revisions where id=${first.headRevision}::uuid`))[0]!.snapshot as any;
    assert.equal(snapshot.legacyMeeting.id,ids[0]);
    assert.equal(snapshot.legacyNotes.raw_content.markdown,'Typed original');
    assert.equal(snapshot.legacyNotes.enhanced_content.markdown,'Generated original');
    assert.equal((await adoptLegacy(f.db,'a',{libraryId:library,noteId:foreign,operationId:randomUUID()}) as {status:string}).status,'not_found');
    assert.equal(inkRows(await f.db.execute(sql`select count(*)::int as n from sync_notes where id=${foreign}::uuid`))[0]!.n,0);
  } finally {await f.close();}
});

test('legacy adoption capability is false on previous schema and empty workspace discovery is safe',async()=>{
  const old=await createInMemoryDb({throughMigration:15});
  try {assert.equal(await legacySyncAvailable(old.db),false);}finally{await old.close();}
  const f=await createInMemoryDb();
  try {
    assert.equal(await legacySyncAvailable(f.db),true);
    assert.deepEqual(await discoverLegacy(f.db,'empty'),{notes:[],total:0,next:null});
  }finally{await f.close();}
});
