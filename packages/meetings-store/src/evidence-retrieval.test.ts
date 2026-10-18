import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as retrieval from './evidence-retrieval';
import { localSourceScope, projectSources } from './source-projection';
import type { EvidenceSelection } from './evidence-contract';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dev507-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scope = localSourceScope(root, true);
  const context = { meetingsDir: root, scope, authorized: true };
  const put = (id: string, extra: Record<string, unknown> = {}) => {
    const raw = { id, title: id, createdAt: '2020-01-01T00:00:00Z', rawNotesMarkdown: 'budget approved', segments: [{ id: 's', text: 'budget discussed' }], ...extra };
    writeFileSync(join(root, id+'.json'), JSON.stringify(raw)); return raw;
  };
  return { root, context, put };
}
const question = (text: string): EvidenceSelection => ({ mode: 'question', question: text, filters: {} });

test('question ranking finds an old late original beyond 1000 matches without rewriting originals', t => {
  const {root,context,put}=fixture(t);
  for(let i=0;i<601;i++) put('m-'+String(i).padStart(4,'0'));
  const raw=put('m-0600',{ enhancedMarkdown:'Unrelated summary', segments:[{id:'late',text:'🌳'.repeat(3000)+' Orchid launch approved Friday. '+'suffix '.repeat(800)}] });
  const before=readFileSync(join(root,'m-0600.json'));
  assert.equal(typeof retrieval.retrieveOriginalEvidence,'function');
  const bundle=retrieval.retrieveOriginalEvidence(context,question('What did we decide about the Orchid launch?'));
  assert.equal(bundle.ranges[0]!.anchor.meetingId,'m-0600');
  assert.match(bundle.ranges[0]!.quote,/Orchid launch approved Friday/);
  assert.ok([...bundle.ranges[0]!.quote].length<=1600);
  assert.equal(bundle.ranges[0]!.anchor.revisionId,projectSources(raw,context.scope)!.revisionId);
  assert.deepEqual(readFileSync(join(root,'m-0600.json')),before);
  const census=retrieval.censusOriginalEvidence(context,{filters:{},predicate:{kind:'literal',text:'budget'}});
  assert.equal(census.meetingCount,601); assert.equal(census.sourceCount,1201); assert.equal(census.exact,true); assert.equal(census.listTruncated,true);
  const many=retrieval.retrieveOriginalEvidence(context,question('budget'));
  assert.equal(many.coverage.matchingMeetingCount,601); assert.equal(many.coverage.candidateWindowCount,1201);
  assert.equal(many.coverage.scanComplete,true); assert.equal(many.coverage.selectionComplete,false);
  assert.equal(many.ranges.length,24);
});
test('summary-only hits cannot become evidence; planner rejects meaningless queries and reports capped terms', t=>{
  const {context,put}=fixture(t);put('one',{enhancedMarkdown:'secret opal',rawNotesMarkdown:'',segments:[]});
  assert.equal(retrieval.retrieveOriginalEvidence(context,question('opal')).ranges.length,0);
  for(const text of ['?!','what did we do']) assert.throws(()=>retrieval.retrieveOriginalEvidence(context,question(text)),/refine-query/);
  const b=retrieval.retrieveOriginalEvidence(context,question(Array.from({length:17},(_,i)=>'term'+i).join(' ')));
  assert.equal(b.coverage.terms.length,16); assert.equal(b.coverage.droppedTerms.length,1);
});
test('explicit subsets never widen, enforce caps and distinguish bad/unavailable membership',t=>{
  const {root,context,put}=fixture(t);put('one');
  assert.equal(retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:[]}).coverage.scannedMeetingCount,0);
  const b=retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:['one','one']});
  assert.equal(b.meetings.length,1); assert.equal(b.ranges.length,2);
  assert.throws(()=>retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:['absent']}),/invalid-subset/);
  assert.throws(()=>retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:Array.from({length:257},(_,i)=>'m'+i)}),/narrow-history/);
  assert.throws(()=>retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:Array(513).fill('one')}),/invalid-subset/);
  put('trash',{trashedAt:'2026-01-01T00:00:00Z'});
  assert.throws(()=>retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:['trash']}),/invalid-subset/);
  writeFileSync(join(root,'broken.json'),'{');
  const partial=retrieval.retrieveOriginalEvidence(context,question('budget'));assert.equal(partial.coverage.scanComplete,false);
});
test('manifest fences uncited edits, participants, selected summary, filters and new originals; rebuild is stable',t=>{
  const {context,put}=fixture(t);put('one');put('two');
  const selection=question('budget'); const first=retrieval.retrieveOriginalEvidence(context,selection);
  assert.deepEqual(retrieval.retrieveOriginalEvidence(context,selection).manifest,first.manifest);
  put('two',{participants:[{id:'far',name:'Corrected'}]});
  assert.notEqual(retrieval.retrieveOriginalEvidence(context,selection).manifest.inventorySha256,first.manifest.inventorySha256);
  const second=retrieval.retrieveOriginalEvidence(context,selection);put('third');
  assert.notEqual(retrieval.retrieveOriginalEvidence(context,selection).manifest.inventorySha256,second.manifest.inventorySha256);
  put('unknown',{createdAt:'not-a-date'});
  const filtered=retrieval.retrieveOriginalEvidence(context,{mode:'question',question:'budget',filters:{dateFrom:'2019-01-01T00:00:00Z',dateBefore:'2021-01-01T00:00:00Z'}});
  assert.equal(filtered.coverage.unknownDateCount,1); assert.equal(filtered.coverage.scanComplete,true);
  assert.throws(()=>retrieval.retrieveOriginalEvidence(context,{mode:'question',question:'x',filters:{dateFrom:'bad'}}),/Invalid/);
});
test('linked history samples head middle tail without lexical match and excludes unlinked same-name records',t=>{
  const {context,put}=fixture(t);for(const id of ['old-a','old-b','unrelated'])put(id,{segments:[{id:'s',text:'head '+ '界'.repeat(2500)+' middle '+ '界'.repeat(2500)+' Ship Friday tail'}]});
  const b=retrieval.retrieveOriginalEvidence(context,{mode:'linked-history',meetingIds:['old-a','old-b'],topic:'attendee absent'});
  assert.deepEqual(new Set(b.ranges.map(r=>r.anchor.meetingId)),new Set(['old-a','old-b']));
  assert.ok(b.ranges.some(r=>r.quote.includes('Ship Friday tail')));
  assert.equal(b.coverage.selectionComplete,false); assert.ok(b.coverage.omissions.includes('linked-sampling'));
});

test('whole-string Unicode normalization preserves literal matches and exact original UTF-16 ranges', t => {
  const {context, put}=fixture(t);
  for(const text of ['ΚΟΣΜΟΣ','ΟΣ','ΟΣΑ','Cafe\u0301','\u0130stanbul','ﬃ','𐐀𐐁']){
    put('unicode',{rawNotesMarkdown:'🌳'.repeat(2000)+' '+text+' '+'🌳'.repeat(2000),segments:[]});
    const bundle=retrieval.retrieveOriginalEvidence(context,question(text));
    assert.equal(bundle.ranges.length,1,`verbatim ${text} must match`);
    const range=bundle.ranges[0]!;assert.ok(range.quote.includes(text));
    assert.equal(('🌳'.repeat(2000)+' '+text+' '+'🌳'.repeat(2000)).slice(range.startUtf16,range.endUtf16),range.quote);
    assert.equal(bundle.coverage.scanComplete,true);
  }
});

test('known filter-excluded unavailable units do not poison requested-domain completeness; unreadable boundaries do', t => {
  const {root,context,put}=fixture(t);
  put('current',{createdAt:'2026-01-01T00:00:00Z',folderId:'current'});
  put('excluded',{createdAt:'2000-01-01T00:00:00Z',folderId:'old',metadata:{selectedSummaryID:'missing',summaries:[]}});
  for(const filters of [{dateFrom:'2026-01-01T00:00:00Z'},{dateBefore:'2027-01-01T00:00:00Z',folderId:'current'}]){
    const result=retrieval.retrieveOriginalEvidence(context,{mode:'question',question:'budget',filters});
    assert.equal(result.coverage.scanComplete,true);assert.equal(result.coverage.unavailableCount,0);
    const census=retrieval.censusOriginalEvidence(context,{filters,predicate:{kind:'literal',text:'budget'}});
    assert.equal(census.exact,true);assert.equal(census.meetingCount,1);
  }
  assert.equal(retrieval.retrieveOriginalEvidence(context,question('budget')).coverage.scanComplete,false);
  writeFileSync(join(root,'excluded.json'),'{');
  assert.equal(retrieval.retrieveOriginalEvidence(context,{mode:'question',question:'budget',filters:{folderId:'current'}}).coverage.scanComplete,false);
});

for(const mutation of ['deleted','nonmatching','new-matching'] as const)test(`partial literal census removes ${mutation} unstable contributions from count and list`,t=>{
  const {root,context,put}=fixture(t);put('one',{rawNotesMarkdown:'Orchid',segments:[]});
  let calls=0;
  const result=retrieval.censusOriginalEvidence(context,{filters:{},predicate:{kind:'literal',text:'Orchid'}},()=>{
    if(++calls===2){
      if(mutation==='deleted')rmSync(join(root,'one.json'));
      else if(mutation==='nonmatching')put('one',{rawNotesMarkdown:'unrelated',segments:[]});
      else put('two',{rawNotesMarkdown:'Orchid',segments:[]});
    }
  });
  const current=retrieval.censusOriginalEvidence(context,{filters:{},predicate:{kind:'literal',text:'Orchid'}});
  assert.equal(result.exact,false);assert.equal(result.unavailableCount,1);
  assert.ok(result.meetingCount<=current.meetingCount);assert.ok(result.sourceCount<=current.sourceCount);
  assert.equal(result.meetingCount,mutation==='new-matching'?1:0);
  assert.deepEqual(result.meetings.map(m=>m.meetingId),mutation==='new-matching'?['one']:[]);
});
