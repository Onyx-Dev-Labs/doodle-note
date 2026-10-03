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

test('transcript completion and provisional passages survive validation without implying finality', () => {
  const libraryId = randomUUID(), noteId = randomUUID(), sourceId = randomUUID();
  const passages = [{id: randomUUID(), sourceId: randomUUID(), startMs: 0, endMs: 1000, text: 'Provisional', isFinal: false}];
  const operation: SyncOperation = {protocolVersion: 2, libraryId, noteId, operationId: randomUUID(),
    expectedRevision: null, expectedLifecycleGeneration: null, kind: 'upsert', snapshot: {
      title: 'Interrupted meeting', kind: 'meeting', transcriptStatus: 'interrupted', createdAt: '2026-09-07',
      language: 'en-US', text: 'Typed notes remain usable', passages, speakers: [], summaries: [], selectedSummaryId: null, inkAttachments: [],
      sourceRevisionId: sourceId, sourceVersions: [{id: sourceId, title: 'Interrupted meeting', text: 'Typed notes remain usable', passages, speakers: []}]
    }};
  assert.deepEqual(validateSyncOperation(operation), operation);
  const absent = structuredClone(operation);
  delete absent.snapshot!.transcriptStatus;
  delete absent.snapshot!.passages[0]!.isFinal;
  delete absent.snapshot!.sourceVersions[0]!.passages[0]!.isFinal;
  assert.deepEqual(validateSyncOperation(absent), absent, 'old payloads remain absent, never upgraded to complete');
  assert.throws(() => validateSyncOperation({...operation, snapshot: {...operation.snapshot, transcriptStatus: 'recording_audio'}}), /invalid_transcript_status/);
});


test('optional human correction markers survive head and history validation and reject non-booleans', () => {
  const libraryId = randomUUID(), noteId = randomUUID(), sourceId = randomUUID();
  const passages = [{id: randomUUID(), sourceId: randomUUID(), startMs: 0, endMs: 1000,
    text: 'Reviewed correction', isFinal: true, isUserEdited: true}];
  const operation: SyncOperation = {protocolVersion: 2, libraryId, noteId, operationId: randomUUID(),
    expectedRevision: null, expectedLifecycleGeneration: null, kind: 'upsert', snapshot: {
      title: 'Synthetic meeting', kind: 'meeting', createdAt: '2026-09-07', language: 'en-US', text: '',
      passages, speakers: [], summaries: [], selectedSummaryId: null, inkAttachments: [], sourceRevisionId: sourceId,
      sourceVersions: [{id: sourceId, title: 'Synthetic meeting', text: '', passages: structuredClone(passages), speakers: []}]
    }};
  assert.deepEqual(validateSyncOperation(operation), operation);
  for (const target of ['head', 'history']) {
    const invalid = structuredClone(operation);
    const row = target === 'head' ? invalid.snapshot!.passages[0]! : invalid.snapshot!.sourceVersions[0]!.passages[0]!;
    Object.assign(row, {isUserEdited: 'true'});
    assert.throws(() => validateSyncOperation(invalid), /invalid_correction/);
  }
  delete operation.snapshot!.passages[0]!.isUserEdited;
  delete operation.snapshot!.sourceVersions[0]!.passages[0]!.isUserEdited;
  assert.deepEqual(validateSyncOperation(operation), operation, 'legacy absent markers remain valid');
});
