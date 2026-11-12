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
import * as markdownHtml from '../shared/markdown-html'
import * as libraryPath from './library-path'
import * as dictationModel from './dictation-model'
import { LibraryActivity } from './library-activity'
import * as meetingsApi from '../shared/meetings-api'
import * as meetingOwnership from './meeting-write-ownership'
import * as engineQuit from './engine-quit'
import { NotesGenerationJobs } from './notes-generation-job'
import { TranscriptSession } from './transcript-session'
import { captureEventForSession } from './capture-event'
import type { EngineEvent } from '../shared/engine-events'

interface CloudCall {
  options: Record<string, unknown>
  ran: Array<{ system: string; prompt: string }>
}

/** What the stand-in local engines and model store saw. */
interface LocalRig {
  installed: Set<string>
  engines: Array<{
    uri: string
    prepared: number
    warmed: string[]
    canceled: boolean
    disposed: boolean
    ran: Array<Record<string, unknown>>
    generated: ai.MergeInput[]
  }>
}

interface Service {
  warmDictationModel(): void
  warmNotesModel(meetingId: string, source?: 'mic' | 'system' | 'both'): void
  observeNotesTranscript(meetingId: string, segments: meetings.MeetingTranscriptSegment[]): void
  cancelNotesWarmup(meetingId?: string): Promise<void>
  notesWarm: { work: Promise<void> } | null
  dispose(): Promise<void>
  enhance(request: api.EnhanceRequest, owner: number): Promise<api.EnhanceResult>
  settings: Record<string, unknown>
  askBusy: boolean
  activateBusy: boolean
  runDictationCleanup(
    mode: 'local' | 'byok',
    system: string,
    prompt: string,
    signal: AbortSignal,
    consent: { provider: string; model: string } | null
  ): Promise<{ markdown: string; engineId: string }>
  dictationCleanupOptions(): { localModelLabel: string | null; byok: unknown }
  runRecipe(...args: unknown[]): Promise<unknown>
}

/** The real NotesService with only Electron and the hosted engine replaced. */
function createService(
  dir: string,
  hold?: { release?: () => void; settleAfterAbort?: boolean },
  local?: LocalRig,
  power = { battery: false, free: 32 * 1024 ** 3 },
  actualMeetings?: meetings.MeetingFileStore,
  timers = { setTimeout, clearTimeout }
): { service: Service; cloud: CloudCall[] } {
  const cloud: CloudCall[] = []
  class StubCloudEngine {
    readonly id = 'cloud:stub'
    readonly call: CloudCall
    constructor(options: Record<string, unknown>) {
      this.call = { options, ran: [] }
      cloud.push(this.call)
    }
    async runBounded(system: string, prompt: string): Promise<{ markdown: string }> {
      this.call.ran.push({ system, prompt })
      if (hold) await new Promise<void>((resolve) => (hold.release = resolve))
      return { markdown: 'Cleaned text.' }
    }
  }
  class StubLocalEngine {
    readonly id: string
    private readonly record: LocalRig['engines'][number]
    constructor(options: { modelUri: string }) {
      this.id = `local:${options.modelUri}`
      this.record = {
        uri: options.modelUri,
        prepared: 0,
        warmed: [],
        canceled: false,
        disposed: false,
        ran: [],
        generated: []
      }
      local?.engines.push(this.record)
    }
    async prepare(): Promise<void> {
      this.record.prepared += 1
    }
    async warm(system: string, signal: AbortSignal): Promise<void> {
      await this.prepare()
      this.record.warmed.push(system)
      if (hold)
        await new Promise<void>((resolve, reject) => {
          hold.release = resolve
          signal.addEventListener(
            'abort',
            () => {
              this.record.canceled = true
              if (!hold.settleAfterAbort) reject(signal.reason)
            },
            { once: true }
          )
        })
    }
    async generateNotes(
      input: ai.MergeInput
    ): Promise<{ markdown: string; engine: string; elapsedMs: number }> {
      this.record.generated.push(input)
      return { markdown: 'Synthetic notes', engine: this.id, elapsedMs: 1 }
    }
    async runBounded(
      _system: string,
      _prompt: string,
      control: Record<string, unknown>
    ): Promise<{ markdown: string }> {
      this.record.ran.push(control)
      return { markdown: 'Tidy.' }
    }
    async dispose(): Promise<void> {
      this.record.disposed = true
    }
  }
  class StubModelStore {
    async find(spec: { id: string }): Promise<string | null> {
      return local?.installed.has(spec.id) ? `/models/${spec.id}.gguf` : null
    }
    async ensure(): Promise<string> {
      throw new Error('not used')
    }
  }
  const deps: Record<string, unknown> = {
    electron: {
      app: { getPath: () => dir },
      powerMonitor: { isOnBatteryPower: () => power.battery },
      ipcMain: { handle: () => {} },
      safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'sk-synthetic' }
    },
    './notes-generation-job': { NotesGenerationJobs },
    './library-activity': { libraryActivity: new LibraryActivity() },
    './library-ipc': { libraryIpc: { handle: () => {} } },
    './library-path': libraryPath,
    './cloud-models': { fetchCloudModels: () => [] },
    './dictation-model': dictationModel,
    './model-paths': { modelSearchDirectories: () => [dir] },
    'node:fs': fs,
    'node:path': path,
    'node:os': { freemem: () => power.free, totalmem: () => 64 * 1024 ** 3 },
    '@repo/ai': {
      ...ai,
      preloadNotesRuntime: () => {},
      totalRamGB: () => 64,
      estimateNotesWarmupBytes: async () => 4.5 * 1024 ** 3,
      CloudNotesEngine: StubCloudEngine,
      ...(local ? { LocalNotesEngine: StubLocalEngine, LocalModelStore: StubModelStore } : {})
    },
    '@repo/meetings-store': meetings,
    '../shared/notes-api': api,
    '../shared/markdown-html': markdownHtml,
    '../shared/auto-notes': autoNotes,
    '../shared/batch-transcription': batch,
    '../shared/meeting-recovery': recovery
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
    AbortController,
    Buffer,
    process,
    console,
    setInterval,
    clearInterval,
    ...timers
  })
  const service = new exports.NotesService!(
    dir,
    () => {},
    actualMeetings ?? {
      readAll: () => [],
      get: () => ({ templateId: 'general', segments: [] })
    }
  )
  return { service, cloud }
}

const cloudSettings = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  engineChoice: 'cloud',
  cloud: {
    provider: 'openai',
    model: 'gpt-x',
    apiKeyEncrypted: Buffer.from('opaque').toString('base64'),
    dataPolicyConfirmed: false,
    ...over
  }
})

const sandbox = (): string => fs.mkdtempSync(path.join(tmpdir(), 'dn-dictation-cleanup-'))
const consent = { provider: 'openai', model: 'gpt-x' }

test('hosted cleanup needs the dictation-specific consent for this exact provider and model', async () => {
  const { service, cloud } = createService(sandbox())
  service.settings = cloudSettings()
  const signal = new AbortController().signal
  for (const bad of [
    null,
    { provider: 'anthropic', model: 'gpt-x' },
    { provider: 'openai', model: 'other' }
  ]) {
    await assert.rejects(
      service.runDictationCleanup('byok', 's', 'p', signal, bad),
      (error: Error & { code?: string }) => error.code === 'no-consent'
    )
  }
  assert.equal(cloud.length, 0, 'no hosted engine is even constructed without consent')
  assert.equal(service.askBusy, false)
})

test('with consent, only the dictated text goes to the provider and the lease is released', async () => {
  const { service, cloud } = createService(sandbox())
  service.settings = cloudSettings()
  const result = await service.runDictationCleanup(
    'byok',
    'cleanup system',
    '<transcript>\nhello\n</transcript>',
    new AbortController().signal,
    consent
  )
  assert.equal(result.markdown, 'Cleaned text.')
  assert.equal(cloud.length, 1)
  assert.equal(cloud[0]!.options.dataPolicyConfirmed, true)
  assert.equal(cloud[0]!.options.apiKey, 'sk-synthetic')
  assert.deepEqual(cloud[0]!.ran, [
    { system: 'cleanup system', prompt: '<transcript>\nhello\n</transcript>' }
  ])
  assert.equal(service.askBusy, false)
})

test('the provider key is never part of any value handed back to the caller', async () => {
  const { service } = createService(sandbox())
  service.settings = cloudSettings()
  const result = await service.runDictationCleanup(
    'byok',
    's',
    'p',
    new AbortController().signal,
    consent
  )
  assert.ok(!JSON.stringify(result).includes('sk-synthetic'))
  assert.ok(!JSON.stringify(service.dictationCleanupOptions()).includes('sk-synthetic'))
})

test('cleanup refuses rather than interrupting a running generation, and leaves its flags alone', async () => {
  const { service, cloud } = createService(sandbox())
  service.settings = cloudSettings()
  for (const flag of ['askBusy', 'activateBusy'] as const) {
    service[flag] = true
    await assert.rejects(
      service.runDictationCleanup('byok', 's', 'p', new AbortController().signal, consent),
      (error: Error & { code?: string }) => error.code === 'busy'
    )
    assert.equal(service[flag], true, `${flag} still belongs to the original owner`)
    service[flag] = false
  }
  assert.equal(cloud.length, 0)
})

test('cleanup holds the shared lease while it runs, so notes and Ask cannot overlap it', async () => {
  const hold: { release?: () => void } = {}
  const { service } = createService(sandbox(), hold)
  service.settings = cloudSettings()
  const running = service.runDictationCleanup(
    'byok',
    's',
    'p',
    new AbortController().signal,
    consent
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.askBusy, true)
  // Another model task is refused while dictation cleanup owns the model.
  await assert.rejects(
    service.runRecipe('local-only', 's', 'p', new AbortController().signal),
    /Another model operation is running/
  )
  hold.release?.()
  await running
  assert.equal(service.askBusy, false)
})

test('an aborted cleanup releases the lease and reports the abort', async () => {
  const controller = new AbortController()
  const { service } = createService(sandbox())
  service.settings = cloudSettings()
  controller.abort()
  await assert.rejects(service.runDictationCleanup('byok', 's', 'p', controller.signal, consent))
  assert.equal(service.askBusy, false)
})

test('local-engine selection never falls through to a hosted provider', async () => {
  const { service, cloud } = createService(sandbox())
  service.settings = { ...cloudSettings(), engineChoice: 'local' }
  await assert.rejects(
    service.runDictationCleanup('byok', 's', 'p', new AbortController().signal, consent),
    (error: Error & { code?: string }) => error.code === 'no-provider'
  )
  // With no model on disk, local cleanup fails closed too: no silent hosted fallback.
  await assert.rejects(
    service.runDictationCleanup('local', 's', 'p', new AbortController().signal, consent),
    (error: Error & { code?: string }) => error.code === 'no-model'
  )
  assert.equal(cloud.length, 0)
})

test('cleanup never writes settings', async () => {
  const dir = sandbox()
  const { service } = createService(dir)
  service.settings = cloudSettings()
  const before = fs.readdirSync(dir).sort()
  await service.runDictationCleanup('byok', 's', 'p', new AbortController().signal, consent)
  await assert.rejects(
    service.runDictationCleanup('byok', 's', 'p', new AbortController().signal, null)
  )
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'no settings.json (or anything) was created')
})

const rig = (...installed: string[]): LocalRig => ({ installed: new Set(installed), engines: [] })

test('local cleanup asks for a small context, a short answer and a low temperature', async () => {
  const local = rig('qwen3-4b-instruct')
  const { service } = createService(sandbox(), undefined, local)
  service.settings = { engineChoice: 'local', activeLocalModelId: 'qwen3-4b-instruct' }
  await service.runDictationCleanup(
    'local',
    'Tidy.',
    'um hello there',
    new AbortController().signal,
    null
  )
  const control = local.engines[0]!.ran[0]!
  assert.equal(control.phase, 'writing')
  assert.ok((control.contextSize as number) <= 2048, `context ${String(control.contextSize)}`)
  assert.ok((control.maxTokens as number) <= 512)
  assert.equal(control.temperature, 0.2)
})

test('cleanup runs on the quickest installed model, leaving the notes model alone', async () => {
  const local = rig('gemma-3-12b-it', 'qwen3-4b-instruct')
  const { service } = createService(sandbox(), undefined, local)
  // Notes run on the big model; dictation should not swap it out for the small one.
  service.settings = { engineChoice: 'local', activeLocalModelId: 'gemma-3-12b-it' }
  await service.runDictationCleanup('local', 'Tidy.', 'hello', new AbortController().signal, null)
  assert.equal(local.engines.length, 1)
  assert.match(local.engines[0]!.uri, /Qwen3-4B/, 'the small model ran it')
  assert.equal(local.engines[0]!.disposed, false)
  assert.equal(service.dictationCleanupOptions().localModelLabel, 'Fast', 'and the page says so')
  // A second cleanup reuses that engine.
  await service.runDictationCleanup('local', 'Tidy.', 'again', new AbortController().signal, null)
  assert.equal(local.engines.length, 1)
  assert.equal(local.engines[0]!.ran.length, 2)
})

test('when the quickest model is the one notes use, the same engine is shared', async () => {
  const local = rig('qwen3-4b-instruct')
  const { service } = createService(sandbox(), undefined, local)
  service.settings = { engineChoice: 'local', activeLocalModelId: 'qwen3-4b-instruct' }
  await service.runDictationCleanup('local', 'Tidy.', 'one', new AbortController().signal, null)
  await service.runDictationCleanup('local', 'Tidy.', 'two', new AbortController().signal, null)
  assert.equal(local.engines.length, 1)
})

test('the model is loaded ahead of time, once, and cleanup waits for it rather than being refused', async () => {
  const local = rig('qwen3-4b-instruct')
  const { service } = createService(sandbox(), undefined, local)
  service.settings = { engineChoice: 'local', activeLocalModelId: 'qwen3-4b-instruct' }
  service.warmDictationModel()
  service.warmDictationModel()
  assert.equal(service.askBusy, true, 'the lease is held while loading')
  // Cleanup starts while the load is still running.
  const cleaned = await service.runDictationCleanup(
    'local',
    'Tidy.',
    'hello',
    new AbortController().signal,
    null
  )
  assert.equal(cleaned.markdown, 'Tidy.')
  assert.equal(local.engines.length, 1)
  assert.equal(local.engines[0]!.prepared, 1, 'loaded once')
  assert.equal(service.askBusy, false)
})

test('warming is skipped, not queued, while another model task holds the lease', async () => {
  const local = rig('qwen3-4b-instruct')
  const { service } = createService(sandbox(), undefined, local)
  service.settings = { engineChoice: 'local', activeLocalModelId: 'qwen3-4b-instruct' }
  service.askBusy = true
  service.warmDictationModel()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(local.engines.length, 0)
  assert.equal(service.askBusy, true, 'the other task keeps its lease')
})

test('a warm-up with no model installed fails quietly and releases the lease', async () => {
  const local = rig()
  const { service } = createService(sandbox(), undefined, local)
  service.settings = { engineChoice: 'local' }
  service.warmDictationModel()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(service.askBusy, false)
})

test('notes warm-up skips cloud, battery, insufficient RAM and busy operations without loading', async () => {
  const dir = sandbox()
  try {
    for (const reason of ['cloud', 'battery', 'memory', 'busy'] as const) {
      const spec = ai.LOCAL_MODELS[0]!
      const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
      const { service } = createService(dir, undefined, rig, {
        battery: reason === 'battery',
        free: reason === 'memory' ? 0 : 32 * 1024 ** 3
      })
      service.settings = {
        engineChoice: reason === 'cloud' ? 'cloud' : 'local',
        activeLocalModelId: spec.id
      }
      service.askBusy = reason === 'busy'
      service.warmNotesModel('synthetic')
      if (reason === 'memory') await service.notesWarm?.work
      assert.equal(service.notesWarm, null, reason)
      assert.equal(rig.engines.length, 0, reason)
      await service.dispose()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('recording warm-up is asynchronous, deduplicates and Generate joins it', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const hold: { release?: () => void } = {}
  const { service } = createService(dir, hold, rig)
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic')
    service.warmNotesModel('synthetic')
    assert.equal(rig.engines.length, 0, 'capture callback returns before model I/O')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(rig.engines.length, 1)
    assert.equal(rig.engines[0]!.warmed.length, 1)
    assert.equal(
      rig.engines[0]!.warmed[0],
      ai.buildMergeSystemPrompt('general', [{ label: 'You', isSelf: true }])
    )
    let done = false
    const result = service
      .enhance(
        {
          meetingId: 'synthetic',
          runId: 'warm-join',
          title: 'Synthetic',
          rawNotesMarkdown: '',
          segments: []
        },
        1
      )
      .then((value) => {
        done = true
        return value
      })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(done, false)
    hold.release!()
    assert.equal((await result).markdown, 'Synthetic notes')
    assert.equal(rig.engines.length, 1)
    assert.equal(rig.engines[0]!.canceled, false)
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('dictation preempts background notes without a busy rejection', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const { service } = createService(dir, {}, rig)
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const result = await service.runDictationCleanup(
      'local',
      'system',
      'synthetic',
      new AbortController().signal,
      null
    )
    assert.equal(result.markdown, 'Tidy.')
    assert.equal(rig.engines[0]!.canceled, true)
    assert.equal(service.notesWarm, null)
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** Execute the actual index registration/callback with only host boundaries replaced. */
function productionHook(
  predicate: (node: ts.Node, source: ts.SourceFile) => boolean,
  context: Record<string, unknown>
): void {
  const source = ts.createSourceFile(
    'index.ts',
    fs.readFileSync('src/main/index.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let code = ''
  function visit(node: ts.Node): void {
    if (predicate(node, source)) code = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(code)
  runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    context
  )
}

test('authoritative delete IPC and trash writes cancel only their meeting warm-up', async () => {
  const dir = sandbox()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const exports: {
    MeetingsService?: new (
      ...args: unknown[]
    ) => meetings.MeetingFileStore & { registerIpc(): void }
  } = {}
  const deps: Record<string, unknown> = {
    '@repo/meetings-store': meetings,
    './meeting-write-ownership': meetingOwnership,
    '../shared/meetings-api': meetingsApi,
    './library-ipc': {
      libraryIpc: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
          handlers.set(channel, handler)
      }
    }
  }
  runInNewContext(
    ts.transpileModule(fs.readFileSync('src/main/meetings-service.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in deps)
        return deps[name]
      }
    }
  )
  const store = new exports.MeetingsService!(path.join(dir, 'meetings'))
  store.registerIpc()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const { service } = createService(dir, {}, rig, undefined, store)
  productionHook(
    (node, source) =>
      ts.isBinaryExpression(node) && node.left.getText(source) === 'meetingsService.onDidWrite',
    {
      meetingsService: store,
      notesService: service,
      lastLibraryWriteAt: 0,
      sourceIndex: {
        invalidate() {
          /* Host boundary intentionally inert in this integration test. */
        }
      },
      syncService: {
        onMeetingsChanged() {
          /* Host boundary intentionally inert in this integration test. */
        }
      },
      audioService: {
        deleteFor() {
          /* Host boundary intentionally inert in this integration test. */
        }
      }
    }
  )
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    for (const action of ['delete', 'trash']) {
      store.upsert({ id: 'synthetic', title: 'Synthetic', templateId: 'general' })
      service.warmNotesModel('synthetic')
      await new Promise((resolve) => setTimeout(resolve, 10))
      rig.engines.at(-1)!.canceled = false
      handlers.get(meetingsApi.MEETINGS_DELETE_CHANNEL)!(null, 'unrelated')
      assert.equal(rig.engines.at(-1)!.canceled, false)
      const work = service.notesWarm!.work
      if (action === 'delete') handlers.get(meetingsApi.MEETINGS_DELETE_CHANNEL)!(null, 'synthetic')
      else
        handlers.get(meetingsApi.MEETINGS_UPSERT_CHANNEL)!(null, {
          id: 'synthetic',
          trashedAt: new Date().toISOString()
        })
      await work
      assert.equal(rig.engines.at(-1)!.canceled, true, action)
    }
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ordinary before-quit cancels warm-up before waiting for recording finalization and hard exit', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const { service } = createService(dir, {}, rig)
  let handler!: (event: { preventDefault(): void }) => void
  let exit!: () => void
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic')
    await new Promise((resolve) => setTimeout(resolve, 10))
    productionHook(
      (node, source) =>
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'app.on' &&
        node.arguments[0]?.getText(source) === "'before-quit'",
      {
        ...engineQuit,
        app: {
          on: (_event: string, callback: typeof handler) => {
            handler = callback
          },
          quit: () => assert.fail('ordinary quit')
        },
        notesService: service,
        libraryActivity: new LibraryActivity(),
        quitting: false,
        process: { platform: 'win32', exit },
        recordingTray: null,
        calendarService: null,
        sessionEnding: false,
        isQuittingForUpdate: () => false,
        engine: { running: true, dispose: async () => {} },
        micWatcher: { dispose: async () => {} },
        finishRecordingBeforeQuit: () => {
          assert.equal(rig.engines[0]!.canceled, true, 'cancellation precedes recording wait')
          return finished
        },
        console: { error: (...args: unknown[]) => assert.fail(String(args)) }
      }
    )
    handler({
      preventDefault() {
        /* Host boundary intentionally inert in this integration test. */
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(rig.engines[0]!.canceled, true)
    finish()
    await exited
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('actual recording ready reads current battery state; exit keeps AC warm-up alive for Generate', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const hold: { release?: () => void } = {}
  const power = { battery: false, free: 32 * 1024 ** 3 }
  const { service } = createService(dir, hold, rig, power)
  let handler!: (event: { event: string; command?: string }) => void
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    productionHook(
      (node, source) =>
        ts.isCallExpression(node) && node.expression.getText(source) === 'engine.onEvent',
      {
        engine: {
          onEvent: (callback: typeof handler) => {
            handler = callback
          }
        },
        dictation: null,
        captureMeetingId: 'synthetic',
        captureSource: 'both',
        pendingCaptureSource: 'mic',
        pendingCaptureMeetingId: 'synthetic',
        randomUUID: () => 'test-capture',
        meetingsService: { get: () => ({ segments: [] }) },
        captureId: 'test',
        notesService: service,
        captureEventForSession: (event: unknown) => event,
        broadcastEngineEvent() {
          /* Host boundary intentionally inert in this integration test. */
        },
        session: {
          handle() {
            /* Host boundary intentionally inert in this integration test. */
          }
        },
        audioService: {
          onAudioSaved() {
            /* Host boundary intentionally inert in this integration test. */
          }
        },
        logEngineEvent() {
          /* Host boundary intentionally inert in this integration test. */
        },
        recording: {
          handle() {
            /* Host boundary intentionally inert in this integration test. */
          },
          snapshot: () => ({ phase: 'recording' }),
          busy: false
        },
        micWatcher: {
          setSuppressed() {
            /* Host boundary intentionally inert in this integration test. */
          }
        }
      }
    )
    handler({ event: 'started', command: 'live' })
    power.battery = true // Changed after service construction, before ready.
    handler({ event: 'ready' })
    assert.equal(service.notesWarm, null)
    assert.equal(rig.engines.length, 0)
    power.battery = false
    handler({ event: 'ready' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(
      rig.engines[0]!.warmed[0],
      ai.buildMergeSystemPrompt('general', [{ label: 'You', isSelf: true }])
    )
    handler({ event: 'exit' })
    assert.equal(rig.engines[0]!.canceled, false)
    const result = service.enhance(
      {
        meetingId: 'synthetic',
        runId: 'stop-join',
        title: 'Synthetic',
        rawNotesMarkdown: '',
        segments: []
      },
      1
    )
    hold.release!()
    assert.equal((await result).markdown, 'Synthetic notes')
    assert.equal(rig.engines[0]!.canceled, false)
  } finally {
    await service.dispose()
    const logs = fs
      .readFileSync(path.join(dir, 'notes-engine.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.ok(
      logs.some(
        (e) =>
          e.event === 'warmup' &&
          e.reason === 'skipped' &&
          e.why === 'battery' &&
          e.onBatteryPower === true
      )
    )
    assert.ok(
      logs.some((e) => e.event === 'warmup' && e.reason === 'start' && e.onBatteryPower === false)
    )
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

for (const profileCase of ['missing', 'stale', 'cleared', 'manual'] as const) {
  test(`warm roster uses foreground profile helper: ${profileCase}`, async () => {
    const dir = sandbox()
    const store = new meetings.MeetingFileStore(path.join(dir, 'meetings'))
    const participants: meetings.MeetingParticipant[] =
      profileCase === 'missing'
        ? []
        : [
            {
              id: 'self',
              name: 'PrivateOldName',
              source: profileCase === 'manual' ? 'manual' : 'self',
              confidence: 1
            }
          ]
    const profileName = profileCase === 'cleared' ? '' : 'PrivateProfileName'
    store.upsert({ id: 'synthetic', title: 'Planning', templateId: 'general', participants })
    const spec = ai.LOCAL_MODELS[0]!
    const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
    const { service } = createService(dir, undefined, rig, undefined, store)
    try {
      service.settings = { engineChoice: 'local', activeLocalModelId: spec.id, profileName }
      service.warmNotesModel('synthetic', 'both')
      await service.notesWarm!.work
      await service.enhance(
        {
          meetingId: 'synthetic',
          runId: 'profile',
          title: 'Planning',
          rawNotesMarkdown: '',
          templateId: 'general',
          participants: meetings.withSelfParticipant(participants, profileName),
          segments: [
            {
              id: '1',
              channel: 'mic',
              speaker: 'You',
              text: 'Hello',
              startMs: 0,
              endMs: 1000,
              confidence: 1
            }
          ]
        },
        1
      )
      const input = rig.engines[0]!.generated[0]!
      assert.equal(
        rig.engines[0]!.warmed[0],
        ai.buildMergeSystemPrompt(input.templateId, input.speakers)
      )
    } finally {
      await service.dispose()
      const logs = fs.readFileSync(path.join(dir, 'notes-engine.log'), 'utf8')
      assert.doesNotMatch(logs, /PrivateOldName|PrivateProfileName/)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('both capture starts self-only, ignores echo, and debounces new observed speakers', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const { service } = createService(dir, undefined, rig)
  const mic: meetings.TranscriptSegment = {
    id: '1',
    channel: 'mic',
    speaker: 'You',
    text: 'Hello',
    startMs: 0,
    endMs: 1000,
    confidence: 1
  }
  const far: meetings.TranscriptSegment = {
    ...mic,
    id: '2',
    channel: 'system',
    speaker: 'Them'
  }
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic', 'both')
    await service.notesWarm!.work
    assert.equal(
      rig.engines[0]!.warmed[0],
      ai.buildMergeSystemPrompt('general', [{ label: 'You', isSelf: true }])
    )
    service.observeNotesTranscript('synthetic', [mic, { ...far, echo: true }])
    await new Promise((resolve) => setTimeout(resolve, 3100))
    assert.equal(rig.engines[0]!.warmed.length, 1)
    service.observeNotesTranscript('synthetic', [mic, far])
    service.observeNotesTranscript('synthetic', [mic, far, { ...far, id: '3' }])
    assert.equal(rig.engines[0]!.warmed.length, 1, 'capture does not wait for native work')
    await new Promise((resolve) => setTimeout(resolve, 3100))
    await service.notesWarm?.work
    assert.equal(rig.engines[0]!.warmed.length, 2)
    await service.enhance(
      {
        meetingId: 'synthetic',
        runId: 'observed',
        title: 'Planning',
        rawNotesMarkdown: '',
        templateId: 'general',
        segments: [mic, far]
      },
      1
    )
    const input = rig.engines[0]!.generated[0]!
    assert.equal(
      rig.engines[0]!.warmed[1],
      ai.buildMergeSystemPrompt(input.templateId, input.speakers)
    )
  } finally {
    await service.dispose()
    const logs = fs
      .readFileSync(path.join(dir, 'notes-engine.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.ok(
      logs.some((e) => e.event === 'warmup' && e.reason === 'rewarm' && e.predictedSpeakers === 2)
    )
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('production transcript callback observes committed non-echo speakers and resumed history', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const clock = debounceClock()
  const { service } = createService(dir, undefined, rig, undefined, undefined, clock.timers)
  const liveSessions: TranscriptSession[] = []
  const mic: meetings.TranscriptSegment = {
    id: 'base',
    channel: 'mic',
    speaker: 'You',
    text: 'Hello',
    startMs: 0,
    endMs: 1000,
    confidence: 1
  }
  const far = { ...mic, id: 'live', channel: 'system' as const, speaker: 'Them' }
  const delivered: unknown[] = []
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic', 'both')
    await service.notesWarm!.work
    productionHook(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (d) => ts.isIdentifier(d.name) && d.name.text === 'session'
        ),
      {
        TranscriptSession: class extends TranscriptSession {
          constructor(...args: ConstructorParameters<typeof TranscriptSession>) {
            super(...args)
            liveSessions.push(this)
          }
        },
        broadcastEngineEvent: (event: unknown) => delivered.push(event),
        captureMeetingId: 'synthetic',
        captureBase: [mic],
        captureBaseEcho: 0,
        notesService: service,
        libraryRoot: () => dir,
        join: path.join,
        assertLibrary: () => {},
        persistCaptureTranscript: () => {},
        meetingsService: {},
        process
      }
    )
    const live = liveSessions[0]!
    live.bindMeeting('synthetic')
    live.handle({
      event: 'started',
      command: 'live',
      binaryPath: 'synthetic',
      captureId: 'capture'
    })
    live.handle({ event: 'ready' })
    const publish = (segments: meetings.TranscriptSegment[]): void =>
      (live as unknown as { publish(segments: meetings.TranscriptSegment[]): void }).publish(
        segments
      )
    publish([{ ...far, echo: true }])
    assert.equal(clock.pending(), 0)
    publish([far])
    assert.equal(clock.pending(), 1)
    assert.equal(delivered.length, 2)
    clock.fire()
    await new Promise((resolve) => setImmediate(resolve))
    await service.notesWarm?.work
    assert.equal(
      rig.engines[0]!.warmed.at(-1),
      ai.buildMergeSystemPrompt('general', [
        { label: 'You', isSelf: true },
        { label: 'Them', isSelf: false }
      ])
    )
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Both production callbacks and the real session; only host/model boundaries are stubbed.
function captureWarmupRig(hold?: { release?: () => void; settleAfterAbort?: boolean }): {
  service: Service
  rig: LocalRig
  clock: ReturnType<typeof debounceClock>
  live: TranscriptSession
  send(event: EngineEvent): void
  speak(): void
  cleanup(): Promise<void>
} {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const clock = debounceClock()
  const { service } = createService(dir, hold, rig, undefined, undefined, clock.timers)
  service.settings = {
    engineChoice: 'local',
    activeLocalModelId: spec.id,
    autoGenerateNotesAfterStop: false
  }
  const liveSessions: TranscriptSession[] = []
  let send!: (event: EngineEvent) => void
  const context = {
    TranscriptSession: class extends TranscriptSession {
      constructor(...args: ConstructorParameters<typeof TranscriptSession>) {
        super(...args)
        liveSessions.push(this)
      }
    },
    captureMeetingId: 'synthetic',
    pendingCaptureMeetingId: 'synthetic',
    captureSource: 'both',
    pendingCaptureSource: 'both',
    captureId: 'capture',
    captureBase: [],
    captureBaseEcho: 0,
    notesService: service,
    libraryRoot: () => dir,
    join: path.join,
    assertLibrary: () => {},
    persistCaptureTranscript: () => {},
    meetingsService: { get: () => ({ segments: [] }) },
    process,
    engine: { onEvent: (callback: typeof send) => (send = callback) },
    dictation: undefined,
    randomUUID: () => 'capture',
    captureEventForSession,
    broadcastEngineEvent: () => {},
    audioService: { onAudioSaved: () => {} },
    logEngineEvent: () => {},
    recording: { handle: () => {}, snapshot: () => ({ phase: 'recording' }), busy: true },
    micWatcher: { setSuppressed: () => {} }
  }
  productionHook(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === 'session'
      ),
    context
  )
  productionHook(
    (node, source) =>
      ts.isCallExpression(node) && node.expression.getText(source) === 'engine.onEvent',
    context
  )
  const live = liveSessions[0]!
  live.bindMeeting('synthetic')
  send({ event: 'started', command: 'live', binaryPath: 'synthetic' })
  send({ event: 'ready' })
  return {
    service,
    rig,
    clock,
    live,
    send,
    speak() {
      send({
        event: 'timings',
        channel: 'system',
        tokens: [{ token: ' Hello.', startSec: 0, endSec: 1, confidence: 1 }]
      })
      send({ event: 'final', channel: 'system', text: 'Hello.' })
    },
    async cleanup() {
      hold?.release?.()
      await service.dispose()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

const captureTerminals: EngineEvent[] = [
  { event: 'done' },
  { event: 'exit', code: 1, signal: null },
  { event: 'error', message: 'Synthetic capture failure' },
  { event: 'spawn-error', message: 'Synthetic spawn failure' }
]
for (const terminal of captureTerminals) {
  test(`production ${terminal.event} drops pending re-warm with automatic notes disabled`, async () => {
    const c = captureWarmupRig()
    try {
      await c.service.notesWarm!.work
      c.speak()
      assert.equal(c.clock.pending(), 1)
      c.send(terminal)
      const pendingAfterEnd = c.clock.pending()
      c.clock.fire()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(c.rig.engines[0]!.warmed.length, 1, 'no new warm job after capture ends')
      assert.equal(pendingAfterEnd, 0, 'terminal event removes the debounce')
      assert.equal(c.rig.engines[0]!.generated.length, 0, 'no Generate requested')
    } finally {
      await c.cleanup()
    }
  })

  test(`production ${terminal.event} invalidates re-warm waiting for a bounded batch`, async () => {
    const hold: { release?: () => void; settleAfterAbort?: boolean } = { settleAfterAbort: true }
    const c = captureWarmupRig(hold)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      const oldWork = c.service.notesWarm!.work
      c.speak()
      c.clock.fire()
      assert.equal(c.rig.engines[0]!.canceled, true)
      c.send(terminal)
      // Native evaluation can finish later than the cancellation request.
      hold.release!()
      await oldWork
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(c.rig.engines[0]!.warmed.length, 1, 'settling the batch must not launch a job')
      assert.equal(c.clock.pending(), 0)
      assert.equal(c.rig.engines[0]!.generated.length, 0)
    } finally {
      await c.cleanup()
    }
  })

  test(`Generate after production ${terminal.event} joins the already-running warm job`, async () => {
    const hold: { release?: () => void } = {}
    const c = captureWarmupRig(hold)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      c.speak()
      c.send(terminal)
      c.clock.fire()
      let done = false
      const result = c.service
        .enhance(
          {
            meetingId: 'synthetic',
            runId: 'after-stop',
            title: 'Synthetic',
            rawNotesMarkdown: '',
            segments: c.live.snapshot('synthetic')!.segments
          },
          1
        )
        .then((value) => {
          done = true
          return value
        })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(done, false, 'Generate must wait for the running warm job')
      assert.equal(c.rig.engines[0]!.canceled, false, 'ending prediction must not abort warm work')
      hold.release!()
      assert.equal((await result).markdown, 'Synthetic notes')
      assert.equal(c.rig.engines[0]!.warmed.length, 1)
      assert.equal(c.rig.engines[0]!.generated.length, 1)
    } finally {
      await c.cleanup()
    }
  })
}
for (const terminal of captureTerminals.slice(0, 2)) {
  test(`session-only ${terminal.event} finalization ends prediction before observing the ended snapshot`, async () => {
    const c = captureWarmupRig()
    try {
      await c.service.notesWarm!.work
      c.speak()
      assert.equal(c.clock.pending(), 1)
      const observe = c.service.observeNotesTranscript.bind(c.service)
      c.service.observeNotesTranscript = (...args) => {
        assert.notEqual(c.live.snapshot('synthetic')?.phase, 'ended')
        observe(...args)
      }
      c.live.handle(terminal)
      assert.equal(c.live.snapshot('synthetic')?.phase, 'ended')
      c.clock.fire()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(c.rig.engines[0]!.warmed.length, 1)
    } finally {
      await c.cleanup()
    }
  })

  test(`production ${terminal.event} ends prediction before flushing a new speaker`, async () => {
    const c = captureWarmupRig()
    try {
      await c.service.notesWarm!.work
      c.send({
        event: 'timings',
        channel: 'system',
        tokens: [{ token: ' Unfinished', startSec: 0, endSec: 1, confidence: 1 }]
      })
      assert.equal(c.clock.pending(), 0)
      const observe = c.service.observeNotesTranscript.bind(c.service)
      c.service.observeNotesTranscript = (...args) => {
        observe(...args)
        assert.equal(c.clock.pending(), 0, 'terminal flush must not schedule a prediction')
      }
      c.send(terminal)
      assert.equal(c.live.snapshot('synthetic')?.phase, 'ended')
      assert.equal(c.live.snapshot('synthetic')?.segments.length, 1)
      c.clock.fire()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(c.rig.engines[0]!.warmed.length, 1)
    } finally {
      await c.cleanup()
    }
  })
}

// Drive only debounce timers; model and service promises still settle normally.
function debounceClock(): {
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  fire(): void
  pending(): number
} {
  const callbacks = new Map<object, () => void>()
  return {
    timers: {
      setTimeout: ((callback: () => void, ms: number) => {
        if (ms !== 3000) return setTimeout(callback, ms)
        const token = {
          unref() {
            /* Debounce is manually driven in this test. */
          }
        }
        callbacks.set(token, callback)
        return token
      }) as typeof setTimeout,
      clearTimeout: ((token: NodeJS.Timeout) => {
        if (!callbacks.delete(token)) clearTimeout(token)
      }) as typeof clearTimeout
    },
    fire() {
      const work = [...callbacks.values()]
      callbacks.clear()
      for (const callback of work) callback()
    },
    pending: () => callbacks.size
  }
}

for (const guard of ['battery', 'cloud', 'busy', 'memory', 'cancel', 'generate'] as const) {
  test(`pending re-warm respects ${guard}`, async () => {
    const dir = sandbox()
    const spec = ai.LOCAL_MODELS[0]!
    const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
    const power = { battery: false, free: 32 * 1024 ** 3 }
    const clock = debounceClock()
    const { service } = createService(dir, undefined, rig, power, undefined, clock.timers)
    const segments: meetings.TranscriptSegment[] = [
      {
        id: '1',
        channel: 'system',
        speaker: 'Them',
        text: 'Hello',
        startMs: 0,
        endMs: 1000,
        confidence: 1
      }
    ]
    try {
      service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
      service.warmNotesModel('synthetic', 'both')
      await service.notesWarm!.work
      service.observeNotesTranscript('unrelated', segments)
      assert.equal(clock.pending(), 0)
      service.observeNotesTranscript('synthetic', segments)
      assert.equal(clock.pending(), 1)
      if (guard === 'battery') power.battery = true
      if (guard === 'cloud') service.settings.engineChoice = 'cloud'
      if (guard === 'busy') service.askBusy = true
      if (guard === 'memory') power.free = 0
      if (guard === 'cancel') {
        await service.cancelNotesWarmup('unrelated')
        assert.equal(clock.pending(), 1)
        await service.cancelNotesWarmup('synthetic')
        assert.equal(clock.pending(), 0)
      }
      if (guard === 'generate') {
        await service.enhance(
          {
            meetingId: 'synthetic',
            runId: 'pending',
            title: 'Planning',
            rawNotesMarkdown: '',
            segments
          },
          1
        )
        assert.equal(clock.pending(), 0)
      }
      clock.fire()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(rig.engines[0]!.warmed.length, 1)
    } finally {
      service.askBusy = false
      await service.dispose()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('re-warm cancels active prefill and settles it before replacement; Generate joins replacement', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const hold: { release?: () => void } = {}
  const clock = debounceClock()
  const { service } = createService(dir, hold, rig, undefined, undefined, clock.timers)
  try {
    service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
    service.warmNotesModel('synthetic', 'both')
    await new Promise((resolve) => setImmediate(resolve))
    const oldWork = service.notesWarm!.work
    const segments: meetings.TranscriptSegment[] = [
      {
        id: '1',
        channel: 'system',
        speaker: 'Them',
        text: 'Hello',
        startMs: 0,
        endMs: 1000,
        confidence: 1
      }
    ]
    service.observeNotesTranscript('synthetic', segments)
    clock.fire()
    await oldWork
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(rig.engines[0]!.canceled, true)
    assert.equal(rig.engines[0]!.warmed.length, 2)
    const result = service.enhance(
      {
        meetingId: 'synthetic',
        runId: 'replacement',
        title: 'Planning',
        rawNotesMarkdown: '',
        segments
      },
      1
    )
    hold.release!()
    assert.equal((await result).markdown, 'Synthetic notes')
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

for (const source of ['mic', 'system', 'both'] as const) {
  for (const named of [false, true]) {
    test(`recording ${source} warm-up matches final speaker rules (named=${named})`, async () => {
      const dir = sandbox()
      const store = new meetings.MeetingFileStore(path.join(dir, 'meetings'))
      const participants: meetings.MeetingParticipant[] = named
        ? [
            { id: 'self', name: 'Alex', source: 'manual', confidence: 1 },
            { id: 'far', name: 'Sam', source: 'manual', confidence: 1 }
          ]
        : []
      store.upsert({ id: 'synthetic', title: 'Planning', templateId: 'general', participants })
      const spec = ai.LOCAL_MODELS[0]!
      const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
      const { service } = createService(dir, undefined, rig, undefined, store)
      try {
        service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
        service.warmNotesModel('synthetic', source)
        await service.notesWarm!.work
        const channels = source === 'both' ? (['system', 'mic'] as const) : [source]
        const segments = channels.map((channel, i) => ({
          id: String(i),
          channel,
          speaker: channel === 'mic' ? 'You' : 'Them',
          text: 'I will review the release checklist tomorrow.',
          startMs: i * 2000,
          endMs: i * 2000 + 1500,
          confidence: 1
        }))
        service.observeNotesTranscript('synthetic', segments)
        await new Promise((resolve) => setTimeout(resolve, 3100))
        await service.notesWarm?.work
        const result = await service.enhance(
          {
            meetingId: 'synthetic',
            runId: 'roster',
            title: 'Planning',
            rawNotesMarkdown: '',
            templateId: 'general',
            participants,
            segments
          },
          1
        )
        assert.equal(result.markdown, 'Synthetic notes')
        const input = rig.engines[0]!.generated[0]!
        assert.equal(
          rig.engines[0]!.warmed.at(-1),
          ai.buildMergeSystemPrompt(input.templateId, input.speakers)
        )
        assert.equal(
          store.get('synthetic')!.segments.length,
          0,
          'warm-up never invents saved segments'
        )
      } finally {
        await service.dispose()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }
}

// Uses a local Qwen3 GGUF, with its real tokenizer and automatically selected
// wrapper. No download/profile access in tests. GPU eligibility alone is injected
// so CPU CI hardware can exercise the application's speculative prefill path.
for (const scenario of ['mic-only-both', 'rewarm'] as const) {
  test(
    `real Qwen3: ${scenario} reuses the entire rendered system prompt`,
    {
      skip:
        !process.env.DOODLENOTE_TEST_QWEN_GGUF &&
        'Set DOODLENOTE_TEST_QWEN_GGUF to an existing Qwen3 GGUF',
      // Native Windows CPU prefill takes over two minutes on Dev04.
      // Production deadlines remain unchanged; this only bounds the opt-in test.
      timeout: 360_000
    },
    async () => {
      const { getLlama, LlamaChatSession, QwenChatWrapper, LlamaText, SpecialTokensText } =
        await import('node-llama-cpp')
      const dir = sandbox()
      const spec = ai.LOCAL_MODELS[0]!
      const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
      const { service } = createService(dir, undefined, rig)
      const llama = await getLlama({ gpu: false, build: 'never' })
      const events: ai.NotesDiagnostic[] = []
      const engine = new ai.LocalNotesEngine({
        modelUri: 'synthetic',
        contextSize: 4096,
        onDiagnostic: (e) => events.push(e)
      })
      try {
        service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
        service.warmNotesModel('synthetic', 'both')
        await service.notesWarm!.work
        const segments: meetings.TranscriptSegment[] = [
          {
            id: '1',
            channel: 'mic',
            speaker: 'You',
            text: 'Review the checklist.',
            startMs: 0,
            endMs: 9000,
            confidence: 1
          }
        ]
        if (scenario === 'rewarm')
          segments.push({
            ...segments[0]!,
            id: '2',
            channel: 'system',
            speaker: 'Them',
            startMs: 9000,
            endMs: 10000
          })
        service.observeNotesTranscript('synthetic', segments)
        if (scenario === 'rewarm') await new Promise((resolve) => setTimeout(resolve, 3100))
        await service.notesWarm?.work
        await service.enhance(
          {
            meetingId: 'synthetic',
            runId: 'native-roster',
            title: 'Release planning',
            rawNotesMarkdown: 'Review the checklist',
            templateId: 'general',
            segments
          },
          1
        )
        const input = rig.engines[0]!.generated[0]!
        const system = ai.buildMergeSystemPrompt(input.templateId, input.speakers)
        const warmSystems = rig.engines[0]!.warmed
        assert.equal(warmSystems.length, scenario === 'rewarm' ? 2 : 1)
        const model = await llama.loadModel({ modelPath: process.env.DOODLENOTE_TEST_QWEN_GGUF! })
        const state = engine as unknown as {
          llama: typeof llama
          model: typeof model
          sequence: import('node-llama-cpp').LlamaContextSequence
        }
        state.llama = new Proxy(llama, {
          get: (target, key) => (key === 'gpu' ? 'vulkan' : Reflect.get(target, key))
        })
        state.model = new Proxy(model, {
          get(target, key) {
            if (key === 'gpuLayers') return 1
            if (key === 'createContext')
              return (options: Parameters<typeof model.createContext>[0]) =>
                target.createContext({ ...options, threads: 2 })
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
        for (const warmSystem of warmSystems) await engine.warm(warmSystem)
        const rewarm = events.filter((e) => e.event === 'prefill' && e.reason === 'start').at(-1)!
        if (scenario === 'rewarm')
          assert.ok(rewarm.skippedTokens! > 0, 're-warm keeps the matching prefix')
        const session = new LlamaChatSession({
          contextSequence: state.sequence,
          systemPrompt: system,
          forceAddSystemPrompt: true
        })
        const wrapper = session.chatWrapper
        assert.ok(wrapper instanceof QwenChatWrapper)
        assert.equal(wrapper.variation, '3')
        const user = ai.buildMergeUserMessage(input)
        const render = (prompt: string): import('node-llama-cpp').Token[] =>
          wrapper
            .generateContextState({
              chatHistory: [
                ...wrapper.generateInitialChatHistory({ systemPrompt: prompt }),
                { type: 'user', text: user },
                { type: 'model', response: [] }
              ]
            })
            .contextText.tokenize(model.tokenizer)
        const oldTokens = render(ai.buildMergeSystemPrompt('general', []))
        const foreground = render(system)
        const turnStart = LlamaText(new SpecialTokensText('<|im_start|>')).tokenize(
          model.tokenizer
        )[0]!
        const systemEnd = foreground.indexOf(turnStart, 1)
        assert.ok(systemEnd > 0)
        const systemTokens = foreground.slice(0, systemEnd)
        const divergence = oldTokens.findIndex((token, i) => token !== foreground[i])
        assert.ok(divergence > 0 && divergence < systemTokens.length)
        const warmed = [...state.sequence.contextTokens]
        assert.deepEqual(warmed, foreground.slice(0, warmed.length))
        assert.ok(warmed.length >= systemTokens.length)
        session.dispose({ disposeSequence: false })
        await assert.rejects(
          engine.runRaw(system, user, undefined, { maxTokens: 1 }),
          /token|limit|budget/i
        )
        const prefill = events.find((e) => e.event === 'prefill' && e.reason !== 'start')!
        assert.ok(prefill.skippedTokens! >= systemTokens.length, JSON.stringify(prefill))
        assert.equal(prefill.skippedTokens, warmed.length)
        console.log(
          JSON.stringify({
            event: 'qwen3-roster-regression',
            scenario,
            rewarmSkippedTokens: rewarm.skippedTokens,
            divergence,
            oldToken: model.detokenize([oldTokens[divergence]!]),
            newToken: model.detokenize([foreground[divergence]!]),
            oldText: model.detokenize(oldTokens.slice(divergence - 8, divergence + 20)),
            newText: model.detokenize(foreground.slice(divergence - 8, divergence + 20)),
            systemTokens: systemTokens.length,
            warmedTokens: warmed.length,
            skippedTokens: prefill.skippedTokens
          })
        )
      } finally {
        await service.dispose()
        await engine.dispose()
        await llama.dispose()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  )
}

test('warm admission uses footprint below the old 5.4GiB gate and logs the context and memory', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const { service } = createService(dir, undefined, rig, { battery: false, free: 5 * 1024 ** 3 })
  service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
  service.warmNotesModel('synthetic')
  await service.notesWarm?.work
  assert.equal(rig.engines[0]?.warmed.length, 1)
  await service.dispose()
  const rows = fs
    .readFileSync(path.join(dir, 'notes-engine.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const start = rows.find((row) => row.event === 'warmup' && row.reason === 'start')
  assert.equal(start.contextSize, 8192)
  assert.equal(start.freeMB, 5120)
  assert.equal(start.requiredMB, 4608)
  assert.equal(start.totalMB, 65536)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('warm admission rechecks available memory after async footprint inspection', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const power = { battery: false, free: 32 * 1024 ** 3 }
  const { service } = createService(dir, undefined, rig, power)
  service.settings = { engineChoice: 'local', activeLocalModelId: spec.id }
  service.warmNotesModel('synthetic')
  power.free = 4 * 1024 ** 3
  await service.notesWarm?.work
  assert.equal(rig.engines.length, 0)
  await service.dispose()
  const rows = fs
    .readFileSync(path.join(dir, 'notes-engine.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const skip = rows.find((row) => row.event === 'warmup' && row.why === 'memory')
  assert.equal(skip.contextSize, 8192)
  assert.equal(skip.freeMB, 4096)
  assert.equal(skip.requiredMB, 4608)
  fs.rmSync(dir, { recursive: true, force: true })
})
