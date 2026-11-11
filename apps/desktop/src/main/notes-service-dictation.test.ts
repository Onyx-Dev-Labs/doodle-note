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
  }>
}

interface Service {
  warmDictationModel(): void
  warmNotesModel(meetingId: string): void
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
  hold?: { release?: () => void },
  local?: LocalRig,
  power = { battery: false, free: 32 * 1024 ** 3 },
  actualMeetings?: meetings.MeetingFileStore
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
        ran: []
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
              reject(signal.reason)
            },
            { once: true }
          )
        })
    }
    async generateNotes(): Promise<{ markdown: string; engine: string; elapsedMs: number }> {
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
    'node:os': { freemem: () => power.free },
    '@repo/ai': {
      ...ai,
      totalRamGB: () => 64,
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
    setTimeout,
    clearTimeout
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
    assert.equal(rig.engines[0]!.warmed[0], ai.buildMergeSystemPrompt('general', []))
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

test('actual recording exit hook keeps warm-up alive for Generate', async () => {
  const dir = sandbox()
  const spec = ai.LOCAL_MODELS[0]!
  const rig: LocalRig = { installed: new Set([spec.id]), engines: [] }
  const hold: { release?: () => void } = {}
  const { service } = createService(dir, hold, rig)
  let handler!: (event: { event: string }) => void
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
    handler({ event: 'ready' })
    await new Promise((resolve) => setTimeout(resolve, 10))
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
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
