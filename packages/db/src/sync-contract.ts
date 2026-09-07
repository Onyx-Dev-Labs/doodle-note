export function canonical(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
/** Version 2 is opt-in. These JSON types contain no audio, credentials or voice embeddings. */
export interface SyncSnapshot {
  title: string;
  kind: 'note' | 'meeting';
  createdAt: string;
  language: 'en-US' | 'da-DK' | 'es-ES' | 'fr-FR' | 'de-DE';
  text: string;
  transcriptStatus?: 'none' | 'partial' | 'interrupted' | 'complete';
  sourceRevisionId: string;
  sourceVersions: Array<{id: string; title: string; text: string; passages: SyncSnapshot['passages']; speakers: SyncSnapshot['speakers']; speakerTurns?: SyncSnapshot['speakerTurns']}>;
  selectedSummaryId: string | null;
  folderId?: string;
  event?: {provider: string; accountId: string; calendarId: string; eventId: string; occurrenceId: string};
  passages: Array<{ id: string; sourceId: string; startMs: number; endMs: number; text: string; speakerId?: string; isFinal?: boolean; isUserEdited?: boolean }>;
  speakers: Array<{ id: string; displayName: string; sessionId?: string; slot?: number }>;
  speakerTurns?: Array<{speakerId:string;startMs:number;endMs:number;isFinal:boolean}>;
  summaries: Array<{ id: string; parentId?: string; createdAt: string; origin: 'generated' | 'edited'; format: string; language: string; markdown: string; sources: Array<{libraryId:string; noteId:string; revisionId:string; kind:'personalParagraph'|'transcript'|'title'|'summary'; paragraphIndex?:number; passageId?:string; summaryId?:string}> }>;
  inkAttachments: Array<{ id: string; versionId: string }>;
}
export interface SyncOperation {
  protocolVersion: 2;
  libraryId: string;
  noteId: string;
  operationId: string;
  expectedRevision: string | null;
  expectedLifecycleGeneration: string | null;
  kind: 'upsert' | 'trash' | 'restore' | 'purge';
  deletionId?: string;
  snapshot?: SyncSnapshot;
}
export const SYNC_CAPABILITIES = ['immutable-conflicts', 'explicit-libraries', 'stable-sources', 'summary-revisions', 'trash-30-days', 'durable-purge', 'sequence-cursor'] as const;
export const SYNC_MAX_BYTES = 2_000_000;
export const SYNC_MAX_SEGMENTS = 20_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_object');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(k => !allowed.includes(k))) throw new Error('unsupported_field');
  return row;
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('invalid_id');
}
function text(value: unknown, limit: number): asserts value is string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('invalid_text');
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('array_limit');
  return value;
}
function unique(rows: unknown[], check: (value: unknown) => Record<string, unknown>) {
  const ids = new Set();
  for (const value of rows) { const row = check(value); id(row.id); if (ids.has(row.id)) throw new Error('duplicate_id'); ids.add(row.id); }
}
function validateTurns(turns:unknown,speakers:Array<{id:string}>) {
  if(turns===undefined)return;
  for(const value of array(turns,SYNC_MAX_SEGMENTS)) {const r=object(value,['speakerId','startMs','endMs','isFinal']);
    if(!speakers.some(s=>s.id===r.speakerId)||!Number.isSafeInteger(r.startMs)||!Number.isSafeInteger(r.endMs)||Number(r.startMs)<0||Number(r.endMs)<=Number(r.startMs)||typeof r.isFinal!=='boolean')throw new Error('invalid_speaker_turn');}
}
export function validateSyncOperation(value: unknown): SyncOperation {
  const row = object(value, ['protocolVersion','libraryId','noteId','operationId','expectedRevision','expectedLifecycleGeneration','kind','deletionId','snapshot']);
  if (row.protocolVersion !== 2 || !['upsert','trash','restore','purge'].includes(String(row.kind))) throw new Error('unsupported_protocol');
  for (const key of ['libraryId','noteId','operationId']) id(row[key]);
  for (const key of ['expectedRevision','expectedLifecycleGeneration']) if (row[key] !== null) id(row[key]);
  if (row.deletionId !== undefined) id(row.deletionId);
  if (Buffer.byteLength(JSON.stringify(row)) > SYNC_MAX_BYTES) throw new Error('payload_limit');
  if (row.kind !== 'upsert') {
    if (row.snapshot !== undefined) throw new Error('unexpected_snapshot');
    if (row.expectedRevision === null || row.expectedLifecycleGeneration === null) throw new Error('precondition_required');
    if ((row.kind === 'restore' || row.kind === 'purge') && row.deletionId === undefined) throw new Error('deletion_required');
    return row as unknown as SyncOperation;
  }
  const s = object(row.snapshot, ['title','kind','createdAt','language','text','passages','speakers','summaries','inkAttachments','sourceRevisionId','sourceVersions','selectedSummaryId','folderId','event','speakerTurns','transcriptStatus']);
  if(s.transcriptStatus!==undefined&&!['none','partial','interrupted','complete'].includes(String(s.transcriptStatus)))throw new Error('invalid_transcript_status');
  text(s.title,500); text(s.text,500_000); text(s.createdAt,40);
  if (!Number.isFinite(Date.parse(s.createdAt)) || !['note','meeting'].includes(String(s.kind)) || !['en-US','da-DK','es-ES','fr-FR','de-DE'].includes(String(s.language))) throw new Error('invalid_snapshot');
  const speakers = array(s.speakers, 100);
  unique(speakers, v => { const r=object(v,['id','displayName','sessionId','slot']); text(r.displayName,200); if(r.sessionId!==undefined)id(r.sessionId);if(r.slot!==undefined&&(!Number.isInteger(r.slot)||Number(r.slot)<0||Number(r.slot)>3))throw new Error('invalid_slot');return r; });
  const speakerIds = new Set(speakers.map(v => (v as {id:string}).id));
  unique(array(s.passages,SYNC_MAX_SEGMENTS), v => {
    const r=object(v,['id','sourceId','startMs','endMs','text','speakerId','isFinal','isUserEdited']); id(r.sourceId); text(r.text,10_000);if(r.isFinal!==undefined&&typeof r.isFinal!=='boolean')throw new Error('invalid_final');if(r.isUserEdited!==undefined&&typeof r.isUserEdited!=='boolean')throw new Error('invalid_correction');
    if (!Number.isSafeInteger(r.startMs) || !Number.isSafeInteger(r.endMs) || Number(r.startMs)<0 || Number(r.endMs)<Number(r.startMs)) throw new Error('invalid_anchor');
    if (r.speakerId !== undefined && !speakerIds.has(String(r.speakerId))) throw new Error('unknown_speaker');
    return r;
  });
  if(s.transcriptStatus==='complete'&&array(s.passages,SYNC_MAX_SEGMENTS).some(v=>(v as {isFinal?:boolean}).isFinal!==true))throw new Error('incomplete_passages');
  if(s.transcriptStatus==='none'&&array(s.passages,SYNC_MAX_SEGMENTS).length>0)throw new Error('unexpected_passages');
  id(s.sourceRevisionId);
  if(s.folderId!==undefined) id(s.folderId);
  if(s.event!==undefined) { const e=object(s.event,['provider','accountId','calendarId','eventId','occurrenceId']); for(const key of ['provider','accountId','calendarId','eventId','occurrenceId']) text(e[key],512); }
  const versions = array(s.sourceVersions,100);
  unique(versions, v => {
    const r=object(v,['id','title','text','passages','speakers','speakerTurns']); text(r.title,500); text(r.text,500_000);
    unique(array(r.speakers,100), value=>{const speaker=object(value,['id','displayName','sessionId','slot']);text(speaker.displayName,200);if(speaker.sessionId!==undefined)id(speaker.sessionId);if(speaker.slot!==undefined&&(!Number.isInteger(speaker.slot)||Number(speaker.slot)<0||Number(speaker.slot)>3))throw new Error('invalid_slot');return speaker;});
    unique(array(r.passages,SYNC_MAX_SEGMENTS), value=>{const passage=object(value,['id','sourceId','startMs','endMs','text','speakerId','isFinal','isUserEdited']);id(passage.sourceId);text(passage.text,10_000);if(passage.isFinal!==undefined&&typeof passage.isFinal!=='boolean')throw new Error('invalid_final');if(passage.isUserEdited!==undefined&&typeof passage.isUserEdited!=='boolean')throw new Error('invalid_correction');
      if(!Number.isSafeInteger(passage.startMs)||!Number.isSafeInteger(passage.endMs)||Number(passage.startMs)<0||Number(passage.endMs)<Number(passage.startMs)) throw new Error('invalid_anchor');
      if(passage.speakerId!==undefined&&!(r.speakers as Array<{id:string}>).some((speaker: {id:string})=>speaker.id===passage.speakerId)) throw new Error('unknown_speaker');return passage;});
    validateTurns(r.speakerTurns,r.speakers as Array<{id:string}>);
    return r;
  });
  validateTurns(s.speakerTurns,s.speakers as Array<{id:string}>);
  const sources = new Map(versions.map(v=>[(v as {id:string}).id,v as Record<string,unknown>]));
  const current = sources.get(s.sourceRevisionId);
  if(!current||current.title!==s.title||current.text!==s.text||canonical(current.passages)!==canonical(s.passages)||canonical(current.speakers)!==canonical(s.speakers)||canonical(current.speakerTurns)!==canonical(s.speakerTurns)) throw new Error('current_source_mismatch');
  const summaries=array(s.summaries,100);
  unique(summaries, v => { const r=object(v,['id','parentId','createdAt','origin','format','language','markdown','sources']);
    if(r.parentId!==undefined) id(r.parentId); text(r.createdAt,40); if(!Number.isFinite(Date.parse(r.createdAt))||!['generated','edited'].includes(String(r.origin))) throw new Error('invalid_summary');
    text(r.format,100); text(r.language,40); text(r.markdown,500_000);
    for(const value of array(r.sources,SYNC_MAX_SEGMENTS)) { const anchor=object(value,['libraryId','noteId','revisionId','kind','paragraphIndex','passageId','summaryId']);
      if(anchor.libraryId!==row.libraryId||anchor.noteId!==row.noteId) throw new Error('source_scope'); id(anchor.revisionId);
      if(anchor.kind==='summary') {
        id(anchor.summaryId);
        if(anchor.revisionId!==anchor.summaryId||anchor.paragraphIndex!==undefined||anchor.passageId!==undefined||
          !summaries.some(value=>(value as {id:string}).id===anchor.summaryId))throw new Error('missing_summary_source');
        continue;
      }
      if(anchor.summaryId!==undefined)throw new Error('invalid_anchor');
      const source=sources.get(anchor.revisionId); if(!source) throw new Error('missing_source');
      if(anchor.kind==='title') { if(anchor.paragraphIndex!==undefined||anchor.passageId!==undefined)throw new Error('invalid_anchor'); }
      else if(anchor.kind==='personalParagraph') { if(anchor.passageId!==undefined||!Number.isInteger(anchor.paragraphIndex)||Number(anchor.paragraphIndex)<0||Number(anchor.paragraphIndex)>=String(source.text).split('\n').length) throw new Error('missing_paragraph'); }
      else if(anchor.kind==='transcript') { if(anchor.paragraphIndex!==undefined)throw new Error('invalid_anchor'); id(anchor.passageId); if(!(source.passages as Array<{id:string}>).some(p=>p.id===anchor.passageId)) throw new Error('missing_passage'); }
      else throw new Error('invalid_anchor');
    } return r; });
  const summaryMap=new Map(summaries.map(v=>[(v as {id:string}).id,v as {id:string;parentId?:string}]));
  for(const summary of summaryMap.values()) { const seen=new Set<string>(); let node:typeof summary|undefined=summary;
    while(node) { if(seen.has(node.id))throw new Error('cyclic_summary');seen.add(node.id);if(node.parentId&&!summaryMap.has(node.parentId))throw new Error('missing_parent');node=node.parentId?summaryMap.get(node.parentId):undefined; }
  }
  const referencedSummaries=new Map(summaries.map(value=>{const summary=value as {id:string;sources:Array<{kind:string;summaryId?:string}>};return [summary.id,summary.sources.filter(source=>source.kind==='summary').map(source=>source.summaryId!)];}));
  const completedSources=new Set<string>();
  function visitSummarySource(id:string, visiting:Set<string>) {
    if(visiting.has(id))throw new Error('cyclic_summary_source');
    if(completedSources.has(id))return;
    visiting.add(id);for(const reference of referencedSummaries.get(id)??[])visitSummarySource(reference,visiting);
    visiting.delete(id);completedSources.add(id);
  }
  for(const id of referencedSummaries.keys())visitSummarySource(id,new Set());
  if(s.selectedSummaryId!==null&&!summaryMap.has(String(s.selectedSummaryId)))throw new Error('missing_selected_summary');
  unique(array(s.inkAttachments,1000), v => { const r=object(v,['id','versionId']); id(r.versionId); return r; });
  return row as unknown as SyncOperation;
}
