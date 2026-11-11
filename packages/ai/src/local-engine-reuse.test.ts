import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as bounded from './bounded-request'
import * as generation from './generation-control'
import * as ask from './ask-prompt'
import * as globalAsk from './global-ask-prompt'
import * as mapReduce from './map-reduce'
import type { LocalNotesEngine } from './local-engine'

// Real pinned token alignment, with only native evaluation/erasure replaced.
const entry = import.meta.resolve('node-llama-cpp')
const { LlamaContextSequence } = await import(
  new URL('./evaluator/LlamaContext/LlamaContext.js', entry).href
)
const chatSource = readFileSync(new URL('./evaluator/LlamaChat/LlamaChat.js', entry), 'utf8')
assert.ok(
  chatSource.includes('await this.llamaChat.sequence.adaptStateToTokens(this.tokens, false)')
)

function fixture(idleTimeoutMs = 600_000) {
  const record = {
    loads: 0,
    contexts: [] as number[],
    disposed: 0,
    modelsDisposed: 0,
    skipped: [] as number[],
    states: [] as string[],
    histories: [] as string[][]
  }
  let gate: Promise<void> | undefined
  let fail = false
  class Sequence {
    _contextTokens: number[] = []
    _loadedTokenPredictions: number[] = []
    get _nextTokenIndex() {
      return this._contextTokens.length
    }
    get nextTokenIndex() {
      return this._contextTokens.length
    }
    model = { fileInsights: { isRecurrent: false }, fileInfo: { metadata: {} } }
    compareContextTokens = LlamaContextSequence.prototype.compareContextTokens
    adaptStateToTokens = LlamaContextSequence.prototype.adaptStateToTokens
    async _eraseContextTokenRanges(ranges: Array<{ start: number; end: number }>) {
      for (const { start, end } of ranges) this._contextTokens.splice(start, end - start)
    }
  }
  class Session {
    history: string[]
    constructor(private options: { contextSequence: Sequence; systemPrompt: string }) {
      this.history = [options.systemPrompt]
    }
    dispose(options: { disposeSequence: boolean }) {
      assert.equal(options.disposeSequence, false)
    }
    async promptWithMeta(user: string, options: { signal: AbortSignal }) {
      record.histories.push([...this.history])
      const tokens = [...Buffer.from(`${this.history[0]}\n<user>${user}\n<assistant>`)]
      const sequence = this.options.contextSequence
      await sequence.adaptStateToTokens(tokens.slice(0, -1), false)
      record.skipped.push(sequence.nextTokenIndex)
      sequence._contextTokens.push(...tokens.slice(sequence.nextTokenIndex))
      await gate
      options.signal.throwIfAborted()
      if (fail) throw new Error('synthetic evaluation failure')
      const state = Buffer.from(sequence._contextTokens).toString()
      record.states.push(state)
      this.history.push(user, 'response')
      sequence._contextTokens.push(...Buffer.from('previous answer'))
      return { responseText: state, stopReason: 'eogToken' }
    }
  }
  const deps: Record<string, unknown> = {
    './bounded-request': bounded,
    './generation-control': generation,
    './ask-prompt': ask,
    './global-ask-prompt': globalAsk,
    './map-reduce': mapReduce,
    'node:os': os,
    'node:path': path,
    'node-llama-cpp': {
      LlamaChatSession: Session,
      getLlama: async () => ({
        loadModel: async () => {
          record.loads++
          return {
            dispose: async () => {
              record.modelsDisposed++
            },
            createContext: async ({ contextSize }: { contextSize: number }) => {
              record.contexts.push(contextSize)
              const sequence = new Sequence()
              return {
                contextSize,
                getSequence: () => sequence,
                dispose: async () => {
                  record.disposed++
                }
              }
            }
          }
        }
      })
    }
  }
  const exports: { LocalNotesEngine?: typeof LocalNotesEngine } = {}
  runInNewContext(
    ts.transpileModule(readFileSync('src/local-engine.ts', 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in deps, name)
        return deps[name]
      },
      console,
      Date,
      setTimeout,
      clearTimeout
    }
  )
  return {
    engine: new exports.LocalNotesEngine!({
      modelUri: 'fixture',
      modelPath: '/synthetic.gguf',
      idleTimeoutMs
    }),
    record,
    block: (promise?: Promise<void>) => {
      gate = promise
    },
    fail: () => {
      fail = true
    }
  }
}

test('second request matches fresh output/token state with no earlier transcript or answer', async () => {
  const reused = fixture(),
    fresh = fixture()
  await reused.engine.runRaw('Shared system rules', 'SECRET first meeting')
  const second = await reused.engine.runRaw('Shared system rules', 'Unrelated second meeting')
  const baseline = await fresh.engine.runRaw('Shared system rules', 'Unrelated second meeting')
  assert.equal(second.markdown, baseline.markdown)
  assert.equal(reused.record.states[1], fresh.record.states[0])
  assert.doesNotMatch(second.markdown, /SECRET|previous answer/)
  assert.ok(reused.record.skipped[1]! >= 'Shared system rules'.length)
  assert.equal(reused.record.contexts.length, 1)
  assert.deepEqual(reused.record.histories, [['Shared system rules'], ['Shared system rules']])
  await reused.engine.runRaw('Changed system', 'Third meeting')
  assert.equal(reused.record.skipped[2], 0)
  await Promise.all([reused.engine.dispose(), fresh.engine.dispose()])
  assert.equal(reused.record.disposed, 1)
})

test('context size change releases the old context; failed evaluation releases partial state', async () => {
  const f = fixture()
  await f.engine.runRaw('rules', 'first')
  await f.engine.runRaw('rules', 'second', undefined, { contextSize: 4096 })
  assert.deepEqual(f.record.contexts, [16384, 4096])
  assert.equal(f.record.disposed, 1)
  f.fail()
  await assert.rejects(
    f.engine.runRaw('rules', 'third', undefined, { contextSize: 4096 }),
    /failure/
  )
  assert.equal(f.record.disposed, 2)
  await f.engine.dispose()
})

test('overlapping calls and disposal wait for the active native operation; abort drops its context', async () => {
  const f = fixture()
  let release!: () => void
  f.block(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const abort = new AbortController()
  const first = f.engine.runRaw('rules', 'first', undefined, { signal: abort.signal })
  const rejected = assert.rejects(first, /cancel/)
  const second = f.engine.runRaw('rules', 'second')
  const disposal = f.engine.dispose()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(f.record.histories.length, 1)
  assert.equal(f.record.disposed, 0)
  abort.abort(new Error('canceled'))
  release()
  await rejected
  await second
  await disposal
  assert.equal(f.record.loads, 1)
  assert.equal(f.record.contexts.length, 2)
  assert.equal(f.record.disposed, 2)
  assert.equal(f.record.modelsDisposed, 1)
})

test('idle expiry frees model and context, but never interrupts active work', async () => {
  const f = fixture(10)
  await f.engine.runRaw('rules', 'first')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(f.record.disposed, 1)
  assert.equal(f.record.modelsDisposed, 1)
  await f.engine.runRaw('rules', 'second')
  assert.equal(f.record.loads, 2)
  await f.engine.dispose()
})
