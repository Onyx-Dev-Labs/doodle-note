import { realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceContext, SourcePassage } from './source-contract';
import type { EvidenceBundle, EvidenceSelection, EvidenceFilters, EvidenceRange, EvidenceManifest, CensusRequest, CensusResult } from './evidence-contract';
import { digest, normalizeSearch, scanSources, changedSourceFiles, type SourceSnapshot } from './source-projection';

export class EvidenceError extends Error {
  constructor(readonly code: 'refine-query' | 'invalid-subset' | 'narrow-history' | 'unavailable' | 'retrieval-timeout' | 'question-too-large' | 'unauthorized', message = code) { super(message); }
}
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).every(k=>keys.includes(k));
export function normalizeEvidenceFilters(input: unknown): EvidenceFilters {
  if (!isRecord(input) || !exactKeys(input,['folderId','dateFrom','dateBefore'])) throw new Error('Invalid evidence filters');
  const result: EvidenceFilters = {};
  if (input.folderId !== undefined) { if(typeof input.folderId !== 'string' || !ID.test(input.folderId))throw new Error('Invalid folder'); result.folderId=input.folderId; }
  for(const key of ['dateFrom','dateBefore'] as const) if(input[key] !== undefined){
    if(typeof input[key] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])))throw new Error('Invalid UTC date');
    result[key]=new Date(input[key]).toISOString();
  }
  if(result.dateFrom && result.dateBefore && result.dateFrom>=result.dateBefore)throw new Error('Invalid date interval');
  return result;
}
function subset(value: unknown): string[] {
  if(!Array.isArray(value) || value.length>512 || value.some(id=>typeof id !== 'string' || !ID.test(id)))throw new EvidenceError('invalid-subset');
  const ids=[...new Set<string>(value)].sort(); if(ids.length>256)throw new EvidenceError('narrow-history'); return ids;
}
export function normalizeEvidenceSelection(input: unknown): EvidenceSelection {
  if(!isRecord(input))throw new EvidenceError('invalid-subset');
  if(input.mode==='question' && exactKeys(input,['mode','question','filters','meetingIds'])){
    if(typeof input.question!=='string')throw new EvidenceError('refine-query');
    if(input.question.length>4096)throw new EvidenceError('question-too-large');
    return {mode:'question',question:input.question,filters:normalizeEvidenceFilters(input.filters),...(input.meetingIds===undefined?{}:{meetingIds:subset(input.meetingIds)})};
  }
  if(input.mode==='linked-history' && exactKeys(input,['mode','meetingIds','topic'])){
    if(input.topic!==undefined && (typeof input.topic!=='string' || input.topic.length>4096))throw new EvidenceError('question-too-large');
    return {mode:'linked-history',meetingIds:subset(input.meetingIds),...(typeof input.topic==='string'?{topic:input.topic}:{})};
  }
  throw new EvidenceError('invalid-subset');
}
const STOP = new Set('a an and are as at be been but by did do does for from had has have how i in is it its me my of on or our that the their them there these they this to was we were what when where which who why will with would you your about'.split(' '));
export function planEvidenceQuestion(question: string) {
  const normalized=normalizeSearch(question);
  const all=[...new Set(normalized.match(/[\p{L}\p{N}]+/gu)??[])].filter(t=>!STOP.has(t));
  const allPhrases=[...new Set([...normalized.matchAll(/"([^"]+)"/gu)].map(m=>m[1]!.trim()).filter(Boolean))];
  return {terms:all.slice(0,16),phrases:allPhrases.slice(0,4),droppedTerms:[...all.slice(16),...allPhrases.slice(4)]};
}
export function evidenceRangeId(anchor: EvidenceRange['anchor'], start: number, end: number, quote: string): string {
  return digest(JSON.stringify([anchor.version,anchor.libraryId,anchor.accountId,anchor.workspaceId,anchor.meetingId,anchor.revisionId,anchor.sourceId,anchor.kind,start,end,quote]));
}
export function makeEvidenceRange(p: SourcePassage, start: number, end: number): EvidenceRange {
  const quote=p.text.slice(start,end);return {id:evidenceRangeId(p.anchor,start,end,quote),anchor:p.anchor,startUtf16:start,endUtf16:end,quote};
}
function filtered(snapshot: SourceSnapshot, filters: EvidenceFilters) {
  let unknownDateCount=0;
  const documents=snapshot.documents.filter(d=>{
    const meta=snapshot.inventory.get(d.meetingId+'.json')!;
    if(filters.folderId && filters.folderId!==meta.folderId)return false;
    if(filters.dateFrom || filters.dateBefore){
      if(meta.occurredAt===null){unknownDateCount++;return false;}
      if(filters.dateFrom && meta.occurredAt<filters.dateFrom)return false;
      if(filters.dateBefore && meta.occurredAt>=filters.dateBefore)return false;
    }
    return true;
  });
  return {documents,unknownDateCount};
}
export function scanEvidenceSources(context: SourceContext, selection: EvidenceSelection, checkpoint: ()=>void) {
  if(!context.authorized)throw new EvidenceError('unauthorized');
  const ids=selection.meetingIds;
  // Explicit [] observes only the current directory/scope binding, never scans the library.
  realpathSync(context.meetingsDir); checkpoint();
  if(ids)for(const id of ids)if(!existsSync(join(context.meetingsDir,id+'.json')))throw new EvidenceError('invalid-subset');
  const snapshot=scanSources(context,checkpoint,ids);
  if(ids)for(const id of ids)if(snapshot.inventory.get(id+'.json')?.state==='excluded')throw new EvidenceError('invalid-subset');
  return snapshot;
}
/** Pure planner over one original scan. No SQLite/model/network dependencies. */
export function selectOriginalEvidence(context: SourceContext, selection: EvidenceSelection, snapshot: SourceSnapshot, checkpoint: ()=>void = ()=>{}): EvidenceBundle {
  const plan=planEvidenceQuestion(selection.mode==='question'?selection.question:selection.topic??'');
  if(selection.mode==='question' && !plan.terms.length && !plan.phrases.length)throw new EvidenceError('refine-query');
  const {documents,unknownDateCount}=filtered(snapshot,selection.mode==='question'?selection.filters:{});
  const originals=documents.flatMap(d=>d.passages.filter(p=>p.anchor.kind==='personal'||p.anchor.kind==='transcript'));
  const df=plan.terms.map(t=>originals.reduce((n,p)=>n+Number(normalizeSearch(p.text).includes(t)),0));
  type Candidate={p:SourcePassage;start:number;end:number;score:number[]};
  const compare=(a:Candidate,b:Candidate)=>{
    for(let i=0;i<a.score.length;i++)if(a.score[i]!==b.score[i])return b.score[i]!-a.score[i]!;
    return a.p.anchor.meetingId.localeCompare(b.p.anchor.meetingId,'en')||a.p.anchor.sourceId.localeCompare(b.p.anchor.sourceId,'en')||a.start-b.start;
  };
  let candidateWindowCount=0;const matchingSources=new Set<string>();const matchingMeetings=new Set<string>();
  const top:Candidate[]=[];const linked=new Map<string,Candidate[]>();
  const offer=(c:Candidate)=>{candidateWindowCount++;matchingSources.add(c.p.anchor.meetingId+':'+c.p.anchor.sourceId);matchingMeetings.add(c.p.anchor.meetingId);
    if(selection.mode==='question'){top.push(c);top.sort(compare);if(top.length>64)top.pop();}
    else {const list=linked.get(c.p.anchor.meetingId)??[];list.push(c);linked.set(c.p.anchor.meetingId,list);}
  };
  for(const p of originals){
    checkpoint();
    const points=[...p.text]; const offsets=[0];for(const c of points)offsets.push(offsets[offsets.length-1]!+c.length);
    const windows: Array<[number,number]>=[];
    if(selection.mode==='linked-history')for(let i=0;i<points.length;i+=1600)windows.push([i,Math.min(points.length,i+1600)]);
    else {
      // Match in normalized text, map each normalized code unit back to its original code point.
      let normalized='';const positions:number[]=[];
      points.forEach((c,i)=>{const n=normalizeSearch(c);normalized+=n;for(let j=0;j<n.length;j++)positions.push(i);});
      const centers:number[]=[];
      for(const term of [...plan.phrases,...plan.terms]){let from=0;while(from<normalized.length){const match=normalized.indexOf(term,from);if(match<0)break;centers.push(positions[match]!);from=match+Math.max(1,term.length);}}
      centers.sort((a,b)=>a-b);
      for(const center of centers){if(windows.some(([a,b])=>center>=a && center<b))continue;const start=Math.max(0,Math.min(center-800,points.length-1600));windows.push([start,Math.min(points.length,start+1600)]);}
    }
    for(const [a,b] of windows){checkpoint();const text=normalizeSearch(p.text.slice(offsets[a],offsets[b]));const matches=plan.terms.map(t=>text.includes(t));
      offer({p,start:offsets[a]!,end:offsets[b]!,score:[plan.phrases.filter(t=>text.includes(t)).length,matches.filter(Boolean).length,matches.reduce((n,yes,i)=>n+(yes?Math.log(1+originals.length/(1+df[i]!)):0),0)]});}
  }
  if(selection.mode==='linked-history'){
    const meetingOrder=documents.slice().sort((a,b)=>(snapshot.inventory.get(b.meetingId+'.json')!.occurredAt??'').localeCompare(snapshot.inventory.get(a.meetingId+'.json')!.occurredAt??'')||a.meetingId.localeCompare(b.meetingId));
    const ordered=meetingOrder.map(d=>{const list=linked.get(d.meetingId)??[];const ranked=list.slice().sort(compare);const first=ranked[0]?.score.some(n=>n>0)?ranked[0]:undefined;
      return [...new Set([first,list.at(-1),list[0],list[Math.floor(list.length/2)],...list].filter((c):c is Candidate=>!!c))];});
    for(let slot=0;top.length<64 && ordered.some(a=>slot<a.length);slot++)for(const list of ordered)if(list[slot] && top.length<64)top.push(list[slot]!);
  }
  const selected:Candidate[]=[];const perMeeting=new Map<string,number>();let meetingCap=false;
  for(const c of top){const count=perMeeting.get(c.p.anchor.meetingId)??0;if(count>=4){meetingCap=true;continue;}if(selected.length>=24)continue;selected.push(c);perMeeting.set(c.p.anchor.meetingId,count+1);}
  checkpoint(); const changed=changedSourceFiles(snapshot,context);checkpoint();
  const unavailableCount=snapshot.unavailableCount+changed.size;
  const ranges=selected.filter(c=>!changed.has(c.p.anchor.meetingId+'.json')).map(c=>makeEvidenceRange(c.p,c.start,c.end));
  const omissions:EvidenceBundle['coverage']['omissions']=[];
  if(plan.droppedTerms.length)omissions.push('query-terms');if(candidateWindowCount>64)omissions.push('candidate-cap');if(top.length>24)omissions.push('range-cap');if(meetingCap)omissions.push('meeting-cap');
  if(snapshot.unavailableCount)omissions.push('unavailable');if(changed.size)omissions.push('changed-during-scan');if(unknownDateCount)omissions.push('unknown-date');if(selection.mode==='linked-history'&&ranges.length<candidateWindowCount)omissions.push('linked-sampling');
  const coverage:EvidenceBundle['coverage']={version:1,scope:context.scope,observedAt:new Date().toISOString(),selection,...plan,eligibleMeetingCount:documents.length,scannedMeetingCount:snapshot.documents.length,matchingMeetingCount:matchingMeetings.size,matchingSourceCount:matchingSources.size,candidateWindowCount,selectedMeetingCount:new Set(ranges.map(r=>r.anchor.meetingId)).size,selectedRangeIds:ranges.map(r=>r.id),unavailableCount,unknownDateCount,scanComplete:unavailableCount===0,selectionComplete:ranges.length===candidateWindowCount,semanticCoverage:'not-exhaustive',omissions};
  const {observedAt:_,...stableCoverage}=coverage;
  const inventory=[...snapshot.inventory].sort(([a],[b])=>a.localeCompare(b));
  const manifest:EvidenceManifest={version:1,scope:context.scope,pathBindingSha256:digest(realpathSync(context.meetingsDir)),selection,plannerVersion:1,inventorySha256:digest(JSON.stringify(inventory)),dependencies:documents.map(d=>{const meta=snapshot.inventory.get(d.meetingId+'.json')!;return {meetingId:d.meetingId,rawSha256:meta.rawSha256,projectedRevisionId:d.revisionId,filterMetadataSha256:digest(JSON.stringify([meta.occurredAt,meta.dateBasis,meta.folderId]))};}),selectionSha256:digest(JSON.stringify([selection,ranges.map(r=>r.id)])),coverageSha256:digest(JSON.stringify(stableCoverage))};
  return {version:1,ranges,meetings:documents.map(d=>{const m=snapshot.inventory.get(d.meetingId+'.json')!;return {meetingId:d.meetingId,title:m.title,occurredAt:m.occurredAt,dateBasis:m.dateBasis};}),coverage,manifest};
}
export function retrieveOriginalEvidence(context: SourceContext, input: EvidenceSelection, checkpoint: ()=>void = ()=>{}): EvidenceBundle {
  const selection=normalizeEvidenceSelection(input);const deadline=Date.now()+15000;
  const check=()=>{checkpoint();if(Date.now()>deadline)throw new EvidenceError('retrieval-timeout');};
  return selectOriginalEvidence(context,selection,scanEvidenceSources(context,selection,check),check);
}
export function validateOriginalEvidence(context: SourceContext, manifest: EvidenceManifest, checkpoint: ()=>void = ()=>{}): 'valid'|'stale'|'unavailable' {
  const current=retrieveOriginalEvidence(context,manifest.selection,checkpoint);
  if(!current.coverage.scanComplete)return 'unavailable';
  return JSON.stringify(current.manifest)===JSON.stringify(manifest)?'valid':'stale';
}
export function censusOriginalEvidence(context: SourceContext, input: CensusRequest, checkpoint: ()=>void = ()=>{}): CensusResult {
  if(!isRecord(input)||!exactKeys(input,['filters','predicate'])||!isRecord(input.predicate))throw new Error('Invalid census');
  const filters=normalizeEvidenceFilters(input.filters);const p=input.predicate;
  if(!((p.kind==='eligible'&&exactKeys(p,['kind']))||(p.kind==='literal'&&exactKeys(p,['kind','text'])&&typeof p.text==='string'&&p.text.length<=4096&&p.text.trim())))throw new Error('Invalid census predicate');
  const snapshot=scanSources(context,checkpoint);const {documents,unknownDateCount}=filtered(snapshot,filters);
  const terms=p.kind==='literal'?normalizeSearch(p.text).trim().split(/\s+/u):[];let sourceCount=0;const meetings:CensusResult['meetings']=[];
  for(const d of documents){checkpoint();let matches=0;for(const source of d.passages)if((source.anchor.kind==='personal'||source.anchor.kind==='transcript')&&terms.every(t=>normalizeSearch(source.text).includes(t)))matches++;
    sourceCount+=matches;if(matches||p.kind==='eligible')meetings.push({meetingId:d.meetingId,title:snapshot.inventory.get(d.meetingId+'.json')!.title});}
  const unavailableCount=snapshot.unavailableCount+changedSourceFiles(snapshot,context).size;checkpoint();
  return {scope:context.scope,predicate:{filters,predicate:p},meetingCount:meetings.length,sourceCount,exact:unavailableCount===0,unavailableCount,unknownDateCount,meetings:meetings.slice(0,100),listTruncated:meetings.length>100};
}
