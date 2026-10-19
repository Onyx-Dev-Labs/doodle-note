/** QA-only observer/ledger. No production mutation, repair, retry or fake inference. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, lstatSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Llama, LlamaChatSession, LlamaModel, LlamaContext } from 'node-llama-cpp'
import { LocalNotesEngine as ControlEngine } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/src/local-engine'

import * as controlPrompt from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/ai/src/cited-ask-prompt'

import { MainCitedAskService } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/apps/desktop/src/main/cited-ask-service'
import { LibraryActivity } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/apps/desktop/src/main/library-activity'
import { CITED_ASK_PROMPT_VERSION } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/apps/desktop/src/shared/cited-ask-api'
import { localSourceScope, resolveOriginalSource } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/meetings-store/src/source-projection'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/packages/meetings-store/src/evidence-retrieval'

const [root, corpusFile, modelPath, sourceSha, deniedSentinel] = process.argv.slice(2)
assert.ok(root.startsWith('/private/tmp/dev507-quality-'))
assert.equal(process.env.HOME, join(root, 'home'))
assert.equal(sourceSha, 'fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8')
assert.equal(CITED_ASK_PROMPT_VERSION, 2)
assert.throws(() => readFileSync(deniedSentinel), /EPERM|EACCES/)
assert.equal(lstatSync(modelPath).isSymbolicLink(), false)
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const durable = (name: string, value: unknown) => {
  const p = join(root, name)
  writeFileSync(p, JSON.stringify(value, null, 2) + '\n')
  const fd = openSync(p, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
}
const initial = JSON.parse(readFileSync(join(root, 'initial-ledger.json'), 'utf8'))
const ids = ['answer-04', 'answer-06', 'must-03', 'must-09', 'answer-01', 'answer-02', 'conflict-01', 'unknown-01']
assert.deepEqual(initial.caseOrder, ids)
const corpusBytes = readFileSync(corpusFile), corpusHash = hash(corpusBytes)
assert.equal(corpusHash, '0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2')
const corpus = JSON.parse(corpusBytes.toString())
const planned = ids.map(id => { const c = corpus.cases.find(c => c.id === id); assert.ok(c); return c })
const summary: any = { ...initial, corpusHash, startedAt: new Date().toISOString(), semanticHumanScore: 'UNPERFORMED', productionGate: 'OFF', stoppedReason: null, preflight: [], samplingCalls: 0 }
const armHashes = JSON.parse(readFileSync(join(root, 'arm-hashes.json'), 'utf8'))
const prior = Object.fromEntries(ids.slice(0,6).map(id => [id, JSON.parse(readFileSync(join(root, 'prior', id + '.json'), 'utf8'))]))
let arm = 'qwen', mode = 'preflight', fatalIntegrityReason: string | null = null
let engine: any, model: any
const armPrompt = () => controlPrompt
const originalsDir = () => join(root, 'arms', arm, 'originals')
const original = (id: string) => readFileSync(join(originalsDir(), id + '.json'), 'utf8')
const sourceContext = () => ({ meetingsDir: originalsDir(), scope: localSourceScope(originalsDir()), authorized: true })
const modelConfig = JSON.parse(readFileSync(join(root,'model-config.json'),'utf8'))
let modelSha = modelConfig.qwen.sha256
const makeEngine = () => { modelSha = modelConfig[arm].sha256; return new ControlEngine({ modelUri: modelConfig[arm].uri, modelPath: modelConfig[arm].path, modelsDir: join(root,'models'), contextSize:16384 }) }
function invariant(work: () => void) { try { work() } catch(error) { fatalIntegrityReason = String(error); throw error } }
function originalsIntegrity() {
  for (const a of ['qwen','gemma']) for (const [name, expected] of Object.entries(armHashes[a].originals))
    invariant(() => assert.equal(hash(readFileSync(join(root, 'arms', a, 'originals', name))), expected))
}
function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
}
function assertSchemaOrder(schema: any) {
  let claims=0
  function visit(node:any) { if (!node || typeof node !== 'object') return
    if(node.properties?.evidenceIds) { invariant(()=>assert.deepEqual(Object.keys(node.properties),['id','text','kind','evidenceIds'])); claims++ }
    Object.values(node).forEach(x=>Array.isArray(x)?x.forEach(visit):visit(x))
  }
  visit(schema)
  invariant(()=>assert.ok(claims>0))
  return {recognizedClaimOccurrences:claims,order:['id','text','kind','evidenceIds'],canonicalSha256:hash(JSON.stringify(canonical(schema)))}
}
function goldIncluded(c:any,input:any,inclusion:any,user:string) {
 const wire=JSON.parse(user)
 return c.gold.map(g=>{
  const raw=JSON.parse(original(g.meetingId)),text=g.kind==='personal'?raw.rawNotesMarkdown:raw.segments[0].text
  invariant(()=>assert.equal(text.slice(g.startUtf16,g.endUtf16),g.quote))
  let start=g.startUtf16,end=g.endUtf16,sourceId='transcript:original-segment'
  if(g.kind==='personal'){const prefix=text.slice(0,start),lineStart=prefix.lastIndexOf('\n')+1;sourceId='personal:'+(prefix.split('\n').length-1);start-=lineStart;end-=lineStart}
  return wire.evidence.some(r=>{const base=inclusion.ranges.find(x=>x.id===r.id);return base?.anchor.meetingId===g.meetingId&&base.anchor.sourceId===sourceId&&base.startUtf16<=start&&base.endUtf16>=end&&r.quote.includes(g.quote)})
 })
}

originalsIntegrity()
let active: any = null, activeAbort: AbortController | undefined, stopping = false
const allEvents: any[] = []
const elapsed = () => active ? performance.now() - active.monotonicStart : null
function event(kind: string, extra = {}) {
  const e = { kind, at: new Date().toISOString(), arm, mode, caseId: active?.id ?? null, elapsedMs: elapsed(), ...extra }
  allEvents.push(e); durable('events.json', allEvents)
  if (active) { active.events.push(e); durable((mode === 'preflight' ? 'preflight/' : 'evidence/') + arm + '-' + active.id + '.json', active) }
}
function handleStop(signal) {
  if (stopping) return
  stopping = true; summary.stoppedReason = 'Owned process received ' + signal
  event('owned-stop-signal', { signal })
  activeAbort?.abort(new Error('Owned QA runner stopped: ' + signal))
}
process.once('SIGTERM', () => handleStop('SIGTERM'))
process.once('SIGINT', () => handleStop('SIGINT'))
const actualLoadModel = Llama.prototype.loadModel
const actualGrammar = Llama.prototype.createGrammarForJsonSchema
const actualPrompt = LlamaChatSession.prototype.promptWithMeta
const actualCreateContext = LlamaModel.prototype.createContext
const actualContextDispose = LlamaContext.prototype.dispose
const actualModelDispose = LlamaModel.prototype.dispose
const grammars = new WeakMap<object, { runtime: object; record: any }>()
const runtimeIds = new WeakMap<object, string>()
let nextRuntime = 0
function runtimeInfo(runtime) {
  if (!runtimeIds.has(runtime)) runtimeIds.set(runtime, 'runtime-' + (++nextRuntime))
  return { id: runtimeIds.get(runtime), gpu: runtime.gpu, buildType: runtime.buildType, llamaCppRelease: runtime.llamaCppRelease }
}
Llama.prototype.loadModel = async function(...args) { invariant(() => { assert.equal(this.gpu, 'metal'); assert.equal(this.buildType, 'prebuilt') }); let loaded; try { loaded = await actualLoadModel.apply(this, args) } catch(error) { activeAbort?.abort(error); event('model-load-error',{error:String(error)}); throw error }; model = loaded; event('model-loaded', { runtime: runtimeInfo(this), memory:process.memoryUsage() }); return loaded }
Llama.prototype.createGrammarForJsonSchema = async function(schema) {
  const start = performance.now()
  const record: any = { schema: JSON.parse(JSON.stringify(schema)), schemaSha256: hash(JSON.stringify(schema)), runtime: runtimeInfo(this), startedAt: new Date().toISOString() }
  record.orderCheck = assertSchemaOrder(schema)
  if (mode === 'sampling') invariant(() => { const prepared=JSON.parse(readFileSync(join(root,'preflight',arm+'-'+active.id+'.json'),'utf8')); assert.deepEqual(schema,prepared.preflight.schema) })
  active.grammar.push(record); event('grammar-start', { schemaSha256: record.schemaSha256 })
  try {
    const grammar = await actualGrammar.call(this, schema)
    Object.assign(record, { elapsedMs: performance.now() - start, grammar: grammar.grammar, grammarSha256: hash(grammar.grammar), rootRuleName: grammar.rootRuleName, trimWhitespaceSuffix: grammar.trimWhitespaceSuffix, completed: true })
    if (mode === 'sampling') invariant(() => { const prepared=JSON.parse(readFileSync(join(root,'preflight',arm+'-'+active.id+'.json'),'utf8')); assert.equal(grammar.grammar,prepared.grammar[0].grammar) })
    grammars.set(grammar, { runtime: this, record })
    event('grammar-complete', { elapsedMs: record.elapsedMs, grammarSha256: record.grammarSha256 })
    return grammar
  } catch (error) {
    record.error = String(error); record.elapsedMs = performance.now() - start
    event('grammar-error', { error: String(error) }); throw error
  }
}
LlamaModel.prototype.createContext = async function(...args) {
  const start = performance.now(); event('context-start', { requested: args[0], runtime: runtimeInfo(this.llama) })
  try { const result = await actualCreateContext.apply(this, args); event('context-created', { memory:process.memoryUsage(), contextSize: result.contextSize, elapsedMs: performance.now() - start }); return result }
  catch(error) { event('context-error', { error: String(error) }); activeAbort?.abort(error); throw error }
}
LlamaContext.prototype.dispose = async function(...args) {
  const start = performance.now(); event('context-dispose-start')
  try { const result = await actualContextDispose.apply(this, args); event('context-dispose-end', { disposed: this.disposed, elapsedMs: performance.now() - start }); return result }
  catch(error) { event('context-dispose-error', { error: String(error) }); throw error }
}
LlamaModel.prototype.dispose = async function(...args) {
  event('model-dispose-start')
  try { const result = await actualModelDispose.apply(this, args); event('model-dispose-end', { disposed: this.disposed }); return result }
  catch(error) { event('model-dispose-error', { error: String(error) }); throw error }
}
LlamaChatSession.prototype.promptWithMeta = async function(prompt, options) {
  invariant(() => assert.equal(mode, 'sampling', 'preflight must never call native promptWithMeta'))
  invariant(() => { assert.equal(summary.preflightPassed, true); assert.ok(summary.samplingCalls < 10) })
  invariant(() => assert.deepEqual(initial.samplingOrder[summary.samplingCalls], { arm, id: active.id }))
  summary.samplingCalls++; durable('summary.json', summary)
  const history = this.getChatHistory()
  const tokens = this.chatWrapper.generateContextState({ chatHistory: [...history, { type: 'user', text: prompt }, { type: 'model', response: [] }] }).contextText.tokenize(this.model.tokenizer)
  const compiled = grammars.get(options.grammar)
  invariant(() => {
    assert.ok(compiled, 'native grammar returned by observed current runtime must be supplied')
    assert.equal(compiled.runtime, this.model.llama)
  })
  const wire = JSON.parse(prompt)
  invariant(() => {
    assert.equal(history[0].text, armPrompt().CITED_ASK_SYSTEM)
    assert.equal(prompt, active.expectedPrompt.user)
    assert.equal(hash(JSON.stringify(tokens)), active.expectedPrompt.inclusion.wireSha256)
  })
  function evidenceEnums(node): string[][] {
    if (!node || typeof node !== 'object') return []
    const found = node.properties?.evidenceIds?.items?.enum ? [node.properties.evidenceIds.items.enum] : []
    return [...found, ...Object.values(node).flatMap(x => Array.isArray(x) ? x.flatMap(evidenceEnums) : evidenceEnums(x))]
  }
  const enums = evidenceEnums(compiled.record.schema)
  invariant(() => {
    assert.ok(enums.length)
    for (const list of enums) assert.deepEqual(list, [...new Set(wire.evidence.map(r => r.id))])
    assert.equal(this.context.contextSize, 16384)
    assert.equal(options.maxTokens, 4096)
    assert.equal(options.temperature, 0.3)
  })
  const observation: any = { history, user: prompt, wireTokens: tokens, wireSha256: hash(JSON.stringify(tokens)), contextSize: this.context.contextSize, temperature: options.temperature, maxTokens: options.maxTokens, outputReserveTokens: 4096, safetyMarginTokens: 256, wrapper: this.chatWrapper.constructor.name, runtime: runtimeInfo(this.model.llama), actualGrammarObjectSupplied: true, grammarSameModelRuntime: true, schemaSha256: compiled.record.schemaSha256, grammarSha256: compiled.record.grammarSha256, evidenceIdEnum: enums[0], startedAt: new Date().toISOString(), meterBefore: this.sequence.tokenMeter.getState() }
  active.observed.push(observation); event('native-prompt-start')
  const start = performance.now()
  try {
    const result = await actualPrompt.call(this, prompt, options)
    Object.assign(observation, { responseText: result.responseText, stopReason: result.stopReason, responseTextSha256: hash(result.responseText), elapsedMs: performance.now() - start, meterAfter: this.sequence.tokenMeter.getState(), tokenUsage: this.sequence.tokenMeter.diff(observation.meterBefore) })
    try {
      const parsed = JSON.parse(result.responseText)
      observation.nativeOutputKeyOrder = { root: Object.keys(parsed), claims: parsed.claims.map(c => Object.keys(c)) }
    } catch(error) { observation.nativeOutputKeyOrderError = String(error) }
    event('native-response-before-forward', { stopReason: result.stopReason, responseTextSha256: observation.responseTextSha256 })
    return result // exact native result object; no repair/trim/substitution
  } catch(error) {
    Object.assign(observation, { error: String(error), elapsedMs: performance.now() - start, meterAfter: this.sequence.tokenMeter.getState(), tokenUsage: this.sequence.tokenMeter.diff(observation.meterBefore) })
    event('native-prompt-error', { error: String(error) }); throw error
  }
}
function measuredSource(kind, work) {
  const start = performance.now()
  try { return work() } finally { active?.sourceOperations.push({ kind, elapsedMs: performance.now() - start }) }
}
const cited = new MainCitedAskService({
  activity: new LibraryActivity(),
  sources: {
    retrieveEvidence: async s => measuredSource('retrieve', () => retrieveOriginalEvidence(sourceContext(), s)),
    validateEvidence: async m => measuredSource('manifest-validate', () => validateOriginalEvidence(sourceContext(), m)),
    resolveAcknowledged: async a => measuredSource('resolve', () => resolveOriginalSource(sourceContext(), a))
  },
  validateModel: async (id, revision) => id === engine.id && revision === modelSha,
  generate: async (input, signal) => {
    if (prior[active.id]) invariant(() => assert.deepEqual(JSON.parse(JSON.stringify(input)), prior[active.id].generation.input))
    if (mode === 'preflight') {
      await engine.prepare(signal)
      signal.throwIfAborted()
      const ctx = await model.createContext({ contextSize: 16384 })
      try {
        const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: armPrompt().CITED_ASK_SYSTEM })
        const tokenArray = (user: string) => session.chatWrapper.generateContextState({ chatHistory: [...session.getChatHistory(), { type: 'user', text: user }, { type: 'model', response: [] }] }).contextText.tokenize(model.tokenizer)
        const prompt = armPrompt().buildCitedAskPrompt(input, { contextWindowTokens: ctx.contextSize, outputReserveTokens: 4096, safetyMarginTokens: 256, accounting: 'model-tokenizer', countInputTokens: (_s, user) => tokenArray(user).length, wireSha256: (_s, user) => hash(JSON.stringify(tokenArray(user))) })
        const schema = armPrompt().buildCitedAnswerSchema(prompt.inclusion.ranges)
        active.preflight = { input, prompt, schema, wireTokens: tokenArray(prompt.user), wrapper: session.chatWrapper.constructor.name, runtime: runtimeInfo(model.llama) }
        invariant(() => {
          assert.equal(ctx.contextSize,16384)
          assert.ok(prompt.inclusion.inputTokens+4096+256<=16384)
          assert.equal(prompt.system,controlPrompt.CITED_ASK_SYSTEM)
          assertSchemaOrder(schema)
        })
        active.preflight.goldOnWire=goldIncluded(planned.find(c=>c.id===active.id),input,prompt.inclusion,prompt.user)
        const old=prior[active.id]
        active.preflight.priorComparison=old?{
          selectedInputEqual:JSON.stringify(input)===JSON.stringify(old.generation.input),
          userEqual:prompt.user===old.observed[0].user,
          wireEqual:prompt.inclusion.wireSha256===old.generation.output.inclusion.wireSha256,
          wrapper:session.chatWrapper.constructor.name,priorWrapper:old.observed[0].wrapper,
          inputTokens:prompt.inclusion.inputTokens,priorInputTokens:old.generation.output.inclusion.inputTokens,
          includedIds:prompt.inclusion.ranges.map(r=>r.id),priorIncludedIds:old.generation.output.inclusion.ranges.map(r=>r.id),
          omissions:prompt.inclusion.omittedRangeIds,priorOmissions:old.generation.output.inclusion.omittedRangeIds
        }:null
        if(active.preflight.goldOnWire.some(x=>!x)) throw new Error('COMPATIBILITY_LIMIT: must-gold dropped before sampling')
        await model.llama.createGrammarForJsonSchema(schema)
        signal.throwIfAborted()
      } finally { await ctx.dispose() }
      throw new Error('QA_PREFLIGHT_ONLY_NO_SAMPLING')
    }
    const frozen = JSON.parse(readFileSync(join(root, 'preflight', arm + '-' + active.id + '.json'), 'utf8')).preflight
    active.expectedPrompt = frozen.prompt
    const start = performance.now(); active.generation = { input }; event('adapter-start')
    try {
      const output = await engine.askWithEvidence(input, { signal, phase: 'writing' })
      active.generation.output = output
      const observed = active.observed.at(-1)
      if (observed) {
        invariant(() => {
        assert.equal(output.rawJson, observed.responseText)
        assert.equal(output.inclusion.wireSha256, observed.wireSha256)
        assert.equal(output.inclusion.inputTokens, observed.wireTokens.length)
        assert.deepEqual(output.inclusion.ranges.map(r => r.id), observed.evidenceIdEnum)
        assert.ok(output.inclusion.inputTokens + 4096 + 256 <= 16384)
        })
        active.rawForwardingExact = true
        if (observed.nativeOutputKeyOrder) invariant(() => {
          assert.deepEqual(observed.nativeOutputKeyOrder.root, ['status','claims'])
          const keys = ['id','text','kind','evidenceIds']
          for (const order of observed.nativeOutputKeyOrder.claims) assert.deepEqual(order,keys)
        })
      }
      event('adapter-output', { rawJsonSha256: output.rawJson === null ? null : hash(output.rawJson) })
      return { ...output, engineId: engine.id, modelArtifactRevision: modelSha }
    } catch(error) { active.generation.error = String(error); event('adapter-error', { error: String(error) }); throw error }
    finally { active.generation.elapsedMs = performance.now() - start }
  }
})
let lastFailure = '', repeated = 0
async function disposeArm() {
  if (!engine) return
  await engine.dispose()
  engine = undefined; model = undefined
  event('arm-engine-disposed')
}
async function prepareCase(c) {
  active = { arm, id: c.id, phase: 'preflight', question: c.question, monotonicStart: performance.now(), events: [], grammar: [], observed: [], sourceOperations: [], generation: null }
  const abort = new AbortController(); activeAbort = abort
  let timedOut = false
  const deadline = setTimeout(() => { timedOut = true; event('preflight-timeout'); abort.abort(new Error('Preflight exceeded300s')) }, 300000)
  const started = performance.now()
  let result, drainError
  try {
    result = await cited.run({ purpose: 'library-ask', selection: { mode: 'question', question: c.question, filters: {} } }, { ownerId: 'quality-preflight', runId: c.id, signal: abort.signal, assertCurrent() {} })
  } finally {
    try { await cited.cancel('quality-preflight', c.id) } catch(error) { drainError = String(error) }
    clearTimeout(deadline)
  }
  const ok = !timedOut && !stopping && !drainError && !fatalIntegrityReason && result?.status === 'error' && result.message === 'QA_PREFLIGHT_ONLY_NO_SAMPLING' && !!active.preflight
  const row = { arm, id: c.id, status: ok ? 'passed' : 'failed', elapsedMs: performance.now() - started, result, timedOut, drainError: drainError ?? null, reason: fatalIntegrityReason, inputTokens: active.preflight?.prompt.inclusion.inputTokens ?? null, samplingCalls: summary.samplingCalls }
  active.record = row; delete active.monotonicStart
  durable('preflight/' + arm + '-' + c.id + '.json', active)
  summary.preflight.push(row); durable('summary.json', summary)
  console.log(JSON.stringify({ preflight: row }))
  active = null; activeAbort = undefined
  if (!ok) throw new Error('Preflight aborted whole experiment: ' + (fatalIntegrityReason ?? drainError ?? result?.message ?? 'incomplete'))
}
durable('summary.json', summary)
try {

  for (const entry of initial.samplingOrder) {
    arm = entry.arm; engine = makeEngine()
    try { await prepareCase(planned.find(c => c.id === entry.id)) }
    finally { await disposeArm() }
    originalsIntegrity()
  }
  invariant(() => assert.equal(summary.samplingCalls, 0))
  summary.preflightPassed = true; durable('summary.json', summary); event('all-ten-preflights-passed')
  mode = 'sampling'
  for (const entry of initial.samplingOrder) {
    if (stopping || summary.stoppedReason) break
    arm = entry.arm
    const c = planned.find(c => c.id === entry.id)
    engine = makeEngine()
    const armStarted = performance.now()
    try {
    const row = summary.cases.find(r => r.id === c.id && r.arm === arm)
    Object.assign(row, { status: 'running', attemptId: initial.attemptId + ':' + arm + ':' + c.id, startedAt: new Date().toISOString() })
    durable('summary.json', summary)
    active = { ...row, question: c.question, expected: c.expected, gold: c.gold, monotonicStart: performance.now(), events: [], grammar: [], observed: [], sourceOperations: [], generation: null }
    const abort = new AbortController(); activeAbort = abort
    let timedOut = false
    const deadline = setTimeout(() => { timedOut = true; event('case-timeout'); abort.abort(new Error('Native QA case exceeded 300s')) }, 300000)
    const request = { purpose: 'library-ask' as const, selection: { mode: 'question' as const, question: c.question, filters: {} } }
    const control = { ownerId: 'isolated-quality-native', runId: c.id, signal: abort.signal, assertCurrent() {}, onProgress(phase) { event('service-progress', { phase }) } }
    let result: any = null, validation: any = null, thrown: string | null = null, drainError: string | null = null
    const start = performance.now()
    try {
      result = await cited.run(request, control)
      active.runElapsedMs = performance.now() - start; event('service-settled', { status: result.status })
      if (result.status !== 'error') {
        assert.equal(result.snapshot.promptVersion, 2)
        const admission = performance.now()
        validation = await cited.validate(result.snapshot, request, control)
        active.admissionElapsedMs = performance.now() - admission; event('admission-settled', { validation })
      }
    } catch(error) { thrown = String(error); event('case-exception', { error: thrown }) }
    finally {
      const drain = performance.now()
      try { await cited.cancel(control.ownerId, control.runId); active.drainElapsedMs = performance.now() - drain; event('service-cancel-drained') }
      catch(error) { drainError = String(error); event('drain-error', { error: drainError }) }
      clearTimeout(deadline)
    }
    const inclusion = active.generation?.output?.inclusion
    const actualWire = active.observed.at(-1) ? JSON.parse(active.observed.at(-1).user) : null
    const goldOnWire = c.gold.map(g => {
      const raw = JSON.parse(original(g.meetingId)), text = g.kind === 'personal' ? raw.rawNotesMarkdown : raw.segments[0].text
      assert.equal(text.slice(g.startUtf16, g.endUtf16), g.quote)
      let start = g.startUtf16, end = g.endUtf16, sourceId = 'transcript:original-segment'
      if (g.kind === 'personal') { const prefix = text.slice(0, start), lineStart = prefix.lastIndexOf('\n') + 1; sourceId = 'personal:' + (prefix.split('\n').length - 1); start -= lineStart; end -= lineStart }
      const supplied = active.generation?.input?.ranges ?? []
      // Actual wire evidence contains anchors/ranges in the existing serialization.
      return !!actualWire?.evidence.some(r => {
        const base = inclusion?.ranges.find(x => x.id === r.id) ?? supplied.find(x => x.id === r.id)
        return base?.anchor.meetingId === g.meetingId && base.anchor.sourceId === sourceId && base.startUtf16 <= start && base.endUtf16 >= end && r.quote.includes(g.quote)
      })
    })
    const lifecycleFailure = active.events.some(e => /dispose-error/.test(e.kind))
    const status = timedOut ? 'timeout' : stopping || abort.signal.aborted ? 'cancelled' : drainError || lifecycleFailure ? 'drain-failed' : thrown ? 'runner-failed' : result?.status === 'error' ? 'failed' : validation?.status !== 'valid' ? 'admission-failed' : 'valid'
    Object.assign(row, { status, endedAt: new Date().toISOString(), elapsedMs: performance.now() - start, runElapsedMs: active.runElapsedMs ?? null, admissionElapsedMs: active.admissionElapsedMs ?? null, generationElapsedMs: active.generation?.elapsedMs ?? null, grammarElapsedMs: active.grammar.map(g => g.elapsedMs), drainElapsedMs: active.drainElapsedMs ?? null, code: result?.code ?? null, message: result?.message ?? thrown ?? drainError, validation, timedOut, operatorInterrupted: stopping, cleanup: drainError || lifecycleFailure ? 'unqualified' : 'service/context awaited', goldOnWire, wireObserved: active.observed.length, rawForwardingExact: active.rawForwardingExact ?? null, promptVersion: result?.snapshot?.promptVersion ?? null, inputTokens: inclusion?.inputTokens ?? active.observed.at(-1)?.wireTokens.length ?? null, nativeOutputTokens: active.observed.at(-1)?.tokenUsage?.usedOutputTokens ?? null, stopReason: active.observed.at(-1)?.stopReason ?? null })
    Object.assign(active, { record: row, result, validation, thrown, drainError }); delete active.monotonicStart
    durable('evidence/' + arm + '-' + c.id + '.json', active)
    const key = ['failed','runner-failed'].includes(status) ? (row.code ?? status) + ':' + row.message : ''
    repeated = key && key === lastFailure ? repeated + 1 : key ? 1 : 0; lastFailure = key
    if (fatalIntegrityReason) summary.stoppedReason = 'Integrity failure: ' + fatalIntegrityReason
    else if (['timeout','cancelled','drain-failed'].includes(status)) summary.stoppedReason = 'Stop on first ' + status
    else if (repeated >= 2) summary.stoppedReason = 'Two consecutive identical grammar/protocol/runtime failures: ' + key
    durable('summary.json', summary)
    console.log(JSON.stringify(row)); activeAbort = undefined; active = null
    } finally { await disposeArm() }
    originalsIntegrity()
    event('sampling-entry-complete', { elapsedMs: performance.now() - armStarted })
    durable('summary.json', summary)
  }
} catch(error) {
  summary.stoppedReason = String(error)
  const running = summary.cases.find(r => r.status === 'running')
  if (running) { running.status = 'runner-failed'; running.message = String(error) }
  summary.runnerError = String(error)
  durable('summary.json', summary)
} finally {
  try { await disposeArm(); summary.engineDisposed = true }
  catch(error) { summary.engineDisposed = false; summary.disposeError = String(error) }
  Llama.prototype.loadModel = actualLoadModel
  Llama.prototype.createGrammarForJsonSchema = actualGrammar
  LlamaChatSession.prototype.promptWithMeta = actualPrompt
  LlamaModel.prototype.createContext = actualCreateContext
  LlamaContext.prototype.dispose = actualContextDispose
  LlamaModel.prototype.dispose = actualModelDispose
  try { originalsIntegrity(); summary.originalsUnchanged = true }
  catch(error) { summary.originalsUnchanged = false; summary.integrityError = String(error) }
  durable('original-integrity.json', { unchanged: summary.originalsUnchanged, originalsPerArm: 701, markerPerArm: 1 })
  summary.endedAt = new Date().toISOString()
  summary.totals = Object.fromEntries([...new Set(summary.cases.map(r => r.status))].map(s => [s, summary.cases.filter(r => r.status === s).length]))
  durable('summary.json', summary)
}
