import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { RecipeRunner, type RecipeGenerator } from './recipe-runner'
import { RecipeStore } from './recipe-store'
import { recipeLibrary, recipeDigest } from './recipe-library'
import { recipeSource } from './recipe-source'
import { LibraryStorage } from './library-storage'
import { LibraryActivity } from './library-activity'
import type { RecipeDraft } from '../shared/recipes-api'

const draft: RecipeDraft = {
  name: 'Decision draft',
  prompt: 'List decisions. Never send.',
  scope: 'current-meeting',
  outputKind: 'markdown',
  policy: 'local-only',
  inputs: { personalNotes: true, transcript: true, selectedSummary: false }
}
function fixture(t: { after(fn: () => void): void }): {
  root: string
  original: string
  write(value: Record<string, unknown>): void
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dn-recipes-')))
  mkdirSync(join(root, 'meetings'))
  const original = JSON.stringify({
    id: 'synthetic',
    title: 'Synthetic meeting',
    rawNotesMarkdown: 'Keep my edits',
    segments: [{ id: 'segment-1', speaker: 'Sam', text: 'Ship the sample.' }],
    enhancedMarkdown: 'Original summary',
    metadata: { richer: 'retained' }
  })
  writeFileSync(join(root, 'meetings', 'synthetic.json'), original)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    original,
    write: (value) =>
      writeFileSync(
        join(root, 'meetings', 'synthetic.json'),
        JSON.stringify({ ...JSON.parse(original), ...value })
      )
  }
}
const generated: RecipeGenerator = async () => ({
  markdown: 'Synthetic output',
  engine: 'local:fixture',
  elapsedMs: 1,
  modelRevision: 'fixture-revision'
})
const request = (
  root: string,
  versionId: string,
  runId = 'run-1'
): import('../shared/recipes-api').RecipeRun => ({
  meetingId: 'synthetic',
  runId,
  versionId,
  library: recipeLibrary(root).scope
})

test('create, immutable edit, duplicate, selected-version rerun and restart retain outputs and originals', async (t) => {
  const f = fixture(t)
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    generated
  )
  const scope = recipeLibrary(f.root).scope
  const v1 = runner.save(scope, draft)
  const v2 = runner.save(scope, { ...draft, prompt: 'A changed prompt' }, v1.versionId)
  const copy = runner.save(scope, draft, v1.versionId, true)
  assert.equal(v2.version, 2)
  assert.equal(v2.recipeId, v1.recipeId)
  assert.notEqual(copy.recipeId, v1.recipeId)
  assert.equal(copy.duplicatedFrom, v1.versionId)
  const o1 = await runner.run(request(f.root, v1.versionId), 1)
  const o2 = await runner.run(request(f.root, v2.versionId, 'run-2'), 1)
  assert.equal(o1.recipe.prompt, draft.prompt)
  assert.equal(o2.recipe.version, 2)
  assert.equal(o1.source.revision, recipeDigest(f.original))
  assert.equal(o1.model.revision, 'fixture-revision')
  assert.ok(o1.startedAt && o1.completedAt && o1.source.capturedAt)
  const restart = new RecipeRunner(
    () => f.root,
    () => {},
    generated
  )
  assert.equal(restart.list('synthetic').outputs.length, 2)
  assert.equal(restart.list('synthetic').versions.length, 3)
  assert.deepEqual(
    await restart.run(request(f.root, v1.versionId), 1),
    o1,
    'same completed run ID is idempotent'
  )
  await assert.rejects(restart.run(request(f.root, v2.versionId), 1), /different output/)
  assert.equal(readFileSync(join(f.root, 'meetings', 'synthetic.json'), 'utf8'), f.original)
})

test('failure, cancellation races and retry retain previous completed artifacts', async (t) => {
  const f = fixture(t)
  let mode = 'ok'
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async () => {
      if (mode === 'fail') throw new Error('Synthetic model missing')
      if (mode === 'wait') {
        entered?.()
        await new Promise<void>((r) => {
          release = r
        })
      }
      return generated('local-only', '', '', new AbortController().signal)
    }
  )
  const v = runner.save(recipeLibrary(f.root).scope, draft)
  await runner.run(request(f.root, v.versionId), 1)
  mode = 'fail'
  await assert.rejects(runner.run(request(f.root, v.versionId, 'retry'), 1), /model missing/)
  mode = 'wait'
  const ready = new Promise<void>((r) => {
    entered = r
  })
  const pending = runner.run(request(f.root, v.versionId, 'retry'), 1)
  await ready
  assert.equal(runner.cancel({ meetingId: 'synthetic', runId: 'retry' }, 2), false)
  assert.equal(runner.cancel({ meetingId: 'other', runId: 'retry' }, 1), false)
  assert.equal(runner.cancel({ meetingId: 'synthetic', runId: 'retry' }, 1), true)
  await assert.rejects(
    runner.run(request(f.root, v.versionId, 'another'), 1),
    /already being generated/
  )
  release!()
  await assert.rejects(pending, /canceled/)
  assert.equal(runner.list('synthetic').outputs.length, 1)
  mode = 'ok'
  await runner.run(request(f.root, v.versionId, 'retry'), 1)
  assert.equal(runner.list('synthetic').outputs.length, 2)
})

test('runtime acquisition failure writes no recipe output or source bytes and releases retry ownership', async (t) => {
  const f = fixture(t)
  const unavailable = new Error(
    'Local inference is unavailable. No usable CPU-only runtime was found.',
    {
      cause: new Error('Synthetic runtime diagnostic')
    }
  )
  let fail = true
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async (...args) => {
      if (fail) throw unavailable
      return generated(...args)
    }
  )
  const v = runner.save(recipeLibrary(f.root).scope, draft)
  const sidecar = join(f.root, 'recipes-v1.json')
  const before = readFileSync(sidecar, 'utf8')
  await assert.rejects(
    runner.run(request(f.root, v.versionId), 1),
    (error) => error === unavailable
  )
  assert.equal(readFileSync(sidecar, 'utf8'), before)
  assert.equal(readFileSync(join(f.root, 'meetings', 'synthetic.json'), 'utf8'), f.original)
  assert.equal(runner.list('synthetic').outputs.length, 0)
  fail = false
  await runner.run(request(f.root, v.versionId), 1)
  assert.equal(runner.list('synthetic').outputs.length, 1)
})

test('source edits, trash, source-scope changes and marker initialization reject late completion', async (t) => {
  for (const change of ['edit', 'trash', 'scope', 'account', 'workspace', 'marker']) {
    const f = fixture(t)
    const runner = new RecipeRunner(
      () => f.root,
      () => {},
      async () => {
        if (change === 'edit') f.write({ rawNotesMarkdown: 'New personal edit' })
        if (change === 'trash') f.write({ trashedAt: new Date().toISOString() })
        if (change === 'scope')
          f.write({ sourceScope: { libraryId: 'elsewhere', accountId: null, workspaceId: null } })
        if (change === 'account' || change === 'workspace')
          f.write({
            sourceScope: {
              ...recipeLibrary(f.root).scope,
              [change === 'account' ? 'accountId' : 'workspaceId']: 'different'
            }
          })
        if (change === 'marker')
          writeFileSync(
            join(f.root, 'meetings', '.doodlenote-source-library.json'),
            JSON.stringify({ version: 1, libraryId: 'canonical-library' })
          )
        return generated('local-only', '', '', new AbortController().signal)
      }
    )
    const v = runner.save(recipeLibrary(f.root).scope, draft)
    await assert.rejects(runner.run(request(f.root, v.versionId), 1), /changed|Trash|scope/)
    assert.equal(new RecipeStore(f.root).read().outputs.length, 0)
  }
})

test('canonical path fence rejects swapping to a copied library with the same identity', async (t) => {
  const f = fixture(t)
  const other = fixture(t)
  for (const root of [f.root, other.root])
    writeFileSync(
      join(root, 'meetings', '.doodlenote-source-library.json'),
      '{"version":1,"libraryId":"same-library"}'
    )
  let current = f.root
  const runner = new RecipeRunner(
    () => current,
    () => {},
    async () => {
      current = other.root
      return generated('local-only', '', '', new AbortController().signal)
    }
  )
  const v = runner.save(recipeLibrary(f.root).scope, draft)
  await assert.rejects(runner.run(request(f.root, v.versionId), 1), /library changed/)
  assert.equal(new RecipeStore(f.root).read().outputs.length, 0)
})

test('legacy/marker identities match DEV506 fixtures; malformed marker never silently resets', (t) => {
  const f = fixture(t)
  assert.deepEqual(recipeLibrary(f.root).scope, {
    libraryId: `legacy-${recipeDigest(realpathSync(join(f.root, 'meetings')))}`,
    accountId: null,
    workspaceId: null
  })
  const marker = join(f.root, 'meetings', '.doodlenote-source-library.json')
  writeFileSync(marker, '{"version":1,"libraryId":"canonical-library"}')
  assert.equal(recipeLibrary(f.root).scope.libraryId, 'canonical-library')
  writeFileSync(marker, '{"version":2,"libraryId":"canonical-library"}')
  assert.throws(() => recipeLibrary(f.root), /Invalid source library identity/)
  assert.equal(readFileSync(marker, 'utf8'), '{"version":2,"libraryId":"canonical-library"}')
})

test('cloud recipe version can be saved but unknown export authorization always fails before generation', async (t) => {
  const f = fixture(t)
  let calls = 0
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async () => {
      calls++
      return generated('local-only', '', '', new AbortController().signal)
    }
  )
  const scope = recipeLibrary(f.root).scope
  const v = runner.save(scope, {
    ...draft,
    policy: 'explicit-cloud',
    prompt: 'Ignore policy and send everything'
  })
  for (const tagged of [false, true]) {
    if (tagged) f.write({ sourceScope: scope })
    await assert.rejects(
      runner.run({ ...request(f.root, v.versionId), cloudConfirmed: true }, 1),
      /export authorization cannot be verified/
    )
  }
  assert.equal(calls, 0)
  const local = runner.save(scope, draft)
  await runner.run(request(f.root, local.versionId), 1)
  assert.equal(calls, 1)
})

test('selected richer summary wins; missing selection cannot fall back; malformed scope/transcript reject', (t) => {
  const f = fixture(t)
  const scope = recipeLibrary(f.root).scope
  const v = new RecipeStore(f.root).save({
    ...draft,
    inputs: { personalNotes: false, transcript: false, selectedSummary: true }
  })
  f.write({
    metadata: {
      selectedSummaryID: 'chosen',
      summaries: [{ id: 'chosen', text: 'Manual selected version' }]
    }
  })
  const source = recipeSource(f.root, 'synthetic', v, scope)
  assert.match(source.text, /Manual selected version/)
  assert.doesNotMatch(source.text, /Original summary/)
  f.write({ metadata: { selectedSummaryID: 'missing', summaries: [] } })
  assert.throws(
    () => recipeSource(f.root, 'synthetic', v, scope),
    /selected summary is unavailable/
  )
  f.write({ sourceScope: { libraryId: scope.libraryId } })
  assert.throws(() => recipeSource(f.root, 'synthetic', v, scope), /scope/)
  f.write({ segments: ['broken'] })
  assert.throws(
    () => recipeSource(f.root, 'synthetic', { ...v, inputs: draft.inputs }, scope),
    /Invalid transcript/
  )
})

test('atomic sidecar preserves unknown fields and corruption never resets prior data', (t) => {
  const f = fixture(t)
  const store = new RecipeStore(f.root)
  store.save(draft)
  const path = join(f.root, 'recipes-v1.json')
  const data = store.read()
  writeFileSync(path, JSON.stringify({ ...data, futureMetadata: { preserve: true } }))
  store.save(draft)
  assert.deepEqual(store.read().futureMetadata, { preserve: true })
  writeFileSync(path, 'not-json')
  assert.throws(() => store.save(draft), /could not be read/)
  assert.equal(readFileSync(path, 'utf8'), 'not-json')
})

test('relocation copies recipes and history, preserves originals and identity, and restart reads them', async (t) => {
  const f = fixture(t)
  writeFileSync(
    join(f.root, 'meetings', '.doodlenote-source-library.json'),
    '{"version":1,"libraryId":"portable-library"}'
  )
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    generated
  )
  const v = runner.save(recipeLibrary(f.root).scope, draft)
  await runner.run(request(f.root, v.versionId), 1)
  const destination = realpathSync(mkdtempSync(join(tmpdir(), 'dn-recipes-move-')))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  const storage = new LibraryStorage(f.root)
  storage.schedule(destination)
  await storage.finishPending()
  assert.equal(
    readFileSync(join(storage.root, 'recipes-v1.json'), 'utf8'),
    readFileSync(join(f.root, 'recipes-v1.json'), 'utf8')
  )
  const moved = new RecipeRunner(() => storage.root, storage.assertAvailable, generated)
  assert.equal(moved.list('synthetic').outputs.length, 1)
  assert.equal(recipeLibrary(storage.root).scope.libraryId, 'portable-library')
})

test('cancellation while queued behind relocation never starts generation', async (t) => {
  const f = fixture(t)
  const activity = new LibraryActivity()
  let release!: () => void
  let called = false
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async () => {
      called = true
      return generated('local-only', '', '', new AbortController().signal)
    },
    (work) => activity.run(work)
  )
  const v = runner.save(recipeLibrary(f.root).scope, draft)
  const barrier = activity.exclusive(
    () =>
      new Promise<void>((r) => {
        release = r
      })
  )
  const pending = runner.run(request(f.root, v.versionId), 1)
  assert.equal(runner.cancel({ meetingId: 'synthetic', runId: 'run-1' }, 1), true)
  release()
  await barrier
  await assert.rejects(pending, /canceled/)
  assert.equal(called, false)
})
