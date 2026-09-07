import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {validateSyncOperation, type SyncOperation} from './sync-contract';

test('native title and immutable-summary sources validate without rewriting note revisions', () => {
  const libraryId=randomUUID(), noteId=randomUUID(), sourceId=randomUUID(), first=randomUUID(), second=randomUUID();
  const anchor={libraryId,noteId,revisionId:sourceId,kind:'title' as const};
  const operation:SyncOperation={protocolVersion:2,libraryId,noteId,operationId:randomUUID(),expectedRevision:null,expectedLifecycleGeneration:null,kind:'upsert',snapshot:{
    title:'Synthetic title',kind:'note',createdAt:'2026-09-06',language:'en-US',text:'Text',passages:[],speakers:[],sourceRevisionId:sourceId,
    sourceVersions:[{id:sourceId,title:'Synthetic title',text:'Text',passages:[],speakers:[]}],selectedSummaryId:second,inkAttachments:[],
    summaries:[{id:first,createdAt:'2026-09-06',origin:'generated',format:'general',language:'en-US',markdown:'First',sources:[anchor]},
      {id:second,createdAt:'2026-09-06',origin:'generated',format:'general',language:'en-US',markdown:'Second',sources:[{libraryId,noteId,revisionId:first,kind:'summary',summaryId:first}]}]
  }};
  assert.deepEqual(validateSyncOperation(operation),operation);
  const dangling=structuredClone(operation);dangling.snapshot!.summaries[1]!.sources[0]!.summaryId=randomUUID();
  assert.throws(()=>validateSyncOperation(dangling),/missing_summary_source/);
  const cyclic=structuredClone(operation);cyclic.snapshot!.summaries[0]!.sources=[{libraryId,noteId,revisionId:second,kind:'summary',summaryId:second}];
  assert.throws(()=>validateSyncOperation(cyclic),/cyclic_summary_source/);
  const foreign=structuredClone(operation);foreign.snapshot!.summaries[1]!.sources[0]!.libraryId=randomUUID();
  assert.throws(()=>validateSyncOperation(foreign),/source_scope/);
});
