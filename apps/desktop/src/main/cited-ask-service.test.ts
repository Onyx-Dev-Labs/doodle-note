import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '@repo/meetings-store/evidence'
import { localSourceScope, resolveOriginalSource } from '@repo/meetings-store/sources'
import { buildCitedAskPrompt, type CitedPromptInput } from '@repo/ai'
import * as serviceModule from './cited-ask-service'
import type { CitedAskRequest, CitedAnswerSnapshot } from '../shared/cited-ask-api'
import { LibraryActivity } from './library-activity'

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dev507-service-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const context = { meetingsDir: root, scope: localSourceScope(root, true), authorized: true }
  const put = (id: string, text: string) =>
    writeFileSync(
      join(root, id + '.json'),
      JSON.stringify({ id, rawNotesMarkdown: text, createdAt: '2020-01-01T00:00:00Z' })
    )
  put('old', 'Orchid ships Friday.')
  put('unrelated', 'Orchid ships Tuesday.')
  const history = join(root, '.history.json')
  writeFileSync(history, 'prior history bytes')
  let generated = 0
  let mutate: () => void = () => {}
  let output: (ids: string[]) => unknown = (ids) => ({
    status: 'answered',
    claims: [
      { id: 'claim', kind: 'paraphrase', text: 'Orchid ships Friday.', evidenceIds: [ids[0]] }
    ]
  })
  const sources = {
    retrieveEvidence: async (s: Parameters<typeof retrieveOriginalEvidence>[1]) =>
      retrieveOriginalEvidence(context, s),
    validateEvidence: async (m: Parameters<typeof validateOriginalEvidence>[1]) =>
      validateOriginalEvidence(context, m),
    resolve: async (a: Parameters<typeof resolveOriginalSource>[1]) =>
      resolveOriginalSource(context, a)
  }
  const generate = async (input: CitedPromptInput) => {
    generated++
    const p = buildCitedAskPrompt(input, {
      contextWindowTokens: 16384,
      outputReserveTokens: 4096,
      safetyMarginTokens: 256,
      accounting: 'model-tokenizer',
      countInputTokens: (s, u) => Buffer.byteLength(s + u)
    })
    mutate()
    return {
      rawJson: JSON.stringify(output(p.inclusion.ranges.map((r) => r.id))),
      inclusion: p.inclusion,
      engineId: 'local:synthetic',
      modelArtifactRevision: 'artifact'
    }
  }
  assert.equal(typeof serviceModule.MainCitedAskService, 'function')
  const service = new serviceModule.MainCitedAskService({
    sources,
    generate,
    validateModel: async () => true,
    activity: new LibraryActivity()
  })
  const request: CitedAskRequest = {
    purpose: 'calendar-brief',
    selection: { mode: 'linked-history', meetingIds: ['old'] },
    context: { templateVersion: 1, eventText: 'Synthetic event' },
    consumerRevision: 'revision-1'
  }
  const control = {
    ownerId: 'owner',
    runId: 'run',
    signal: new AbortController().signal,
    assertCurrent: () => {}
  }
  return {
    root,
    context,
    put,
    history,
    sources,
    generate,
    service,
    request,
    control,
    generated: () => generated,
    setMutation: (fn: () => void) => {
      mutate = fn
    },
    setOutput: (fn: typeof output) => {
      output = fn
    }
  }
}
test('second consumer uses only explicit originals and writes no Home history; all non-error states validate current request', async (t) => {
  const f = fixture(t)
  const result = await f.service.run(f.request, f.control)
  assert.equal(result.status, 'complete')
  assert.deepEqual(
    result.snapshot.evidence.meetings.map((m) => m.meetingId),
    ['old']
  )
  assert.equal((await f.service.validate(result.snapshot, f.request, f.control)).status, 'valid')
  assert.equal(readFileSync(f.history, 'utf8'), 'prior history bytes')
  const empty = { ...f.request, selection: { mode: 'linked-history' as const, meetingIds: [] } }
  const noHistory = await f.service.run(empty, { ...f.control, runId: 'empty' })
  assert.equal(noHistory.status, 'no-history')
  assert.equal(f.generated(), 1)
  {
    assert.equal((await f.service.validate(noHistory.snapshot, empty, f.control)).status, 'valid')
    assert.equal(
      (await f.service.validate(noHistory.snapshot, f.request, f.control)).status,
      'stale'
    )
  }
  assert.equal(
    (
      await f.service.validate(
        result.snapshot,
        { ...f.request, context: { templateVersion: 1, eventText: 'changed context' } },
        f.control
      )
    ).status,
    'stale'
  )
})
test('incomplete scan never invokes model; incompleteness after generation withholds answer and preserves history', async (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'old.json'), '{')
  const before = await f.service.run(f.request, f.control)
  assert.equal(before.status, 'error')
  if (before.status === 'error') assert.equal(before.code, 'unavailable')
  assert.equal(f.generated(), 0)
  f.put('old', 'Orchid ships Friday.')
  f.setMutation(() => writeFileSync(join(f.root, 'old.json'), '{'))
  const after = await f.service.run(f.request, { ...f.control, runId: 'after' })
  assert.equal(after.status, 'error')
  assert.equal(f.generated(), 1)
  assert.equal(readFileSync(f.history, 'utf8'), 'prior history bytes')
})
test('source mutation or caller invalidation after inference cannot produce a late answer', async (t) => {
  const f = fixture(t)
  f.setMutation(() => f.put('old', 'Edited Friday'))
  const result = await f.service.run(f.request, f.control)
  assert.equal(result.status, 'error')
  if (result.status === 'error') assert.equal(result.code, 'stale')
  assert.equal(readFileSync(f.history, 'utf8'), 'prior history bytes')
})
for (let i = 0; i < 32; i++)
  test(`hostile output ${i} is rejected without a snapshot`, async (t) => {
    const f = fixture(t)
    f.setOutput((ids) => {
      const claim = { id: 'claim', kind: 'paraphrase', text: 'Claim', evidenceIds: [ids[0]] }
      switch (i % 8) {
        case 0:
          return { status: 'answered', claims: [{ ...claim, evidenceIds: ['invented-' + i] }] }
        case 1:
          return { status: 'answered', claims: [{ ...claim, evidenceIds: [] }] }
        case 2:
          return { status: 'answered', claims: [{ ...claim, kind: 'action' }] }
        case 3:
          return { status: 'answered', claims: [{ ...claim, url: 'file:///private' }] }
        case 4:
          return { status: 'answered', claims: Array(13).fill(claim) }
        case 5:
          return { status: 'answered', claims: [{ ...claim, evidenceIds: Array(5).fill(ids[0]) }] }
        case 6:
          return { status: 'insufficient-evidence', claims: [claim] }
        default:
          return { status: 'answered', claims: [{ ...claim, text: 9 }] }
      }
    })
    const result = await f.service.run(f.request, f.control)
    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid-answer')
    assert.equal(readFileSync(f.history, 'utf8'), 'prior history bytes')
  })
test('altered stored range, scope, revision, prompt membership and missing manifests fail closed', async (t) => {
  const f = fixture(t)
  const result = await f.service.run(f.request, f.control)
  assert.notEqual(result.status, 'error')
  if (result.status === 'error') return
  const mutations: Array<(s: CitedAnswerSnapshot) => void> = [
    (s) => {
      s.prompt!.ranges[0]!.quote = 'other'
    },
    (s) => {
      s.prompt!.ranges = []
    },
    (s) => {
      s.evidence.manifest.scope.libraryId = 'wrong'
    },
    (s) => {
      s.evidence.ranges[0]!.anchor.revisionId = 'b'.repeat(64)
    },
    (s) => {
      s.evidence.coverage.scanComplete = false
    },
    (s) => {
      s.version = 2 as 1
    }
  ]
  for (const mutate of mutations) {
    const snapshot = structuredClone(result.snapshot)
    mutate(snapshot)
    assert.notEqual((await f.service.validate(snapshot, f.request, f.control)).status, 'valid')
  }
})

test('request digest normalizes subset order/dedup but binds topic, text and explicit membership for every empty state',async t=>{
  const f=fixture(t)
  const request={...f.request,selection:{mode:'linked-history' as const,meetingIds:['old','unrelated','old']}}
  const result=await f.service.run(request,f.control);assert.notEqual(result.status,'error');if(result.status==='error')return
  assert.match(result.snapshot.requestSha256!,/^[a-f0-9]{64}$/)
  const equivalent={...request,selection:{mode:'linked-history' as const,meetingIds:['unrelated','old']}}
  assert.equal((await f.service.validate(result.snapshot,equivalent,f.control)).status,'valid')
  for(const changed of [{...equivalent,selection:{...equivalent.selection,topic:'new topic'}},{...equivalent,selection:{...equivalent.selection,meetingIds:['old']}},{...equivalent,context:{templateVersion:1 as const,eventText:'new text'}}])assert.equal((await f.service.validate(result.snapshot,changed,f.control)).status,'stale')
  const missing=structuredClone(result.snapshot);delete missing.requestSha256;assert.equal((await f.service.validate(missing,equivalent,f.control)).status,'stale')
  const none=await f.service.run({purpose:'library-ask',selection:{mode:'question',question:'unmatched',filters:{}}},{...f.control,runId:'no-match'})
  assert.equal(none.status,'insufficient-evidence');if(none.status==='insufficient-evidence')assert.match(none.snapshot.requestSha256!,/^[a-f0-9]{64}$/)
})
test('owner-scoped cancel waits for model cleanup and retry cannot overlap the producer',async t=>{
  const f=fixture(t);let release!:()=>void;const cleanup=new Promise<void>(resolve=>{release=resolve})
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve});let aborted=false
  const service=new serviceModule.MainCitedAskService({sources:f.sources,validateModel:async()=>true,generate:async(input,signal)=>{
    started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve()},{once:true}));await cleanup;return f.generate(input)
  }})
  const first=service.run(f.request,f.control);await ready
  await service.cancel('other','run');assert.equal(aborted,false)
  const cancelling=service.cancel('owner','run');await new Promise(resolve=>setImmediate(resolve));assert.equal(aborted,true)
  assert.equal((await service.run(f.request,{...f.control,runId:'retry'})).status,'error')
  release();await cancelling;const result=await first;assert.equal(result.status,'error');if(result.status==='error')assert.equal(result.code,'cancelled')
  assert.equal(readFileSync(f.history,'utf8'),'prior history bytes')
})
