import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as meetings from '@repo/meetings-store'
import * as meetingApi from '../shared/meetings-api'
import * as recipeApi from '../shared/recipes-api'
import * as ownership from './meeting-write-ownership'
import { RecipeRunner } from './recipe-runner'
import { recipeLibrary } from './recipe-library'
import { MeetingTextSaves } from '../renderer/src/lib/meeting-text-saves'
import {
  invalidateRecipeRun,
  registerRecipeRun,
  RecipeAttempts
} from '../renderer/src/lib/recipe-run'
import { LibraryActivity } from './library-activity'
import { LibraryStorage } from './library-storage'
import { registerLibrarySave, flushLibrarySaves } from '../renderer/src/lib/library-flush'

const rich = {
  id: 'synthetic',
  title: 'Synthetic',
  rawNotesMarkdown: 'Personal original',
  segments: [],
  enhancedMarkdown: 'OBSOLETE LEGACY SUMMARY',
  metadata: {
    revisionID: 'r1',
    selectedSummaryID: 'chosen',
    summaries: [{ id: 'chosen', text: 'SELECTED CORRECTED SUMMARY' }]
  },
  ink: { preserve: true },
  future: { unrelated: [1, 2] }
}
const draft: recipeApi.RecipeDraft = {
  name: 'Selected summary',
  prompt: 'Use selected summary',
  scope: 'current-meeting',
  outputKind: 'markdown',
  policy: 'local-only',
  inputs: { personalNotes: true, transcript: false, selectedSummary: true }
}
function moduleExports(file: string, deps: Record<string, unknown>): Record<string, unknown> {
  const exports = {}
  runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in deps, name)
        return deps[name]
      }
    }
  )
  return exports
}
/** Execute production callback ASTs without replacing their save/run logic or mounting native UI. */
function expression(file: string, name: string, env: Record<string, unknown>): unknown {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let found: string | undefined
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      found = node.initializer?.getText(source)
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source)
    if (
      name === 'registerLibrarySave' &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === name
    )
      found = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  const js = ts.transpileModule(`const value = ${found};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn value;')(...Object.values(env))
}
const view = 'src/renderer/src/MeetingView.tsx'
const panel = 'src/renderer/src/RecipePanel.tsx'
function fixture(t: { after(fn: () => void): void }): {
  root: string
  file: string
  before: string
  storage: LibraryStorage
  activity: LibraryActivity
  runner: RecipeRunner
  notesSaves: MeetingTextSaves
  prompts: string[]
  errors: string[]
  statuses: string[]
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  execute(): Promise<void>
  writes(): number
  fail(value: boolean): void
  failSave(value: boolean): void
  beforeSave(value: () => Promise<void>): void
  produce(value: () => Promise<void>): void
  edit(notes: string, title?: string): void
  debounce(): void
  flush(): Promise<void>
} {
  const root = mkdtempSync(join(tmpdir(), 'dn-recipe-flush-'))
  mkdirSync(join(root, 'meetings'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'meetings/synthetic.json'),
    before = JSON.stringify(rich)
  writeFileSync(file, before)
  const storage = new LibraryStorage(root),
    activity = new LibraryActivity()
  type Handler = (...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) }
  const library = moduleExports('src/main/library-ipc.ts', {
    electron: { ipcMain },
    './library-activity': { libraryActivity: activity }
  })
  const { MeetingsService } = moduleExports('src/main/meetings-service.ts', {
    '@repo/meetings-store': meetings,
    './meeting-write-ownership': ownership,
    './library-ipc': library,
    '../shared/meetings-api': meetingApi
  }) as {
    MeetingsService: new (dir: () => string) => meetings.MeetingFileStore & { registerIpc(): void }
  }
  new MeetingsService(() => join(storage.root, 'meetings')).registerIpc()
  const sender = Object.assign(new EventEmitter(), { id: 1 })
  let writes = 0,
    failSave = false
  let beforeSave = async (): Promise<void> => {}
  const prompts: string[] = []
  let failure = false
  let produce = async (): Promise<void> => {}
  const runner = new RecipeRunner(
    () => storage.root,
    storage.assertAvailable,
    async (_policy, _system, prompt) => {
      prompts.push(prompt)
      await produce()
      if (failure) throw new Error('Missing local model')
      return {
        markdown: 'Synthetic output',
        engine: 'local:fixture',
        modelRevision: 'synthetic-revision',
        elapsedMs: 1
      }
    },
    (work) => activity.run(work)
  )
  const recipeModule = moduleExports('src/main/recipe-service.ts', {
    electron: { ipcMain },
    './library-ipc': library,
    '../shared/recipes-api': recipeApi
  }) as { registerRecipes(runner: RecipeRunner): void }
  recipeModule.registerRecipes(runner)
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({ sender }, ...args)
  const window = {
    meetings: {
      upsert: (patch: unknown) => invoke(meetingApi.MEETINGS_UPSERT_CHANNEL, patch),
      saveNotes: async (patch: unknown) => {
        writes++
        await beforeSave()
        if (failSave) throw new Error('Save failed')
        return invoke(meetingApi.MEETINGS_SAVE_NOTES_CHANNEL, patch)
      }
    },
    recipes: {
      run: (request: unknown) => invoke(recipeApi.RECIPE_CHANNELS.run, request),
      cancel: (request: unknown) => invoke(recipeApi.RECIPE_CHANNELS.cancel, request)
    }
  }
  const notesSaves = expression(view, 'notesSaves', {
    window,
    meetingId: 'synthetic',
    MeetingTextSaves,
    useMemo: (fn: () => unknown) => fn()
  }) as MeetingTextSaves
  notesSaves.load({ title: rich.title, rawNotesMarkdown: rich.rawNotesMarkdown })
  const titleValueRef = { current: rich.title },
    roughMarkdownRef = { current: rich.rawNotesMarkdown }
  const saveTimerRef = { current: null },
    discardingRef = { current: false }
  let scheduled: (() => void) | undefined
  const env = {
    window,
    notesSaves,
    meetingId: 'synthetic',
    titleValueRef,
    roughMarkdownRef,
    saveTimerRef,
    discardingRef,
    contentLoadedRef: { current: true },
    useCallback: (fn: unknown) => fn,
    invalidateRecipeRun,
    setTimeout: (fn: () => void) => {
      scheduled = fn
      return 1
    },
    clearTimeout: () => {
      scheduled = undefined
    }
  }
  const flushNotesSave = expression(view, 'flushNotesSave', env) as () => Promise<void>
  const scheduleNotesSave = expression(view, 'scheduleNotesSave', env) as () => void
  const unregister = expression(view, 'registerLibrarySave', {
    registerLibrarySave,
    flushNotesSave
  }) as () => void
  t.after(unregister)
  const scope = recipeLibrary(root).scope,
    version = runner.save(scope, draft)
  const errors: string[] = [],
    statuses: string[] = []
  const execute = expression(panel, 'execute', {
    window,
    meetingId: 'synthetic',
    list: runner.list('synthetic'),
    selected: version.versionId,
    dirty: false,
    setBusy: () => {},
    setRunning: () => {},
    setList: () => {},
    setError: (value: string) => {
      if (value) errors.push(value)
    },
    setStatus: (value: string) => statuses.push(value),
    generation: { current: 0 },
    run: { current: null },
    attempts: { current: new RecipeAttempts() },
    registerRecipeRun,
    flushLibrarySaves,
    unwrap: expression(panel, 'unwrap', {})
  }) as () => Promise<void>
  return {
    root,
    file,
    before,
    storage,
    activity,
    runner,
    invoke,
    execute,
    errors,
    statuses,
    notesSaves,
    prompts,
    writes: () => writes,
    fail: (value: boolean) => {
      failure = value
    },
    failSave: (value: boolean) => {
      failSave = value
    },
    beforeSave: (value: () => Promise<void>) => {
      beforeSave = value
    },
    produce: (value: () => Promise<void>) => {
      produce = value
    },
    edit: (notes: string, title = titleValueRef.current) => {
      roughMarkdownRef.current = notes
      titleValueRef.current = title
      scheduleNotesSave()
    },
    debounce: () => {
      scheduled?.()
      scheduled = undefined
    },
    flush: flushNotesSave
  }
}

test('actual pre-run UI flush → IPC → source keeps clean original bytes on success, repeat and missing model', async (t) => {
  const f = fixture(t)
  await f.execute()
  await f.execute()
  f.fail(true)
  await f.execute()
  assert.match(f.errors.at(-1)!, /Missing local model/)
  assert.equal(f.writes(), 0)
  assert.equal(readFileSync(f.file, 'utf8'), f.before)
  for (const prompt of f.prompts) {
    assert.match(prompt, /SELECTED CORRECTED SUMMARY/)
    assert.doesNotMatch(prompt, /OBSOLETE/)
  }
  assert.equal(f.runner.list('synthetic').outputs.length, 2)
})

test('dirty UI edits use actual note-save IPC; corrected summary, ink, ownership and unrelated raw fields survive', async (t) => {
  const f = fixture(t)
  const original = { ...rich, sourceScope: recipeLibrary(f.root).scope }
  writeFileSync(f.file, JSON.stringify(original))
  f.edit('User edited notes', 'User title')
  await f.execute()
  assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')), {
    ...original,
    title: 'User title',
    rawNotesMarkdown: 'User edited notes'
  })
  assert.equal(f.writes(), 1)
  assert.match(f.prompts[0]!, /SELECTED CORRECTED SUMMARY/)
  assert.match(f.prompts[0]!, /User edited notes/)
  assert.doesNotMatch(f.prompts[0]!, /OBSOLETE/)
  await f.flush()
  assert.equal(f.writes(), 1)
  for (const reserved of [
    'metadata',
    'ink',
    'sourceScope',
    'segments',
    'enhancedMarkdown',
    'trashedAt',
    'future'
  ]) {
    const before = readFileSync(f.file, 'utf8')
    await assert.rejects(
      f.invoke(meetingApi.MEETINGS_SAVE_NOTES_CHANNEL, {
        id: 'synthetic',
        title: 'Attacker',
        [reserved]: null
      }),
      /Invalid meeting text edit/
    )
    assert.equal(readFileSync(f.file, 'utf8'), before)
  }
})

test('failed debounce remains dirty and prevents inference; retry saves it before generation', async (t) => {
  const f = fixture(t)
  f.failSave(true)
  f.edit('Keep failed edit')
  f.debounce()
  await f.execute()
  assert.match(f.errors.at(-1)!, /Save failed/)
  assert.equal(f.prompts.length, 0)
  assert.equal(readFileSync(f.file, 'utf8'), f.before)
  f.failSave(false)
  await f.execute()
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).rawNotesMarkdown, 'Keep failed edit')
  assert.match(f.prompts[0]!, /Keep failed edit/)
})

test('an in-flight debounce drains newer edits, concurrent flushes coalesce, and edit cancels pending recipe', async (t) => {
  const f = fixture(t)
  let release!: () => void, started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  f.beforeSave(async () => {
    started()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  f.edit('First edit')
  f.debounce()
  await ready
  const pending = f.execute(),
    anotherFlush = f.flush()
  f.edit('Newest edit')
  f.beforeSave(async () => {})
  release()
  await Promise.all([pending, anotherFlush])
  assert.equal(f.writes(), 2)
  assert.equal(f.prompts.length, 0)
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).rawNotesMarkdown, 'Newest edit')
  await f.execute()
  assert.match(f.prompts[0]!, /Newest edit/)
})

test('cancel during clean model run and during queued flush preserves originals and generation fences', async (t) => {
  const f = fixture(t)
  let release!: () => void, started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  f.produce(async () => {
    started()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const pending = f.execute()
  await ready
  invalidateRecipeRun('synthetic', 'canceled')
  release()
  await pending
  assert.equal(f.writes(), 0)
  assert.equal(readFileSync(f.file, 'utf8'), f.before)
  assert.equal(f.runner.list('synthetic').outputs.length, 0)
  f.produce(async () => {})
  await f.execute()
  assert.equal(f.runner.list('synthetic').outputs.length, 1)
})

test('actual text IPC obeys relocation barrier and preserves richer data in the moved library', async (t) => {
  const f = fixture(t)
  const destination = mkdtempSync(join(tmpdir(), 'dn-recipe-flush-move-'))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  f.edit('Pending during relocation')
  let release!: () => void
  const moving = f.activity.exclusive(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    f.storage.schedule(destination)
    await f.storage.finishPending()
  })
  const pending = f.execute()
  invalidateRecipeRun('synthetic', 'canceled')
  release()
  await moving
  await pending
  assert.equal(f.prompts.length, 0)
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.storage.root, 'meetings/synthetic.json'), 'utf8')),
    { ...rich, rawNotesMarkdown: 'Pending during relocation' }
  )
  assert.equal(readFileSync(f.file, 'utf8'), f.before)
})
