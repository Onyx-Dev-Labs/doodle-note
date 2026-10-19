import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCorpus, readRubric, rubricPath, corpusPath, sha256, containsGold } from './corpus.mjs'
import { fixtureContext, uuid, createFixture } from './fixture.mjs'
import { evaluateCase, mechanicalGenerator } from './evaluate.mjs'
import { validateNativeConfiguration } from './native.mjs'

const corpus = readCorpus()
test('frozen source bytes reject even a whitespace mutation before evaluation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev509-pin-test-'))
  try {
    const file = join(dir, 'changed.json')
    writeFileSync(file, readFileSync(corpusPath, 'utf8') + ' ')
    assert.throws(() => readCorpus(file), /Frozen corpus bytes changed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('all 24 context seeds are deterministic, with two separate account/person identities', () => {
  for (const item of corpus.cases) {
    const scope = { libraryId: uuid(item.id + ':library'), accountId: null, workspaceId: null }
    const a = fixtureContext(corpus, item, scope)
    assert.equal(JSON.stringify(a), JSON.stringify(fixtureContext(corpus, item, scope)))
    assert.equal(new Set(Object.values(a.people).map((p) => p.accountId)).size, 2)
    assert.equal(Object.values(a.snapshots).length, 2)
  }
})
test('mechanical service run captures no fabricated answer and retains exact original/sidecar bytes', async () => {
  const result = await evaluateCase(corpus, corpus.cases[0]!, mechanicalGenerator)
  assert.equal(result.mechanicalPass, true)
  assert.equal(result.native, false)
  assert.equal(result.semanticQuality, 'not-evaluated')
  assert.equal(result.outputs.length, 0)
  assert.equal(result.view.result, undefined)
  assert(result.requests.length && result.inputs.length)
  assert.equal(result.gold[0]!.nativePromptIncluded, null)
  assert(result.contextUnchanged && result.originalsUnchanged)
})
test('all six absent/unknown controls run actual service without generator entry', async () => {
  for (const item of corpus.cases.filter((c) => c.group === 'absent-unknown')) {
    const result = await evaluateCase(corpus, item, mechanicalGenerator)
    assert.equal(result.mechanicalPass, true, item.id)
    assert.equal(result.inputs.length, 0, item.id)
    assert.equal(result.view.result?.snapshot.status, 'no-history', item.id)
  }
})
test('exact gold comparison rejects foreign anchor, shifted range and replaced quote', async () => {
  const result = await evaluateCase(corpus, corpus.cases[7]!, mechanicalGenerator)
  const gold = result.gold[0]!.expected
  const range = result.inputs[0]!.ranges.find((r) => containsGold(r, gold))!
  assert(range)
  assert(!containsGold({ ...range, anchor: { ...range.anchor, meetingId: 'foreign' } }, gold))
  assert(!containsGold({ ...range, startUtf16: range.startUtf16 + 1 }, gold))
  assert(!containsGold({ ...range, quote: range.quote.replace('façade', 'facade') }, gold))
})
test('two disposable fixtures seed byte-identical originals and context, while source lifetimes differ', async () => {
  const a = await createFixture(corpus, corpus.cases[0]!)
  const b = await createFixture(corpus, corpus.cases[0]!)
  try {
    assert.notEqual(a.root, b.root)
    assert.deepEqual(a.originalBytes, b.originalBytes)
    assert.equal(sha256(a.contextBytes), sha256(b.contextBytes))
    const bundles = await Promise.all(
      [a.sources, b.sources].map((s) =>
        s.retrieveEvidence({ mode: 'linked-history', meetingIds: ['larch'] })
      )
    )
    assert.notEqual(bundles[0]!.manifest.pathBindingSha256, bundles[1]!.manifest.pathBindingSha256)
  } finally {
    await a.dispose()
    await b.dispose()
  }
})
test('native configuration rejects missing/relative/unpinned artifacts before native import', () => {
  for (const value of [
    null,
    {},
    {
      approvedModelRoot: 'relative',
      modelPath: 'model.gguf',
      sha256: 'a'.repeat(64),
      modelUri: 'test'
    },
    { approvedModelRoot: '/tmp', modelPath: '/tmp/model', sha256: '', modelUri: 'test' }
  ])
    assert.throws(() => validateNativeConfiguration(value))
})
test('unexpected generator failure never becomes a mechanical or semantic pass', async () => {
  const result = await evaluateCase(corpus, corpus.cases[0]!, {
    ...mechanicalGenerator,
    generate: async () => {
      throw new Error('Unexpected fixture failure')
    }
  })
  assert.equal(result.mechanicalPass, false)
  assert.equal(result.view.state, 'error')
  assert.equal(result.outcome, 'mechanical-failure')
  assert.equal(result.outputs.length, 0)
  assert.equal(result.semanticQuality, 'not-evaluated')
})
test('independent wrong-date expectation is rejected against actual original metadata', async () => {
  // Scorer sensitivity control only: frozen corpus is never edited or accepted under a new hash.
  const changed = structuredClone(corpus.cases[0]!)
  changed.expected.gold[0]!.occurredAt = '2020-01-01T00:00:00.000Z'
  const result = await evaluateCase(corpus, changed, mechanicalGenerator)
  assert.equal(result.gold[0]!.exact, false)
  assert.equal(result.mechanicalPass, false)
})
test('native factory rejects wrong bytes before importing/constructing a local model', async () => {
  const { createNativeGenerator } = await import('./native.mjs')
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-native-config-test-')))
  try {
    const model = join(dir, 'synthetic-not-a-model.gguf')
    writeFileSync(model, 'Synthetic fixture, never a model')
    await assert.rejects(
      createNativeGenerator({
        approvedModelRoot: dir,
        modelPath: model,
        sha256: '0'.repeat(64),
        modelUri: 'synthetic'
      }),
      /digest mismatch/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('evaluator interruption drains an actual owned producer and never produces an answer', async () => {
  const abort = new AbortController()
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let drained = false
  const pending = evaluateCase(
    corpus,
    corpus.cases[0]!,
    {
      ...mechanicalGenerator,
      generate: async (_input, signal) => {
        entered()
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
        await new Promise((resolve) => setTimeout(resolve, 15))
        drained = true
        throw new Error('Synthetic cancellation acknowledged')
      }
    },
    abort.signal
  )
  await started
  abort.abort()
  const result = await pending
  assert.equal(drained, true)
  assert.equal(result.mechanicalPass, false)
  assert.equal(result.view.result, undefined)
  assert.equal(result.native, false)
})

test('frozen rubric mutation is rejected before any evaluation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev509-rubric-pin-'))
  try {
    const file = join(dir, 'rubric.md')
    writeFileSync(file, readFileSync(rubricPath, 'utf8') + ' ')
    assert.throws(() => readRubric(file), /Frozen rubric bytes changed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
