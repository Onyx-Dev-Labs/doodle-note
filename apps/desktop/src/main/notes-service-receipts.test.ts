import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
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
import { NotesGenerationJobs } from './notes-generation-job'

interface Service {
  registerIpc(): void
  warmNotesModel(meetingId: string): void
  notesWarm: { work: Promise<void> } | null
  dispose(): Promise<void>
}

// Exercise the actual constructor, models IPC, warm-up selection and model store.
// Stub only host boundaries and inference; no model download or native GPU is needed.
for (const platform of ['darwin', 'linux', 'win32'] as const) {
  for (const entry of ['discovery', 'warm-up'] as const) {
    test(`${platform} ${entry}: receipt storage is Windows-only and lazy`, async () => {
      const dir = fs.mkdtempSync(path.join(tmpdir(), 'dn-receipt-wiring-'))
      const content = Buffer.from('synthetic GGUF bytes for integrity verification')
      const modelPath = path.join(dir, 'fixture.gguf')
      fs.writeFileSync(modelPath, content)
      const spec: ai.LocalModelSpec = {
        ...ai.LOCAL_MODELS[0]!,
        minRamGB: 0,
        sizeGB: 0,
        artifact: {
          ...ai.LOCAL_MODELS[0]!.artifact,
          bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex')
        }
      }
      fs.writeFileSync(
        path.join(dir, 'settings.json'),
        JSON.stringify({ engineChoice: 'local', activeLocalModelId: spec.id })
      )
      const storageCalls: string[] = []
      let allowStorage = true
      const recordStorage = (method: string): void => {
        storageCalls.push(method)
        assert.ok(allowStorage, `unexpected safeStorage.${method} on ${platform}`)
      }
      // Test codec only: production Windows encryption remains Electron DPAPI.
      const safeStorage = {
        isEncryptionAvailable: () => {
          recordStorage('isEncryptionAvailable')
          return true
        },
        encryptString: (value: string) => {
          recordStorage('encryptString')
          return Buffer.from(value)
        },
        decryptString: (value: Buffer) => {
          recordStorage('decryptString')
          return value.toString()
        },
        getSelectedStorageBackend: () => {
          recordStorage('getSelectedStorageBackend')
          return 'unknown'
        }
      }
      const hashes: boolean[] = []
      let warms = 0
      const services: Service[] = []
      const source = ts.transpileModule(fs.readFileSync('src/main/notes-service.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }).outputText
      const start = (
        hostPlatform: string
      ): { service: Service; discover: () => Promise<api.NotesModelsResponse> } => {
        const handlers = new Map<string, (...args: unknown[]) => unknown>()
        const ipc = {
          handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
            handlers.set(channel, handler)
        }
        const deps: Record<string, unknown> = {
          electron: {
            app: { getPath: () => dir },
            ipcMain: ipc,
            safeStorage,
            powerMonitor: { isOnBatteryPower: () => false }
          },
          './notes-generation-job': { NotesGenerationJobs },
          './library-activity': { libraryActivity: new LibraryActivity() },
          './library-ipc': { libraryIpc: ipc },
          './library-path': libraryPath,
          './cloud-models': { fetchCloudModels: () => [] },
          './dictation-model': dictationModel,
          './model-paths': { modelSearchDirectories: () => [dir] },
          'node:fs': fs,
          'node:path': path,
          'node:os': { freemem: () => 64 * 1024 ** 3 },
          '@repo/ai': {
            ...ai,
            LOCAL_MODELS: [spec],
            totalRamGB: () => 64,
            NotesEngineLog: class {
              log = (event: { event: string; cached: boolean }): void => {
                if (event.event === 'hash') hashes.push(event.cached)
              }
              async flush(): Promise<void> {
                /* Log events are captured in memory. */
              }
            },
            LocalNotesEngine: class {
              constructor(options: { modelPath: string }) {
                assert.equal(options.modelPath, modelPath)
              }
              async warm(): Promise<void> {
                warms++
              }
              async dispose(): Promise<void> {
                /* No native resources in the inference stub. */
              }
            }
          },
          '@repo/meetings-store': meetings,
          '../shared/notes-api': api,
          '../shared/markdown-html': markdownHtml,
          '../shared/auto-notes': autoNotes,
          '../shared/batch-transcription': batch,
          '../shared/meeting-recovery': recovery
        }
        const exports: Record<string, new (...args: unknown[]) => Service> = {}
        runInNewContext(source, {
          exports,
          require: (name: string) => {
            assert.ok(name in deps, name)
            return deps[name]
          },
          process: { platform: hostPlatform, pid: process.pid },
          Buffer,
          AbortController,
          console,
          setTimeout,
          clearTimeout
        })
        const callsBefore = storageCalls.length
        const service = new exports.NotesService!(dir, () => {}, {
          get: () => ({ segments: [], participants: [] })
        })
        services.push(service)
        service.registerIpc()
        assert.equal(storageCalls.length, callsBefore, 'startup never enters secure storage')
        return {
          service,
          discover: () =>
            handlers.get(api.NOTES_MODELS_CHANNEL)!() as Promise<api.NotesModelsResponse>
        }
      }
      try {
        // A prior Windows instance writes a valid authenticated receipt via production wiring.
        const seed = start('win32')
        assert.equal((await seed.discover()).models[0]!.downloaded, true)
        assert.deepEqual(hashes, [false])
        assert.ok(storageCalls.includes('encryptString'))
        assert.ok(fs.existsSync(path.join(dir, 'model-integrity.json.key')))
        await seed.service.dispose()
        storageCalls.length = 0
        hashes.length = 0
        allowStorage = platform === 'win32'
        const current = start(platform)
        if (entry === 'discovery') {
          assert.equal((await current.discover()).models[0]!.downloaded, true)
        } else {
          current.service.warmNotesModel('meeting')
          assert.ok(current.service.notesWarm, 'warm-up must actually run')
          await current.service.notesWarm.work
          assert.equal(warms, 1, 'verified model reaches inference warm-up')
        }
        assert.deepEqual(
          hashes,
          [platform === 'win32'],
          'only Windows trusts the persisted receipt'
        )
        // All platforms retain the existing verified result within this service instance.
        assert.equal((await current.discover()).models[0]!.downloaded, true)
        assert.deepEqual(hashes, [platform === 'win32', true])
        if (platform === 'win32') {
          assert.deepEqual(storageCalls, [
            'isEncryptionAvailable',
            'getSelectedStorageBackend',
            'decryptString'
          ])
        } else {
          assert.deepEqual(
            storageCalls,
            [],
            'no secure-storage method may be reached, even if it throws'
          )
        }
      } finally {
        for (const service of services) await service.dispose()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }
}
