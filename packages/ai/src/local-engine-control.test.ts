import * as boundedRequest from './bounded-request'
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

/** A short request can ask for a small context, a token cap and a temperature. */
function engineWith(record: {
  contexts: number[]
  prompts: Array<{ maxTokens: number; temperature: number }>
}): NotesEngine {
  const tokenizer = (text: string): number[] => Array.from(new TextEncoder().encode(text))
  class Session {
    dispose() {}
    constructor(private readonly options: { systemPrompt: string }) {}
    getChatHistory() {
      return [{ type: 'system', text: this.options.systemPrompt }]
    }
    chatWrapper = {
      generateContextState: ({ chatHistory }: { chatHistory: Array<{ text?: string }> }) => ({
        contextText: {
          tokenize: (counter: typeof tokenizer) =>
            counter(chatHistory.map((item) => item.text ?? '').join(''))
        }
      })
    }
    async promptWithMeta(_user: string, options: { maxTokens: number; temperature: number }) {
      record.prompts.push({ maxTokens: options.maxTokens, temperature: options.temperature })
      return { responseText: 'Tidy.', stopReason: 'eogToken' }
    }
  }
  const deps: Record<string, unknown> = {
    './bounded-request': boundedRequest,
    'node:os': os,
    'node:path': path,
    './generation-control': generation,
    './ask-prompt': ask,
    './global-ask-prompt': globalAsk,
    './map-reduce': mapReduce,
    'node-llama-cpp': {
      resolveChatWrapper: () => ({
        ...new Session({ systemPrompt: '' } as never).chatWrapper,
        generateInitialChatHistory: ({ systemPrompt }: { systemPrompt: string }) => [
          { type: 'system', text: systemPrompt }
        ]
      }),
      getLlama: async () => ({
        loadModel: async () => ({
          tokenizer,
          createContext: async ({ contextSize }: { contextSize: number }) => {
            record.contexts.push(contextSize)
            return { contextSize, getSequence: () => ({}), dispose: async () => {} }
          }
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
    setTimeout,
    clearTimeout,
    console,
    Date
  })
  return new exports.LocalNotesEngine!({ modelUri: 'fixture', modelPath: '/synthetic/f.gguf' })
}

test('a short request gets the small context, token cap and temperature it asked for', async () => {
  const record = {
    contexts: [] as number[],
    prompts: [] as Array<{ maxTokens: number; temperature: number }>
  }
  const engine = engineWith(record)
  await engine.runBounded!('Tidy this.', 'um so hello there', {
    contextSize: 1024,
    maxTokens: 256,
    temperature: 0.1
  })
  assert.deepEqual(record.contexts, [1024])
  assert.deepEqual(record.prompts, [{ maxTokens: 256, temperature: 0.1 }])
})

test('without those options the output cap is unchanged and the short request uses 8K', async () => {
  const record = {
    contexts: [] as number[],
    prompts: [] as Array<{ maxTokens: number; temperature: number }>
  }
  const engine = engineWith(record)
  await engine.runBounded!('Tidy this.', 'hello')
  assert.deepEqual(record.contexts, [8192])
  assert.deepEqual(record.prompts, [{ maxTokens: 4096, temperature: 0.3 }])
})

test('a request too big for the small context is refused before any generation', async () => {
  const record = {
    contexts: [] as number[],
    prompts: [] as Array<{ maxTokens: number; temperature: number }>
  }
  const engine = engineWith(record)
  await assert.rejects(
    engine.runBounded!('Tidy this.', 'x'.repeat(2000), { contextSize: 1024, maxTokens: 256 }),
    /exceed/
  )
  assert.equal(record.prompts.length, 0)
})
