import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import * as generation from './generation-control'
import * as ask from './ask-prompt'
import * as globalAsk from './global-ask-prompt'
import * as mapReduce from './map-reduce'
import type { NotesEngine } from './types'

test('local adapter counts the actual wrapper/allocation, enforces reserve and disposes on budget rejection', async () => {
  let disposed = 0
  let generated = 0
  let counted = 0
  const tokenizer = (text: string) => Array.from(new TextEncoder().encode(text))
  class Session {
    readonly system: string
    constructor(options: { systemPrompt: string }) {
      this.system = options.systemPrompt
    }
    getChatHistory() {
      return [{ type: 'system', text: this.system }]
    }
    chatWrapper = {
      generateContextState: ({
        chatHistory
      }: {
        chatHistory: Array<{ type: string; text?: string }>
      }) => {
        assert.deepEqual(
          Array.from(chatHistory, (item) => item.type),
          ['system', 'user', 'model']
        )
        const serialized =
          chatHistory.map((item) => `<${item.type}>${item.text ?? ''}`).join('') +
          'wrapper'.repeat(100)
        return {
          contextText: {
            tokenize: (counter: typeof tokenizer) => {
              assert.equal(counter, tokenizer)
              counted++
              return counter(serialized)
            }
          }
        }
      }
    }
    async promptWithMeta(user: string, options: { maxTokens: number; signal: AbortSignal }) {
      generated++
      assert.equal(options.maxTokens, 4096)
      assert.equal(options.signal.aborted, false)
      const tokens = this.chatWrapper
        .generateContextState({
          chatHistory: [...this.getChatHistory(), { type: 'user', text: user }, { type: 'model' }]
        })
        .contextText.tokenize(tokenizer).length
      assert.ok(tokens + options.maxTokens + 256 <= 8192)
      return { responseText: 'Synthetic answer', stopReason: 'eogToken' }
    }
  }
  const deps: Record<string, unknown> = {
    'node:os': os,
    'node:path': path,
    './generation-control': generation,
    './ask-prompt': ask,
    './global-ask-prompt': globalAsk,
    './map-reduce': mapReduce,
    'node-llama-cpp': {
      getLlama: async () => ({
        loadModel: async () => ({
          tokenizer,
          createContext: async () => ({
            contextSize: 8192,
            getSequence: () => ({}),
            dispose: async () => {
              disposed++
            }
          })
        })
      }),
      LlamaChatSession: Session
    }
  }
  const exports: Record<string, new (options: unknown) => NotesEngine> = {}
  const source = ts.transpileModule(readFileSync('src/local-engine.ts', 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  }).outputText
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.ok(name in deps, `unexpected dependency ${name}`)
      return deps[name]
    },
    console,
    Date
  })
  const engine = new exports.LocalNotesEngine!({
    modelUri: 'fixture',
    modelPath: '/synthetic/fixture.gguf',
    contextSize: 16384
  })
  const input = {
    meetings: [{ title: 'Fixture', dateIso: '', notesMarkdown: '界😀'.repeat(25_000) }],
    history: [],
    question: 'What next?'
  }
  const result = await engine.askAcrossMeetings(input)
  assert.equal(result.coverage?.contextWindowTokens, 8192, 'allocated context, not requested 16384')
  assert.equal(result.coverage?.accounting, 'model-tokenizer')
  assert.ok(counted > 1)
  assert.equal(disposed, 1)
  await assert.rejects(
    engine.askAcrossMeetings({ ...input, question: 'x'.repeat(25_000) }),
    /question is too long/
  )
  assert.equal(generated, 1, 'oversized question never reaches generation or another provider')
  assert.equal(disposed, 2, 'failed budget releases native context')
})
