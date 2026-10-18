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
import type { GenerationControl, MergedNotes, NotesEngine } from './types'

// Import the installed class re-exported by node-llama-cpp, without evaluating
// its native/runtime entry point. No native selection or model access in tests.
const entry = import.meta.resolve('node-llama-cpp')
assert.match(
  readFileSync(new URL(entry), 'utf8'),
  /import \{ NoBinaryFoundError \} from "\.\/bindings\/utils\/NoBinaryFoundError.js"/
)
const { NoBinaryFoundError } = (await import(
  new URL('./bindings/utils/NoBinaryFoundError.js', entry).href
)) as { NoBinaryFoundError: typeof import('node-llama-cpp').NoBinaryFoundError }

type Compute = 'default' | 'cpu'
interface TestEngine extends NotesEngine {
  forceCpu: boolean
  model: unknown
  llama: unknown
  runRaw(
    system: string,
    prompt: string,
    onToken?: (text: string) => void,
    control?: GenerationControl
  ): Promise<MergedNotes>
  dispose(): Promise<void>
}
function fixture(
  options: {
    select?: (compute: Compute) => Promise<void>
    loadError?: Partial<Record<Compute, Error>>
    contextError?: Partial<Record<Compute, Error>>
    deadlineMs?: number
  } = {}
): {
  engine: TestEngine
  selected: Compute[]
  loaded: Compute[]
  disposed: Compute[]
  contextsDisposed: Compute[]
  tokens: string[]
  run: (signal?: AbortSignal) => Promise<{ markdown: string }>
} {
  const selected: Compute[] = []
  const loaded: Compute[] = []
  const disposed: Compute[] = []
  const contextsDisposed: Compute[] = []
  const tokens: string[] = []
  const deps: Record<string, unknown> = {
    './bounded-request': bounded,
    'node:os': os,
    'node:path': path,
    './generation-control': {
      ...generation,
      withGenerationDeadline: (
        parent: AbortSignal | undefined,
        phase: generation.GenerationPhase,
        work: (signal: AbortSignal) => Promise<unknown>
      ) => generation.withGenerationDeadline(parent, phase, work, options.deadlineMs)
    },
    './ask-prompt': ask,
    './global-ask-prompt': globalAsk,
    './map-reduce': mapReduce,
    'node-llama-cpp': {
      NoBinaryFoundError,
      resolveModelFile: () => assert.fail('verified local path must not resolve/download a model'),
      getLlama: async (settings: { gpu?: false; build: string }) => {
        assert.equal(settings.build, 'never')
        const compute = settings.gpu === false ? 'cpu' : 'default'
        selected.push(compute)
        await options.select?.(compute)
        return {
          loadModel: async ({
            modelPath,
            loadSignal
          }: {
            modelPath: string
            loadSignal: AbortSignal
          }) => {
            assert.equal(modelPath, '/synthetic/verified.gguf')
            assert.equal(loadSignal.aborted, false)
            loaded.push(compute)
            if (options.loadError?.[compute]) throw options.loadError[compute]
            return {
              dispose: async () => {
                disposed.push(compute)
              },
              createContext: async () => {
                if (options.contextError?.[compute]) throw options.contextError[compute]
                return {
                  getSequence: () => ({}),
                  dispose: async () => {
                    contextsDisposed.push(compute)
                  }
                }
              }
            }
          }
        }
      },
      LlamaChatSession: class {
        async promptWithMeta(
          _prompt: string,
          settings: { onTextChunk: (text: string) => void }
        ): Promise<{ responseText: string; stopReason: string }> {
          settings.onTextChunk('Synthetic answer')
          return { responseText: 'Synthetic answer', stopReason: 'eogToken' }
        }
      }
    }
  }
  const exports: Record<string, new (options: unknown) => TestEngine> = {}
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
      Error,
      AggregateError,
      console: { error: () => {} },
      Date
    }
  )
  const engine = new exports.LocalNotesEngine!({
    modelUri: 'fixture',
    modelPath: '/synthetic/verified.gguf'
  })
  return {
    engine,
    selected,
    loaded,
    disposed,
    contextsDisposed,
    tokens,
    run: (signal) => engine.runRaw('system', 'prompt', (token) => tokens.push(token), { signal })
  }
}
function causes(error: unknown): unknown[] {
  return [
    error,
    ...(error instanceof AggregateError ? error.errors.flatMap(causes) : []),
    ...(error instanceof Error && error.cause ? causes(error.cause) : [])
  ]
}
async function failure(work: Promise<unknown>): Promise<Error> {
  try {
    await work
  } catch (error) {
    assert.ok(error instanceof Error)
    return error
  }
  return assert.fail('expected rejection, not an answer')
}
function unavailable(error: Error): void {
  assert.match(error.message, /Local inference is unavailable/)
  assert.match(error.message, /CPU-only runtime/)
  assert.match(error.message, /Restart DoodleNote/)
  assert.doesNotMatch(
    error.message,
    /re-download|GPU memory|NoBinaryFoundError|synthetic private reason/i
  )
}

test('uses the actual exported NoBinaryFoundError class, whose name is Error', () => {
  const error = new NoBinaryFoundError()
  assert.equal(error.name, 'Error')
  assert.equal(error.message, 'NoBinaryFoundError')
  assert.equal(error.constructor.name, 'NoBinaryFoundError')
})

for (const stage of ['load', 'context'] as const) {
  test(`default ${stage} failure then missing CPU runtime preserves both causes and cleans up`, async () => {
    const original = new Error('synthetic private reason')
    const missing = new NoBinaryFoundError()
    const f = fixture({
      [stage === 'load' ? 'loadError' : 'contextError']: { default: original },
      select: async (compute) => {
        if (compute === 'cpu') throw missing
      }
    })
    const error = await failure(f.run())
    unavailable(error)
    assert.match(error.message, /default compute attempt failed/i)
    assert.ok(causes(error).includes(original))
    assert.ok(causes(error).includes(missing))
    assert.deepEqual(f.selected, ['default', 'cpu'])
    assert.deepEqual(f.loaded, ['default'], 'CPU selector failure never loads a model')
    assert.deepEqual(f.disposed, stage === 'context' ? ['default'] : [])
    assert.equal(f.engine.model, null)
    assert.equal(f.engine.llama, null)
    assert.deepEqual(f.tokens, [])
    const retry = await failure(f.run())
    unavailable(retry)
    assert.doesNotMatch(retry.message, /attempt failed|tried GPU/i)
    assert.ok(
      !causes(retry).includes(original),
      'do not present an earlier invocation as a new attempt'
    )
    assert.deepEqual(f.selected, ['default', 'cpu', 'cpu'])
    await f.engine.dispose()
  })
  test(`nonmatching CPU selection error after default ${stage} failure retains diagnostics without a missing-runtime claim`, async () => {
    const original = new Error('synthetic private reason')
    const selectionError = new Error('another private runtime reason')
    const f = fixture({
      [stage === 'load' ? 'loadError' : 'contextError']: { default: original },
      select: async (compute) => {
        if (compute === 'cpu') throw selectionError
      }
    })
    const error = await failure(f.run())
    assert.match(error.message, /runtime could not be initialized/)
    assert.doesNotMatch(error.message, /unavailable|No usable|re-download|private/i)
    assert.ok(causes(error).includes(original))
    assert.ok(causes(error).includes(selectionError))
    assert.deepEqual(f.loaded, ['default'])
    assert.deepEqual(f.tokens, [])
    await f.engine.dispose()
  })
  test(`existing CPU fallback succeeds after default ${stage} failure`, async () => {
    const f = fixture({
      [stage === 'load' ? 'loadError' : 'contextError']: { default: new Error('default failed') }
    })
    assert.equal((await f.run()).markdown, 'Synthetic answer')
    assert.deepEqual(f.selected, ['default', 'cpu'])
    assert.deepEqual(f.tokens, ['Synthetic answer'])
    assert.deepEqual(f.contextsDisposed, ['cpu'])
    await f.engine.dispose()
    assert.deepEqual(f.disposed, stage === 'context' ? ['default', 'cpu'] : ['cpu'])
  })
}

test('direct CPU selection failure never claims a GPU attempt', async () => {
  const missing = new NoBinaryFoundError()
  const f = fixture({
    select: async () => {
      throw missing
    }
  })
  f.engine.forceCpu = true
  const error = await failure(f.run())
  unavailable(error)
  assert.doesNotMatch(error.message, /attempt failed|tried GPU/i)
  assert.ok(causes(error).includes(missing))
  assert.deepEqual(f.selected, ['cpu'])
  assert.deepEqual(f.loaded, [])
  assert.deepEqual(f.tokens, [])
})

test('missing default runtime still attempts CPU and preserves selection causes', async () => {
  const missing = new NoBinaryFoundError()
  const f = fixture({
    select: async () => {
      throw missing
    }
  })
  const error = await failure(f.run())
  unavailable(error)
  assert.ok(causes(error).includes(missing))
  assert.deepEqual(f.selected, ['default', 'cpu'])
  assert.deepEqual(f.loaded, [])
})

for (const stage of ['selection', 'load', 'context'] as const) {
  test(`does not classify nonmatching ${stage} errors as missing runtime`, async () => {
    const error =
      stage === 'selection'
        ? Object.assign(new Error('NoBinaryFoundError'), { name: 'NoBinaryFoundError' })
        : new NoBinaryFoundError()
    const f = fixture({
      ...(stage === 'selection'
        ? {
            select: async () => {
              throw error
            }
          }
        : { [stage === 'load' ? 'loadError' : 'contextError']: { cpu: error } })
    })
    f.engine.forceCpu = true
    const caught = await failure(f.run())
    assert.doesNotMatch(caught.message, /Local inference is unavailable|CPU-only runtime|tried GPU/)
    if (stage === 'selection')
      assert.equal(caught, error, 'name/message spoof is not the exported class')
    assert.deepEqual(f.tokens, [])
    await f.engine.dispose()
  })
}

for (const stage of ['load', 'context'] as const) {
  for (const stop of ['canceled', 'timeout'] as const) {
    test(`${stop} wins over CPU selection failure after default ${stage} failure`, async () => {
      const controller = new AbortController()
      let selectorFinished = false
      const f = fixture({
        [stage === 'load' ? 'loadError' : 'contextError']: { default: new Error('default failed') },
        deadlineMs: stop === 'timeout' ? 5 : undefined,
        select: async (compute) => {
          if (compute !== 'cpu') return
          if (stop === 'canceled')
            controller.abort(new generation.GenerationError('canceled', 'Canceled'))
          else await new Promise((resolve) => setTimeout(resolve, 20))
          selectorFinished = true
          throw new NoBinaryFoundError()
        }
      })
      const error = await failure(f.run(controller.signal))
      assert.ok(error instanceof generation.GenerationError)
      assert.equal(error.code, stop)
      assert.equal(selectorFinished, true, 'waits for pending acquisition before rejecting')
      assert.equal(f.engine.model, null)
      assert.equal(f.engine.llama, null)
      assert.deepEqual(f.tokens, [])
      assert.deepEqual(f.loaded, ['default'])
      assert.deepEqual(f.disposed, stage === 'context' ? ['default'] : [])
      await f.engine.dispose()
    })
  }
}
