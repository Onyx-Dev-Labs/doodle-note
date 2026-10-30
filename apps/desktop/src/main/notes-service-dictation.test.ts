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
import { LibraryActivity } from './library-activity'
import { NotesGenerationJobs } from './notes-generation-job'

interface CloudCall {
  options: Record<string, unknown>
  ran: Array<{ system: string; prompt: string }>
}

interface Service {
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
  hold?: { release?: () => void }
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
  const deps: Record<string, unknown> = {
    electron: {
      app: { getPath: () => dir },
      ipcMain: { handle: () => {} },
      safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'sk-synthetic' }
    },
    './notes-generation-job': { NotesGenerationJobs },
    './library-activity': { libraryActivity: new LibraryActivity() },
    './library-ipc': { libraryIpc: { handle: () => {} } },
    './library-path': libraryPath,
    './cloud-models': { fetchCloudModels: () => [] },
    './model-paths': { modelSearchDirectories: () => [dir] },
    'node:fs': fs,
    'node:path': path,
    '@repo/ai': { ...ai, CloudNotesEngine: StubCloudEngine },
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
    Buffer,
    process,
    console,
    setInterval,
    clearInterval
  })
  const service = new exports.NotesService!(dir, () => {}, { readAll: () => [] })
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
