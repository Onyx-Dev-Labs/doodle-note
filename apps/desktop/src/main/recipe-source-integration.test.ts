import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import { localSourceScope, SOURCE_IDENTITY_FILE } from '@repo/meetings-store/sources'
import { LibraryActivity } from './library-activity'
import { LibraryStorage } from './library-storage'
import { recipeDigest, recipeLibrary, sameRecipeScope } from './recipe-library'
import { RecipeRunner, type RecipeGenerator } from './recipe-runner'
import { RecipeStore } from './recipe-store'
import type { RecipeDraft, RecipeRun } from '../shared/recipes-api'

const require = createRequire(import.meta.url)
const draft: RecipeDraft = {
  name: 'Combined synthetic recipe',
  prompt: 'Draft from this meeting only.',
  scope: 'current-meeting',
  outputKind: 'markdown',
  policy: 'local-only',
  inputs: { personalNotes: true, transcript: true, selectedSummary: false }
}
const generated: RecipeGenerator = async () => ({
  markdown: 'Synthetic result',
  engine: 'local:fixture',
  modelRevision: 'synthetic-v1',
  elapsedMs: 1
})
function gate(): { ready: Promise<void>; release: () => void } {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { ready, release }
}
function fixture(t: test.TestContext): { root: string; dir: string; original: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dn-recipe-index-')))
  const dir = join(root, 'meetings')
  mkdirSync(dir)
  const original = JSON.stringify({
    id: 'synthetic',
    rawNotesMarkdown: 'original needle',
    segments: [
      { id: 's1', channel: 'system', speakerId: 'far', speaker: 'Them', text: 'decision' }
    ],
    participants: [{ id: 'far', name: 'Alice', source: 'manual', confidence: 1 }],
    savedAudioFailures: { mic: true, system: true },
    metadata: { selectedSummaryID: 'chosen', summaries: [{ id: 'chosen', text: 'Corrected' }] },
    ink: { untouched: true }
  })
  writeFileSync(join(dir, 'synthetic.json'), original)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, dir, original }
}
function indexAt(dir: string, cache: string): SourceIndexClient {
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve('tsx/cjs'))}); require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});`,
    { eval: true, workerData: { meetingsDir: dir, cacheDir: cache } }
  )
  return new SourceIndexClient(worker, () => ({
    meetingsDir: dir,
    scope: localSourceScope(dir, false),
    authorized: true
  }))
}

test('real index initialization invalidates a legacy recipe at admission and completion without rewriting originals', async (t) => {
  const f = fixture(t)
  const entered = gate(),
    finish = gate()
  let calls = 0
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async (...args) => {
      calls++
      entered.release()
      await finish.ready
      return generated(...args)
    }
  )
  const legacy = recipeLibrary(f.root).scope
  const version = runner.save(legacy, draft)
  const request: RecipeRun = {
    meetingId: 'synthetic',
    runId: 'legacy',
    versionId: version.versionId,
    library: legacy
  }
  assert.equal(
    existsSync(join(f.dir, SOURCE_IDENTITY_FILE)),
    false,
    'recipe reads/saves cannot initialize identity'
  )
  const pending = runner.run(request, 1)
  const rejected = assert.rejects(pending, /library changed/)
  await entered.ready
  const index = indexAt(f.dir, join(f.root, 'cache'))
  try {
    const indexed = await index.search('decision')
    assert.deepEqual(recipeLibrary(f.root).scope, indexed.scope)
    assert.equal(indexed.hits[0]!.speaker, 'Alice', 'canonical corrected participant wins')
    assert.notDeepEqual(indexed.scope, legacy)
    finish.release()
    await rejected
    await assert.rejects(runner.run({ ...request, runId: 'stale-admission' }, 1), /library changed/)
    assert.equal(calls, 1)
    assert.equal(new RecipeStore(f.root).read().outputs.length, 0)
    const output = await runner.run({ ...request, runId: 'canonical', library: indexed.scope }, 1)
    assert.equal(output.source.revision, recipeDigest(f.original))
    assert.notEqual(output.source.revision, indexed.hits[0]!.anchor.revisionId)
    assert.deepEqual(readFileSync(join(f.dir, 'synthetic.json'), 'utf8'), f.original)
  } finally {
    finish.release()
    await pending.catch(() => {})
    await index.close()
  }
})

test('canonical recipe identity survives relocation after an active run drains and disconnected roots fail closed', async (t) => {
  const f = fixture(t)
  const index = indexAt(f.dir, join(f.root, 'cache'))
  let scope: ReturnType<typeof localSourceScope>
  try {
    scope = (await index.search('needle')).scope
  } finally {
    await index.close()
  }
  const storage = new LibraryStorage(f.root),
    activity = new LibraryActivity()
  const entered = gate(),
    finish = gate()
  const runner = new RecipeRunner(
    () => storage.root,
    storage.assertAvailable,
    async (...args) => {
      entered.release()
      await finish.ready
      return generated(...args)
    },
    (work) => activity.run(work)
  )
  const version = runner.save(scope, draft)
  const request: RecipeRun = {
    meetingId: 'synthetic',
    runId: 'before-move',
    versionId: version.versionId,
    library: scope
  }
  const pending = runner.run(request, 1)
  await entered.ready
  const destination = realpathSync(mkdtempSync(join(tmpdir(), 'dn-recipe-index-move-')))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  let copied = false
  const moving = activity.exclusive(async () => {
    copied = true
    storage.schedule(destination)
    await storage.finishPending()
  })
  assert.equal(copied, false, 'relocation cannot copy an in-flight recipe sidecar')
  finish.release()
  const first = await pending
  await moving
  const movedDir = join(storage.root, 'meetings')
  assert.deepEqual(recipeLibrary(storage.root).scope, scope)
  assert.deepEqual(runner.list('synthetic').outputs, [first])
  assert.equal(readFileSync(join(movedDir, 'synthetic.json'), 'utf8'), f.original)
  const movedIndex = indexAt(movedDir, join(f.root, 'moved-cache'))
  try {
    assert.deepEqual((await movedIndex.search('needle')).scope, scope)
    await runner.run({ ...request, runId: 'after-move' }, 1)
    assert.equal(runner.list('synthetic').outputs.length, 2)
    assert.equal(
      new RecipeStore(f.root).read().outputs.length,
      1,
      'recovery copy is not an active write target'
    )
  } finally {
    await movedIndex.close()
  }
  renameSync(storage.root, storage.root + '-disconnected')
  await assert.rejects(runner.run({ ...request, runId: 'disconnected' }, 1), /unavailable/)
  assert.equal(new RecipeStore(f.root).read().outputs.length, 1)
  assert.equal(readFileSync(join(f.dir, 'synthetic.json'), 'utf8'), f.original)
})

test('canonical reader retains realpaths and all scope fences; malformed or unreadable markers reject before and after generation', async (t) => {
  const f = fixture(t)
  const alias = f.root + '-alias'
  symlinkSync(f.root, alias)
  t.after(() => rmSync(alias, { force: true }))
  assert.deepEqual(recipeLibrary(alias), { path: f.root, scope: localSourceScope(f.dir, false) })
  assert.equal(existsSync(join(f.dir, SOURCE_IDENTITY_FILE)), false)
  const scope = localSourceScope(f.dir, true)
  const marker = join(f.dir, SOURCE_IDENTITY_FILE),
    markerBytes = readFileSync(marker)
  let calls = 0,
    breakMarker = (): void => {}
  const runner = new RecipeRunner(
    () => f.root,
    () => {},
    async (...args) => {
      calls++
      breakMarker()
      return generated(...args)
    }
  )
  const version = runner.save(scope, draft)
  const request: RecipeRun = {
    meetingId: 'synthetic',
    runId: 'scope-check',
    versionId: version.versionId,
    library: scope
  }
  for (const key of ['libraryId', 'accountId', 'workspaceId'] as const) {
    const changed = { ...scope, [key]: 'different' }
    assert.equal(sameRecipeScope(scope, changed), false)
    await assert.rejects(runner.run({ ...request, library: changed }, 1), /library changed/)
  }
  assert.equal(calls, 0)
  for (const unreadable of [false, true]) {
    breakMarker = () => {
      rmSync(marker)
      if (unreadable) mkdirSync(marker)
      else writeFileSync(marker, '{"version":2,"libraryId":"invalid"}')
    }
    await assert.rejects(runner.run(request, 1), /Invalid source library identity|EISDIR/)
    const callsAfterGeneration = calls
    await assert.rejects(runner.run(request, 1), /Invalid source library identity|EISDIR/)
    assert.equal(calls, callsAfterGeneration, 'invalid identity blocks admission')
    assert.equal(new RecipeStore(f.root).read().outputs.length, 0)
    rmSync(marker, { recursive: true })
    writeFileSync(marker, markerBytes)
  }
  assert.equal(readFileSync(join(f.dir, 'synthetic.json'), 'utf8'), f.original)
})
