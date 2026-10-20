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

interface Service {
  registerIpc(): void
  pickEngine(): Promise<unknown>
  dispose(): Promise<void>
}

/** Real service/persistence; only Electron and model inference are replaced. */
function createService(
  dir: string,
  records: unknown[]
): {
  service: Service
  ask: (question: string) => Promise<api.GlobalAskResult>
  broadcasts: Array<{ channel: string; payload: { token?: string } }>
} {
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
  const service = new exports.NotesService!(
    dir,
    (channel: string, payload: { token?: string }) => broadcasts.push({ channel, payload }),
    { readAll: () => records }
  )
  service.registerIpc()
  const ask = (question: string): Promise<api.GlobalAskResult> =>
    handlers.get(api.NOTES_ASK_GLOBAL_CHANNEL)!({}, { question }) as Promise<api.GlobalAskResult>
  return { service, ask, broadcasts }
}

test('global Ask persists honest coverage, includes upstream omissions, and keeps failed questions out of history', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'dn-global-ask-test-'))
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
  const { service, ask, broadcasts } = createService(dir, records)
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

test('global Ask appends coverage only when the exact standalone trailing notice is missing', async (t) => {
  const coverage = ai.buildGlobalAskPrompt(
    {
      question: 'Who owns the synthetic prototype?',
      meetings: [
        { title: 'Synthetic', dateIso: '2026-10-18', notesMarkdown: 'Ada owns the prototype.' }
      ],
      availableMeetingCount: 502,
      history: []
    },
    {
      contextWindowTokens: 16384,
      outputReserveTokens: 4096,
      safetyMarginTokens: 256,
      accounting: 'utf8-upper-bound',
      countInputTokens: (system, user) => ai.utf8TokenUpperBound(system + user)
    }
  ).coverage
  const notice = ai.globalAskCoverageNotice(coverage)
  const body = 'Ada owns the synthetic prototype.  '
  const cases = [
    {
      name: 'P2 open fence embeds the exact trailing notice',
      markdown: `Answer\n\n\`\`\`text\nexample\n\n${notice}`,
      append: true,
      renderedTrailingParagraph: false
    },
    {
      name: 'P2 three newlines precede a standalone notice',
      markdown: `Answer\n\n\n${notice}`,
      append: false,
      renderedTrailingParagraph: true
    },
    { name: 'exact trailing notice', markdown: `${body}\n\n${notice}`, append: false },
    { name: 'notice alone', markdown: notice, append: false },
    { name: 'trailing whitespace', markdown: `${body}\n\n${notice} \t\n\n`, append: false },
    {
      name: 'CRLF and whitespace blank line',
      markdown: `${body}\r\n \t\r\n${notice}\r\n`,
      append: false
    },
    { name: 'absent', markdown: body, append: true },
    {
      name: 'wrong coverage',
      markdown: `${body}\n\n${notice.replace('502', '999')}`,
      append: true
    },
    { name: 'incomplete', markdown: `${body}\n\n${notice.slice(0, -1)}`, append: true },
    { name: 'embedded inline', markdown: `${body} ${notice}`, append: true },
    { name: 'single newline is not a paragraph', markdown: `${body}\n${notice}`, append: true },
    { name: 'followed by answer body', markdown: `${notice}\n\n${body}`, append: true },
    { name: 'quoted notice', markdown: `${body}\n\n> ${notice}`, append: true },
    { name: 'fenced notice', markdown: `${body}\n\n\`\`\`text\n${notice}\n\`\`\``, append: true },
    ...[4, 5].map((count) => ({
      name: `${count} LF newlines before notice`,
      markdown: body + '\n'.repeat(count) + notice,
      append: false,
      renderedTrailingParagraph: true
    })),
    ...[3, 5].map((count) => ({
      name: `${count} CRLF newlines before notice`,
      markdown: body + '\r\n'.repeat(count) + notice,
      append: false,
      renderedTrailingParagraph: true
    })),
    {
      name: 'multiple whitespace-only blank lines and trailing whitespace',
      markdown: `${body}\r\n \t\r\n\n\t \n${notice}\t \r\n\n`,
      append: false,
      renderedTrailingParagraph: true
    },
    {
      name: 'leading blank lines before notice alone',
      markdown: `\n \t\r\n${notice}`,
      append: false,
      renderedTrailingParagraph: true
    },
    {
      name: 'renderer whitespace-only blank line includes nonbreaking space',
      markdown: `${body}\n\n\u00a0\r\n${notice}\u00a0`,
      append: false,
      renderedTrailingParagraph: true
    },
    ...['````text', '  ```text'].map((fence) => ({
      name: `open renderer fence ${JSON.stringify(fence)}`,
      markdown: `${body}\n\n${fence}\nexample\n\n${notice}`,
      append: true,
      renderedTrailingParagraph: false
    })),
    {
      name: 'two backticks do not close a renderer fence',
      markdown: `${body}\n\n\`\`\`text\nexample\n\`\`\n\n${notice}`,
      append: true,
      renderedTrailingParagraph: false
    },
    {
      name: 'renderer closes four backticks with three',
      markdown: `${body}\n\n\`\`\`\`text\nexample\n\`\`\`\n\n${notice}`,
      append: false,
      renderedTrailingParagraph: true
    },
    {
      name: 'renderer does not implement tilde fences',
      markdown: `${body}\n\n~~~text\nexample\n\n${notice}`,
      append: false,
      renderedTrailingParagraph: true
    },
    {
      name: 'tilde delimiter does not close backtick fence',
      markdown: `${body}\n\n\`\`\`text\nexample\n~~~\n\n${notice}`,
      append: true,
      renderedTrailingParagraph: false
    },
    ...['> > ', '- ', '1. ', '- [ ] ', '  ', '# '].map((marker) => ({
      name: `notice embedded with ${JSON.stringify(marker)} prefix`,
      markdown: `${body}\n\n${marker}${notice}`,
      append: true,
      renderedTrailingParagraph: false
    })),
    {
      name: 'notice after closed quote and list blocks',
      markdown: `${body}\n\n> Quote\n- Item\n\n\n${notice}`,
      append: false,
      renderedTrailingParagraph: true
    },
    {
      name: 'literal HTML cannot masquerade as the exact paragraph',
      markdown: `${body}\n\n<p>${notice}</p>`,
      append: true,
      renderedTrailingParagraph: false
    },
    {
      name: 'adapter-trimmed return does not rewrite raw streamed whitespace',
      markdown: body.trim(),
      streamedMarkdown: body,
      append: true,
      renderedTrailingParagraph: false
    },
    { name: 'no coverage', markdown: body, append: false, noCoverage: true }
  ]
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const dir = fs.mkdtempSync(path.join(tmpdir(), 'dn-global-ask-test-'))
      const { service, ask, broadcasts } = createService(dir, [
        { id: 'synthetic', title: 'Synthetic', createdAt: '2026-10-18', rawNotesMarkdown: body }
      ])
      const expectedCoverage = scenario.noCoverage ? undefined : coverage
      service.pickEngine = async () => ({
        askAcrossMeetings: async (_input: ai.GlobalAskInput, onToken: (text: string) => void) => {
          // Most fixtures stream the returned markdown verbatim. The adapter-trim
          // case explicitly preserves the preexisting raw-stream/return difference.
          const streamed = scenario.streamedMarkdown ?? scenario.markdown
          const split = Math.floor(streamed.length / 2)
          onToken(streamed.slice(0, split))
          onToken(streamed.slice(split))
          return {
            markdown: scenario.markdown,
            engine: 'local:fixture',
            elapsedMs: 1,
            coverage: expectedCoverage
          }
        }
      })
      try {
        if (scenario.renderedTrailingParagraph !== undefined) {
          assert.equal(
            markdownHtml
              .markdownToHtml(scenario.markdown)
              .endsWith(`<p>${markdownHtml.escapeHtml(notice)}</p>`),
            scenario.renderedTrailingParagraph,
            'actual Ask renderer distinguishes the final paragraph from embedded code'
          )
        }
        const result = await ask('Who owns the synthetic prototype?')
        const expected = scenario.markdown + (scenario.append ? `\n\n${notice}` : '')
        assert.equal(result.error, undefined)
        assert.equal(result.answer, expected)
        assert.equal(
          broadcasts
            .filter(({ channel }) => channel === api.NOTES_ASK_GLOBAL_TOKEN_CHANNEL)
            .map(({ payload }) => payload.token)
            .join(''),
          (scenario.streamedMarkdown ?? scenario.markdown) +
            (scenario.append ? `\n\n${notice}` : ''),
          'service preserves raw model tokens and appends only the deterministic suffix'
        )
        const entries = JSON.parse(
          fs.readFileSync(path.join(dir, 'global-chat.json'), 'utf8')
        ) as api.GlobalChatEntry[]
        assert.equal(entries.length, 1)
        assert.equal(entries[0]!.answer, expected, 'persisted answer matches returned answer')
        assert.deepEqual(result.coverage, expectedCoverage)
        assert.deepEqual(entries[0]!.coverage, expectedCoverage)
      } finally {
        await service.dispose()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
