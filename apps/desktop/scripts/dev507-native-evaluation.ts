/** Standalone synthetic QA: current LocalNotesEngine + shared service, no Electron/profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LlamaChatSession } from 'node-llama-cpp'
import { LocalNotesEngine } from '../../../packages/ai/src/local-engine'
import { MainCitedAskService } from '../src/main/cited-ask-service'
import { LibraryActivity } from '../src/main/library-activity'
import {
  localSourceScope,
  resolveOriginalSource
} from '../../../packages/meetings-store/src/source-projection'
import {
  retrieveOriginalEvidence,
  validateOriginalEvidence
} from '../../../packages/meetings-store/src/evidence-retrieval'

const [root, corpusFile, modelPath, sourceSha, deniedSentinel] = process.argv.slice(2)
assert.ok(root?.startsWith('/private/tmp/dev507-native-'))
assert.equal(process.env.HOME, join(root, 'home'))
assert.throws(() => readFileSync(deniedSentinel), /EPERM|EACCES/)
assert.equal(lstatSync(modelPath).isSymbolicLink(), false)
const corpusBytes = readFileSync(corpusFile)
const corpusHash = createHash('sha256').update(corpusBytes).digest('hex')
assert.equal(corpusHash, '0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2')
const corpus = JSON.parse(corpusBytes.toString())
const dir = join(root, 'originals')
mkdirSync(dir)
const originals = new Map<string, string>()
const put = (d) => {
  const raw = JSON.stringify(d)
  originals.set(d.id, raw)
  writeFileSync(join(dir, d.id + '.json'), raw)
}
for (const d of corpus.documents) put(d)
for (let i = 0; i < corpus.filler.count; i++) {
  const { count: _, idPrefix, ...fields } = corpus.filler
  put({ id: idPrefix + String(i).padStart(4, '0'), ...fields })
}
const context = { meetingsDir: dir, scope: localSourceScope(dir, true), authorized: true }
const modelSha = '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'
const engine = new LocalNotesEngine({
  modelUri: 'qwen3-4b-instruct',
  modelPath,
  modelsDir: join(root, 'models'),
  contextSize: 16384
})
let stopping = false,
  activeAbort: AbortController | undefined
process.on('SIGTERM', () => {
  stopping = true
  activeAbort?.abort(new Error('Owned QA runner stopped'))
})
process.on('SIGINT', () => {
  stopping = true
  activeAbort?.abort(new Error('Owned QA runner stopped'))
})
let observed: unknown[] = []
const actualPrompt = LlamaChatSession.prototype.promptWithMeta
// Observer-only wrapper: records the actual arguments and native tokenizer at
// prompt entry, then forwards the exact prompt/options/this to the real method.
LlamaChatSession.prototype.promptWithMeta = async function (prompt, options) {
  const history = this.getChatHistory()
  const tokens = this.chatWrapper
    .generateContextState({
      chatHistory: [...history, { type: 'user', text: prompt }, { type: 'model', response: [] }]
    })
    .contextText.tokenize(this.model.tokenizer)
  const observation: Record<string, unknown> = {
    history,
    user: prompt,
    wireTokens: tokens,
    wireSha256: createHash('sha256').update(JSON.stringify(tokens)).digest('hex'),
    contextSize: this.context.contextSize,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    wrapper: this.chatWrapper.constructor.name
  }
  observed.push(observation)
  try {
    const result = await actualPrompt.call(this, prompt, options)
    observation.responseText = result.responseText
    observation.stopReason = result.stopReason
    return result
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}
let generation: any = null
let modelElapsedMs: number | null = null
const cited = new MainCitedAskService({
  activity: new LibraryActivity(),
  sources: {
    retrieveEvidence: async (s) => retrieveOriginalEvidence(context, s),
    validateEvidence: async (m) => validateOriginalEvidence(context, m),
    resolveAcknowledged: async (a) => resolveOriginalSource(context, a)
  },
  validateModel: async (id, revision) => id === engine.id && revision === modelSha,
  generate: async (input, signal) => {
    const started = Date.now()
    generation = { input }
    try {
      const output = await engine.askWithEvidence(input, { signal, phase: 'writing' })
      generation.output = output
      return { ...output, engineId: engine.id, modelArtifactRevision: modelSha }
    } finally {
      modelElapsedMs = Date.now() - started
    }
  }
})
const resume = existsSync(join(root, 'resume.json'))
  ? JSON.parse(readFileSync(join(root, 'resume.json'), 'utf8'))
  : { cases: [], priorAttempts: [] }
const summary = resume.cases
const completedIds = new Set(summary.map((c) => c.id))
const planned = resume.sliceIds
  ? corpus.cases.filter((c) => resume.sliceIds.includes(c.id))
  : corpus.cases
if (resume.sliceIds) {
  assert.equal(new Set(resume.sliceIds).size, resume.sliceIds.length)
  assert.equal(planned.length, resume.sliceIds.length)
}
const classifiedFailures = new Set(resume.classifiedFailures ?? [])
let repeatedFailure = '',
  repeatedFailureCount = 0,
  stoppedReason: string | null = null
try {
  for (const c of planned) {
    if (completedIds.has(c.id)) continue
    observed = []
    generation = null
    modelElapsedMs = null
    const start = Date.now(),
      abort = new AbortController()
    activeAbort = abort
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      abort.abort(new Error('Native QA case exceeded180s'))
    }, 180000)
    const phases: unknown[] = []
    const request = {
      purpose: 'library-ask' as const,
      selection: { mode: 'question' as const, question: c.question, filters: {} }
    }
    const control = {
      ownerId: 'isolated-native-qa',
      runId: c.id,
      signal: abort.signal,
      assertCurrent() {},
      onProgress(phase) {
        phases.push({ phase, elapsedMs: Date.now() - start })
      }
    }
    const result = await cited.run(request, control)
    const runElapsedMs = Date.now() - start,
      admissionStart = Date.now()
    const validation =
      result.status === 'error' ? null : await cited.validate(result.snapshot, request, control)
    const admissionElapsedMs = result.status === 'error' ? null : Date.now() - admissionStart
    await cited.cancel(control.ownerId, control.runId) // joins producer drain; never transfers ownership on timeout
    clearTimeout(deadline)
    const inclusion = generation?.output?.inclusion
    if (inclusion && observed.length) {
      assert.equal(inclusion.wireSha256, (observed.at(-1) as any).wireSha256)
      assert.equal(inclusion.inputTokens, (observed.at(-1) as any).wireTokens.length)
      assert.ok(
        inclusion.inputTokens + inclusion.outputReserveTokens + inclusion.safetyMarginTokens <=
          inclusion.contextWindowTokens
      )
    }
    const goldOnWire = c.gold.map((g) => {
      const raw = JSON.parse(originals.get(g.meetingId)!)
      const text = g.kind === 'personal' ? raw.rawNotesMarkdown : raw.segments[0].text
      assert.equal(text.slice(g.startUtf16, g.endUtf16), g.quote)
      let start = g.startUtf16,
        end = g.endUtf16,
        sourceId = 'transcript:original-segment'
      if (g.kind === 'personal') {
        const prefix = text.slice(0, start),
          lineStart = prefix.lastIndexOf('\n') + 1
        sourceId = 'personal:' + (prefix.split('\n').length - 1)
        start -= lineStart
        end -= lineStart
      }
      return !!inclusion?.ranges.some(
        (r) =>
          r.anchor.meetingId === g.meetingId &&
          r.anchor.sourceId === sourceId &&
          r.startUtf16 <= start &&
          r.endUtf16 >= end &&
          r.quote.includes(g.quote)
      )
    })
    const record = {
      id: c.id,
      category: c.category,
      retrievalSet: c.retrievalSet,
      sourceRun: root,
      startedAt: new Date(start).toISOString(),
      endedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      runElapsedMs,
      admissionElapsedMs,
      modelElapsedMs,
      caseDeadlineMs: 180000,
      timedOut,
      operatorInterrupted: stopping,
      cleanup: 'service run/cancel awaited',
      phases,
      status: result.status,
      code: result.status === 'error' ? result.code : null,
      message: result.status === 'error' ? result.message : null,
      validation,
      goldOnWire,
      wireObserved: observed.length > 0,
      inputTokens: inclusion?.inputTokens,
      contextSize: inclusion?.contextWindowTokens,
      budgetComplete: inclusion?.budgetComplete,
      claims: result.status === 'error' ? null : result.snapshot.claims
    }
    writeFileSync(
      join(root, 'evidence', c.id + '.json'),
      JSON.stringify(
        { record, gold: c.gold, expected: c.expected, generation, observed, result },
        null,
        2
      )
    )
    const rawFailureKey =
      result.status === 'error' && ['invalid-answer', 'model-failed'].includes(result.code)
        ? result.code + ':' + result.message
        : ''
    const failureKey = classifiedFailures.has(rawFailureKey) ? '' : rawFailureKey
    repeatedFailureCount =
      failureKey && failureKey === repeatedFailure ? repeatedFailureCount + 1 : failureKey ? 1 : 0
    repeatedFailure = failureKey
    if (repeatedFailureCount >= 3)
      stoppedReason =
        'Three consecutive identical protocol/runtime failures; bounded run paused for diagnosis.'
    summary.push(record)
    writeFileSync(
      join(root, 'summary.json'),
      JSON.stringify(
        {
          sourceSha,
          corpusHash,
          modelSha,
          temperature: 0.3,
          nativeModel: true,
          transport: 'standalone Node; direct original I/O adapter; no Electron/IPC/native capture',
          semanticHumanScore: 'UNPERFORMED',
          completed: summary.length,
          total: corpus.cases.length,
          unperformed: corpus.cases
            .filter((c) => !summary.some((r) => r.id === c.id))
            .map((c) => c.id),
          stoppedReason,
          plannedCaseIds: planned.map((c) => c.id),
          classifiedFailures: [...classifiedFailures],
          priorAttempts: resume.priorAttempts,
          cases: summary
        },
        null,
        2
      )
    )
    console.log(JSON.stringify(record))
    activeAbort = undefined
    if (stopping || stoppedReason) break
  }
  writeFileSync(
    join(root, 'slice-completion.json'),
    JSON.stringify(
      {
        plannedCaseIds: planned.map((c) => c.id),
        remainingPlanned: planned
          .filter((c) => !summary.some((r) => r.id === c.id))
          .map((c) => c.id),
        stoppedReason,
        operatorInterrupted: stopping,
        totalUniqueCases: summary.length
      },
      null,
      2
    )
  )
  for (const [id, raw] of originals)
    assert.equal(readFileSync(join(dir, id + '.json'), 'utf8'), raw)
  writeFileSync(
    join(root, 'original-integrity.json'),
    JSON.stringify({ unchanged: true, count: originals.size })
  )
} finally {
  LlamaChatSession.prototype.promptWithMeta = actualPrompt
  await engine.dispose()
}
