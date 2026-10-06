import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as ai from '@repo/ai'
import * as meetings from '@repo/meetings-store'
import * as api from '../shared/notes-api'
import * as autoNotes from '../shared/auto-notes'
import * as batch from '../shared/batch-transcription'
import * as recovery from '../shared/meeting-recovery'
import * as libraryPath from './library-path'
import { LibraryActivity } from './library-activity'
import { NotesGenerationJobs } from './notes-generation-job'

/** Run the real IPC/service code, replacing only native runtime and filesystem selection. */
test('service IPC owns preparation, scopes cancel/progress, preserves sources and allows retry after cleanup', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'dn-generation-test-'))
  type Handler = (...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const broadcasts: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const activity = new LibraryActivity()
  const deps: Record<string, unknown> = {
    electron: {
      app: { getPath: () => dir },
      ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
      safeStorage: {}
    },
    './notes-generation-job': { NotesGenerationJobs },
    './library-activity': { libraryActivity: activity },
    './library-ipc': {
      libraryIpc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) }
    },
    './library-path': libraryPath,
    './cloud-models': { fetchCloudModels: () => [] },
    './model-paths': { modelSearchDirectories: () => [dir] },
    'node:fs': fs,
    'node:path': path,
    '@repo/ai': ai,
    '@repo/meetings-store': meetings,
    '../shared/notes-api': api,
    '../shared/auto-notes': autoNotes,
    '../shared/batch-transcription': batch,
    '../shared/meeting-recovery': recovery
  }
  interface Service {
    registerIpc(): void
    pickEngine(): Promise<unknown>
    dispose(): Promise<void>
  }
  const exports: Record<string, new (...args: unknown[]) => Service> = {}
  const source = ts.transpileModule(fs.readFileSync('src/main/notes-service.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.ok(name in deps, name)
      return deps[name]
    },
    Buffer,
    process,
    console,
    setInterval,
    clearInterval
  })
  const service = new exports.NotesService!(
    dir,
    (channel: string, payload: Record<string, unknown>) => broadcasts.push({ channel, payload }),
    {}
  )
  service.registerIpc()
  const sender = { sender: Object.assign(new EventEmitter(), { id: 10 }) }
  const request: api.EnhanceRequest = {
    meetingId: 'fixture',
    runId: 'one',
    title: 'Fixture',
    rawNotesMarkdown: 'Keep this',
    segments: []
  }
  const enhance = (input = request): Promise<api.EnhanceResult> =>
    handlers.get(api.NOTES_ENHANCE_CHANNEL)!(sender, input) as Promise<api.EnhanceResult>
  const cancel = (input = request, event: { sender: { id: number } } = sender): Promise<boolean> =>
    handlers.get(api.NOTES_CANCEL_ENHANCE_CHANNEL)!(event, input) as Promise<boolean>
  let releasePreparation!: () => void
  let calls = 0
  const engine = {
    generateNotes: async (
      _input: ai.MergeInput,
      _tokens: unknown,
      progress: (event: ai.NotesProgress) => void,
      control: ai.GenerationControl
    ) => {
      calls++
      progress({ phase: 'condensing', current: 1, total: 3 })
      await new Promise<void>((resolve) =>
        control.signal!.addEventListener('abort', () => resolve(), { once: true })
      )
      assert.match((await enhance({ ...request, runId: 'overlap' })).error!, /already/)
      return { markdown: 'late partial result', engine: 'fixture', elapsedMs: 1 }
    }
  }
  try {
    service.pickEngine = async () => {
      await new Promise<void>((resolve) => {
        releasePreparation = resolve
      })
      return engine
    }
    const preparing = enhance()
    assert.equal(await cancel({ ...request, runId: 'stale' }), false)
    assert.equal(await cancel(request, { sender: { id: 11 } }), false)
    assert.equal(await cancel(), true)
    releasePreparation()
    assert.equal((await preparing).code, 'canceled')
    assert.equal(calls, 0, 'canceled preparation never starts model generation')
    service.pickEngine = async () => engine
    const condensing = enhance({ ...request, runId: 'two' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    assert.equal(await cancel({ ...request, runId: 'two' }), true)
    assert.equal((await condensing).code, 'canceled')
    assert.equal(calls, 1)
    const detached = enhance({ ...request, runId: 'detached' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    sender.sender.emit('render-process-gone')
    assert.equal((await detached).code, 'canceled')
    assert.equal(sender.sender.listenerCount('render-process-gone'), 0)
    assert.ok(
      broadcasts.some(
        ({ payload }) =>
          payload.runId === 'two' &&
          payload.meetingId === 'fixture' &&
          payload.phase === 'condensing'
      )
    )
    service.pickEngine = async () => ({
      generateNotes: async () => ({ markdown: 'complete', engine: 'fixture', elapsedMs: 1 })
    })
    assert.equal((await enhance({ ...request, runId: 'retry' })).markdown, 'complete')
    assert.equal(request.rawNotesMarkdown, 'Keep this')
    assert.deepEqual(request.segments, [])
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
