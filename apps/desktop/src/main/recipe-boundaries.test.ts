import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as api from '../shared/recipes-api'
import { RecipeRunner } from './recipe-runner'
import { RecipeStore } from './recipe-store'
import { recipeLibrary } from './recipe-library'

const draft: api.RecipeDraft = {
  name: 'Synthetic recipe',
  prompt: 'List decisions.',
  scope: 'current-meeting',
  policy: 'local-only',
  outputKind: 'markdown',
  inputs: { personalNotes: true, transcript: false, selectedSummary: false }
}
function fixture(t: { after(fn: () => void): void }): {
  root: string
  original: string
  store: RecipeStore
  scope: api.RecipeScope
  version: api.RecipeVersion
  runner: RecipeRunner
  request: api.RecipeRun
  file: string
  calls(): number
  admitted(): number
} {
  const root = mkdtempSync(join(tmpdir(), 'dn-recipe-boundaries-'))
  mkdirSync(join(root, 'meetings'))
  const original = JSON.stringify({
    id: 'fixture',
    title: 'Synthetic',
    rawNotesMarkdown: 'Test only',
    segments: []
  })
  writeFileSync(join(root, 'meetings/fixture.json'), original)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new RecipeStore(root)
  const scope = recipeLibrary(root).scope
  const version = store.save(draft)
  let calls = 0
  let admitted = 0
  const runner = new RecipeRunner(
    () => root,
    () => {},
    async () => {
      calls++
      return {
        markdown: 'Synthetic result',
        engine: 'local:fixture',
        elapsedMs: 1,
        modelRevision: 'fixture-stat'
      }
    },
    async (work) => {
      admitted++
      return work()
    }
  )
  const request: api.RecipeRun = {
    meetingId: 'fixture',
    runId: 'run-1',
    versionId: version.versionId,
    library: scope
  }
  const file = join(root, 'recipes-v1.json')
  return {
    root,
    original,
    store,
    scope,
    version,
    runner,
    request,
    file,
    calls: () => calls,
    admitted: () => admitted
  }
}
/** Execute the actual registered IPC handlers; only Electron registration is replaced. */
function ipc(runner: RecipeRunner): {
  sender: EventEmitter & { id: number }
  invoke(channel: string, ...args: unknown[]): Promise<api.RecipeResult<unknown>>
} {
  type Handler = (...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) }
  const exports = {} as { registerRecipes(runner: RecipeRunner): void }
  const deps: Record<string, unknown> = {
    electron: { ipcMain },
    './library-ipc': { libraryIpc: ipcMain },
    '../shared/recipes-api': api
  }
  const source = ts.transpileModule(readFileSync('src/main/recipe-service.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.ok(name in deps, name)
      return deps[name]
    }
  })
  exports.registerRecipes(runner)
  const sender = Object.assign(new EventEmitter(), { id: 1 })
  return {
    sender,
    invoke: async (channel: string, ...args: unknown[]) =>
      (await handlers.get(channel)!({ sender }, ...args)) as api.RecipeResult<unknown>
  }
}

test('actual run IPC rejects malformed request shapes before admission, inference or writes', async (t) => {
  const f = fixture(t),
    service = ipc(f.runner)
  const before = readFileSync(f.file, 'utf8')
  const invalid: unknown[] = [
    { ...f.request, runId: undefined },
    { ...f.request, runId: null },
    undefined,
    null,
    [],
    'request',
    1,
    true
  ]
  for (const field of ['runId', 'meetingId', 'versionId'])
    for (const value of [undefined, null, 1, true, {}, [], ['run-1'], '', '../escape'])
      invalid.push({ ...f.request, [field]: value })
  for (const library of [
    undefined,
    null,
    [],
    'scope',
    {},
    { ...f.scope, accountId: undefined },
    { ...f.scope, workspaceId: 1 },
    { ...f.scope, libraryId: null }
  ])
    invalid.push({ ...f.request, library })
  for (const cloudConfirmed of [null, 'true', 1, {}]) invalid.push({ ...f.request, cloudConfirmed })
  for (const request of invalid) {
    const result = await service.invoke(api.RECIPE_CHANNELS.run, request)
    assert.match(result.error ?? '', /valid fetch run/i, JSON.stringify(request))
    assert.equal(result.value, undefined)
    assert.equal(f.calls(), 0)
    assert.equal(f.admitted(), 0)
    assert.equal(readFileSync(f.file, 'utf8'), before)
    assert.equal(readFileSync(join(f.root, 'meetings/fixture.json'), 'utf8'), f.original)
    assert.deepEqual(readdirSync(f.root).sort(), ['meetings', 'recipes-v1.json'])
    assert.equal(service.sender.eventNames().length, 0)
  }
  // Rejected requests neither poison the store nor reserve an ID; a real retry is idempotent.
  const completed = await service.invoke(api.RECIPE_CHANNELS.run, f.request)
  assert.ok(completed.value)
  assert.deepEqual(
    (await service.invoke(api.RECIPE_CHANNELS.run, f.request)).value,
    completed.value
  )
  assert.equal(f.calls(), 1)
  assert.equal(f.store.read().outputs.length, 1)
})

function change(data: unknown, path: string, value: unknown): void {
  const keys = path.split('.')
  let target = data as Record<string, unknown>
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  if (value === undefined) delete target[keys.at(-1)!]
  else target[keys.at(-1)!] = value
}
const malformed: Array<[string, unknown[]]> = [
  ['outputs.0.model', [undefined]],
  ['', [null, [], 'file']],
  ['format', [undefined, null, '1', 2]],
  ['versions', [undefined, null, {}]],
  ['outputs', [undefined, null, {}]],
  ['versions.0', [null, [], 'version']],
  ['outputs.0', [null, [], 'output']],
  ...['versions.0', 'outputs.0.recipe'].flatMap((prefix): Array<[string, unknown[]]> => [
    [prefix + '.name', [undefined, null, 1, '']],
    [prefix + '.prompt', [undefined, null, 1, '']],
    [prefix + '.scope', [undefined, null, {}, 'all-meetings']],
    [prefix + '.outputKind', [undefined, null, 1, 'unsupported']],
    [prefix + '.policy', [undefined, null, {}, 'cloud']],
    [prefix + '.inputs', [undefined, null, [], 'inputs']],
    ...['personalNotes', 'transcript', 'selectedSummary'].map((key): [string, unknown[]] => [
      prefix + '.inputs.' + key,
      [undefined, null, 'true', 1]
    ]),
    [prefix + '.recipeId', [undefined, null, 1, '']],
    [prefix + '.versionId', [undefined, null, [], '']],
    [prefix + '.version', [undefined, null, '1', 0, 1.5]],
    [prefix + '.createdAt', [undefined, null, 1, '', 'not-a-date', '2026-02-30T00:00:00.000Z']],
    [prefix + '.duplicatedFrom', [null, 1, {}, '']]
  ]),
  ['outputs.0.runId', [undefined, null, 1, [], '']],
  ['outputs.0.meetingId', [undefined, null, 1, {}, '../escape']],
  ['outputs.0.recipe', [undefined, null, [], 'recipe']],
  ['outputs.0.model', [undefined, null, [], 'model']],
  ['outputs.0.model.id', [undefined, null, 1, '', '  ']],
  ['outputs.0.model.revision', [undefined, null, {}, '', '  ']],
  ['outputs.0.source', [undefined, null, [], 'source']],
  ['outputs.0.source.libraryId', [undefined, null, 1, '']],
  ['outputs.0.source.accountId', [undefined, 1, {}, '']],
  ['outputs.0.source.workspaceId', [undefined, false, [], '']],
  ['outputs.0.source.revision', [undefined, null, 1, '', 'not-a-digest']],
  ['outputs.0.source.capturedAt', [undefined, null, {}, 'not-a-date']],
  [
    'outputs.0.source.inputKinds',
    [
      undefined,
      null,
      {},
      [],
      [null],
      ['unknown'],
      ['personalNotes', 'personalNotes'],
      ['transcript']
    ]
  ],
  ['outputs.0.startedAt', [undefined, null, [], 'not-a-date']],
  ['outputs.0.completedAt', [undefined, null, 1, 'not-a-date']],
  ['outputs.0.markdown', [undefined, null, {}, 1]]
]

test('malformed persisted versions and artifacts reject read/list/save/complete without changing bytes', async (t) => {
  const f = fixture(t),
    service = ipc(f.runner)
  const output = await f.runner.run(f.request, 1)
  const valid = readFileSync(f.file, 'utf8')
  for (const [path, values] of malformed)
    for (const value of values) {
      let data: unknown = JSON.parse(valid)
      if (path) change(data, path, value)
      else data = value
      const before = JSON.stringify(data)
      writeFileSync(f.file, before)
      const label = `${path} = ${JSON.stringify(value)}`
      assert.throws(() => f.store.read(), /Fetches could not be read/, label)
      assert.match(
        (await service.invoke(api.RECIPE_CHANNELS.list, 'fixture')).error ?? '',
        /Fetches could not be read/,
        label
      )
      assert.match(
        (await service.invoke(api.RECIPE_CHANNELS.save, f.scope, draft)).error ?? '',
        /Fetches could not be read/,
        label
      )
      assert.throws(() => f.store.complete(output), /Fetches could not be read/, label)
      assert.equal(readFileSync(f.file, 'utf8'), before, label)
      assert.deepEqual(readdirSync(f.root).sort(), ['meetings', 'recipes-v1.json'])
    }
  writeFileSync(f.file, valid)
  assert.deepEqual(await f.runner.run(f.request, 1), output)
  assert.equal(f.calls(), 1)
  assert.equal(f.store.read().outputs.length, 1)
})

test('complete validates new artifacts and retry payloads before any write', async (t) => {
  const f = fixture(t)
  const output = await f.runner.run(f.request, 1)
  const before = readFileSync(f.file, 'utf8')
  for (const runId of ['run-1', 'new-run'])
    for (const [path, values] of malformed.filter(([path]) => path.startsWith('outputs.0.'))) {
      for (const value of values) {
        const broken = structuredClone({ ...output, runId })
        change(broken, path.slice('outputs.0.'.length), value)
        assert.throws(
          () => f.store.complete(broken),
          /Invalid fetch/,
          `${path} = ${JSON.stringify(value)}`
        )
        assert.equal(readFileSync(f.file, 'utf8'), before)
        assert.deepEqual(readdirSync(f.root).sort(), ['meetings', 'recipes-v1.json'])
      }
    }
})

test('valid richer metadata survives saves, restart and idempotent completion', async (t) => {
  const f = fixture(t)
  await f.runner.run(f.request, 1)
  const richer = JSON.parse(readFileSync(f.file, 'utf8'))
  richer.future = { keep: true }
  for (const target of [
    richer.versions[0],
    richer.outputs[0],
    richer.outputs[0].recipe,
    richer.outputs[0].source,
    richer.outputs[0].model
  ])
    target.future = { keep: true }
  writeFileSync(f.file, JSON.stringify(richer))
  f.store.save({ ...draft, policy: 'explicit-cloud' })
  const restarted = new RecipeStore(f.root)
  const retained = restarted.read()
  assert.deepEqual(retained.versions[0], richer.versions[0])
  assert.deepEqual(retained.outputs[0], richer.outputs[0])
  assert.deepEqual(retained.future, richer.future)
  const before = readFileSync(f.file, 'utf8')
  assert.deepEqual(restarted.complete(retained.outputs[0]), richer.outputs[0])
  assert.equal(readFileSync(f.file, 'utf8'), before)
})

test('actual save/list/cancel IPC rejects malformed arguments without changing the library', async (t) => {
  const f = fixture(t),
    service = ipc(f.runner)
  const before = readFileSync(f.file, 'utf8')
  for (const scope of [
    undefined,
    null,
    {},
    [],
    { ...f.scope, accountId: undefined },
    { ...f.scope, workspaceId: null, libraryId: 1 }
  ])
    assert.match(
      (await service.invoke(api.RECIPE_CHANNELS.save, scope, draft)).error ?? '',
      /Invalid fetch library scope/
    )
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...draft, inputs: null },
    { ...draft, policy: ['local-only'] }
  ])
    assert.ok((await service.invoke(api.RECIPE_CHANNELS.save, f.scope, value)).error)
  for (const parent of [null, 1, [], ''])
    assert.ok((await service.invoke(api.RECIPE_CHANNELS.save, f.scope, draft, parent)).error)
  for (const duplicate of [null, 'false', 1, {}])
    assert.ok(
      (await service.invoke(api.RECIPE_CHANNELS.save, f.scope, draft, undefined, duplicate)).error
    )
  for (const identity of [
    undefined,
    null,
    {},
    [],
    { meetingId: 'fixture' },
    { meetingId: 'fixture', runId: null }
  ])
    assert.equal(await service.invoke(api.RECIPE_CHANNELS.cancel, identity), false)
  for (const meetingId of [undefined, null, 1, [], '../escape'])
    assert.match(
      (await service.invoke(api.RECIPE_CHANNELS.list, meetingId)).error ?? '',
      /Invalid meeting ID/
    )
  assert.equal(f.admitted(), 0)
  assert.equal(f.calls(), 0)
  assert.equal(readFileSync(f.file, 'utf8'), before)
  assert.equal(readFileSync(join(f.root, 'meetings/fixture.json'), 'utf8'), f.original)
})

test('duplicate stored identities and invalid generated model metadata cannot replace history', async (t) => {
  const f = fixture(t)
  await f.runner.run(f.request, 1)
  const before = readFileSync(f.file, 'utf8')
  for (const key of ['versions', 'outputs']) {
    const duplicate = JSON.parse(before)
    duplicate[key].push(duplicate[key][0])
    const broken = JSON.stringify(duplicate)
    writeFileSync(f.file, broken)
    assert.throws(() => f.store.save(draft), /Fetches could not be read/)
    assert.equal(readFileSync(f.file, 'utf8'), broken)
  }
  writeFileSync(f.file, before)
  for (const modelRevision of [undefined, null, 1, '']) {
    const runner = new RecipeRunner(
      () => f.root,
      () => {},
      async () => ({
        markdown: 'Synthetic result',
        engine: 'local:fixture',
        elapsedMs: 1,
        modelRevision: modelRevision as string
      })
    )
    await assert.rejects(runner.run({ ...f.request, runId: 'new-run' }, 1), /Invalid fetch result/)
    assert.equal(readFileSync(f.file, 'utf8'), before)
  }
  const completed = await f.runner.run({ ...f.request, runId: 'new-run' }, 1)
  assert.equal(completed.runId, 'new-run')
  assert.equal(f.store.read().outputs.length, 2)
})
