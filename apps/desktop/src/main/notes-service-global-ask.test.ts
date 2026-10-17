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

/** Real service/persistence; only Electron and model inference are replaced. */
test('global Ask persists honest coverage, includes upstream omissions, and keeps failed questions out of history', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'dn-global-ask-test-'))
  type Handler = (...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const broadcasts: Array<{ channel: string; payload: { token?: string } }> = []
  const deps: Record<string, unknown> = {
    electron: {
      app: { getPath: () => dir },
      ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
      safeStorage: {}
    },
    './notes-generation-job': { NotesGenerationJobs },
    './library-activity': { libraryActivity: new LibraryActivity() },
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
  const records = Array.from({ length: 35 }, (_, i) => ({
    id: `fixture-${i}`,
    title: `Synthetic ${i}`,
    createdAt: `2026-10-${String(1 + (i % 17)).padStart(2, '0')}`,
    rawNotesMarkdown: i === 16 ? '' : 'Fixture fact.',
    enhancedMarkdown: '',
    segments: i === 16 ? [{ speaker: 'Them', text: 'x'.repeat(1493) + '😀'.repeat(20) }] : [],
    ...(i === 34 ? { trashedAt: '2026-10-17' } : {})
  }))
  records[0]!.rawNotesMarkdown = '' // empty notes are not candidates
  const original = JSON.stringify(records)
  const service = new exports.NotesService!(
    dir,
    (channel: string, payload: { token?: string }) => broadcasts.push({ channel, payload }),
    { readAll: () => records }
  )
  service.registerIpc()
  const historyPath = path.join(dir, 'global-chat.json')
  const history = Array.from({ length: 8 }, () => ({
    question: 'q'.repeat(20_000),
    answer: 'a'.repeat(20_000),
    askedAt: '2026-10-17'
  }))
  fs.writeFileSync(historyPath, JSON.stringify(history))
  let generated = 0
  service.pickEngine = async () => ({
    askAcrossMeetings: async (input: ai.GlobalAskInput, onToken: (text: string) => void) => {
      assert.equal(input.meetings.length, 30)
      assert.equal(input.availableMeetingCount, 33)
      const excerpt = input.meetings.find((meeting) => meeting.sourceId === 'fixture-16')!
      assert.equal(excerpt.sourceTruncated, true)
      assert.equal(
        new TextDecoder().decode(new TextEncoder().encode(excerpt.notesMarkdown)),
        excerpt.notesMarkdown
      )
      const prompt = ai.buildGlobalAskPrompt(input, {
        contextWindowTokens: 8192,
        outputReserveTokens: 1024,
        safetyMarginTokens: 256,
        accounting: 'utf8-upper-bound',
        countInputTokens: (system, user) => ai.utf8TokenUpperBound(system + user)
      })
      generated++
      onToken('Fixture answer')
      return {
        markdown: 'Fixture answer',
        engine: 'local:fixture',
        elapsedMs: 1,
        coverage: prompt.coverage
      }
    }
  })
  const ask = (question: string): Promise<api.GlobalAskResult> =>
    handlers.get(api.NOTES_ASK_GLOBAL_CHANNEL)!({}, { question }) as Promise<api.GlobalAskResult>
  try {
    const result = await ask('What is next?')
    assert.equal(result.coverage?.availableMeetings, 33)
    assert.equal(result.coverage?.suppliedMeetings, 30)
    assert.equal(result.coverage?.omittedHistoryCount, 8)
    assert.match(result.answer!, /not an exhaustive library search/)
    assert.match(broadcasts.at(-1)!.payload.token!, /Context coverage/)
    const saved = fs.readFileSync(historyPath, 'utf8')
    const entries = JSON.parse(saved) as api.GlobalChatEntry[]
    assert.equal(entries.at(-1)!.answer, result.answer)
    assert.deepEqual(entries.at(-1)!.coverage, JSON.parse(JSON.stringify(result.coverage)))
    const failed = await ask('界'.repeat(25_000))
    assert.equal(failed.code, 'question-too-large')
    assert.match(failed.error!, /Shorten it/)
    assert.equal(fs.readFileSync(historyPath, 'utf8'), saved)
    assert.equal(generated, 1)
    assert.equal((await ask('Retry?')).engine, 'local:fixture', 'budget error releases askBusy')
    assert.equal(JSON.stringify(records), original, 'source meetings remain unchanged')
  } finally {
    await service.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
