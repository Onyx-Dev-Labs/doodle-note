import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as path from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as api from '../shared/notes-api'
import * as recovery from '../shared/meeting-recovery'
import { fetchCloudModels } from './cloud-models'
import * as autoNotes from '../shared/auto-notes'

// Real settings load/save and engine-selection code; only native dependencies are stubbed.
test('retired settings survive reload, block requests, and never migrate keys to new providers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-provider-test-'))
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let decryptions = 0
  const exports: Record<string, new (...args: unknown[]) => { registerIpc(): void }> = {}
  const deps: Record<string, unknown> = {
    electron: {
      app: { getPath: () => dir },
      ipcMain: {
        handle: (key: string, fn: (...args: unknown[]) => unknown) => handlers.set(key, fn)
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(`fixture:${value}`),
        decryptString: (value: Buffer) => {
          decryptions++
          return value.toString().replace('fixture:', '')
        }
      }
    },
    './cloud-models': { fetchCloudModels },
    'node:fs': fs,
    'node:path': path,
    '@repo/ai': {
      LOCAL_MODELS: [],
      DEFAULT_MODELS_DIR: dir,
      LocalModelStore: class {},
      CloudNotesEngine: class {},
      totalRamGB: () => 16
    },
    '@repo/meetings-store': { sanitizeSpeakerName: (value: string) => value.trim() },
    '../shared/notes-api': api,
    '../shared/auto-notes': autoNotes,
    '../shared/meeting-recovery': recovery,
    './model-paths': { modelSearchDirectories: () => [] }
  }
  const source = ts.transpileModule(readFileSync('src/main/notes-service.ts', 'utf8'), {
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
    console
  })
  const settingsPath = join(dir, 'settings.json')
  const notePath = join(dir, 'meeting.json')
  writeFileSync(notePath, 'unchanged meeting fixture')
  try {
    for (const retired of ['groq', 'openrouter']) {
      const original = JSON.stringify({
        engineChoice: 'cloud',
        profileName: 'Fixture Owner',
        cloud: {
          provider: retired,
          model: 'old-model',
          apiKeyEncrypted: Buffer.from('fixture:old-key').toString('base64')
        }
      })
      writeFileSync(settingsPath, original)
      const service = new exports.NotesService!(dir, () => {}, { list: () => [] })
      service.registerIpc()
      const get = (): api.NotesSettingsView =>
        handlers.get(api.NOTES_GET_SETTINGS_CHANNEL)!(null) as api.NotesSettingsView
      const set = (cloud: api.NotesSettingsUpdate['cloud']): api.NotesSettingsView =>
        handlers.get(api.NOTES_SET_SETTINGS_CHANNEL)!(null, { cloud }) as api.NotesSettingsView
      assert.equal(get().cloud?.provider, retired)
      assert.equal(readFileSync(settingsPath, 'utf8'), original)
      const engine = service as unknown as { pickEngine(): Promise<unknown> }
      await assert.rejects(engine.pickEngine(), /retired/)
      assert.equal(decryptions, 0)
      const missingKey = set({ provider: 'grok', dataPolicyConfirmed: true })
      assert.match(missingKey.error ?? '', /Enter an API key/)
      assert.equal(missingKey.cloud?.provider, retired)
      const saved = set({
        provider: 'gemini',
        apiKey: 'new-fixture-key',
        dataPolicyConfirmed: true
      })
      assert.equal(saved.cloud?.provider, 'gemini')
      assert.equal(saved.cloud?.dataPolicyConfirmed, true)
      const reloaded = new exports.NotesService!(dir, () => {}, { list: () => [] })
      reloaded.registerIpc()
      assert.equal(get().cloud?.dataPolicyConfirmed, true)
      assert.equal(get().profileName, 'Fixture Owner')
      const unconfirmed = set({ provider: 'gemini', apiKey: 'another-fixture-key' })
      assert.equal(unconfirmed.cloud?.dataPolicyConfirmed, false)
      assert.equal(readFileSync(notePath, 'utf8'), 'unchanged meeting fixture')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
