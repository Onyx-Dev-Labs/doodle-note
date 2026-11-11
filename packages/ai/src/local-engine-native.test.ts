import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalNotesEngine, WARM_PREFILL_BATCH_TOKENS } from './local-engine'
import type { LlamaContextSequence, Token } from 'node-llama-cpp'
import type { NotesDiagnostic } from './notes-log'

// Opt-in real GGUF regression, with no download and no application profile.
// CPU native evaluation exercises the identical JS cancellation/alignment path.
// Only the GPU eligibility properties are injected to enter speculative prefill.
const modelPath = process.env.DOODLENOTE_TEST_GGUF

test(
  'real library: bounded cancellation, exact prefix reuse and context fallback',
  {
    skip: !modelPath && 'Set DOODLENOTE_TEST_GGUF to a small existing GGUF',
    timeout: 120_000
  },
  async (t) => {
    const { getLlama } = await import('node-llama-cpp')
    const llama = await getLlama({ gpu: false, build: 'never' })
    t.after(() => llama.dispose())
    const system = 'These are fixed system rules for a synthetic meeting. '.repeat(80)

    async function fixture(failContext = false) {
      const model = await llama.loadModel({ modelPath: modelPath! })
      const events: NotesDiagnostic[] = []
      const engine = new LocalNotesEngine({
        modelUri: 'test',
        modelPath,
        contextSize: 4096,
        onDiagnostic: (event) => events.push(event)
      })
      const state = engine as unknown as {
        llama: typeof llama
        model: typeof model
        sequence: LlamaContextSequence
      }
      let contextCalls = 0
      let batchCalls = 0
      let evaluated = 0
      let batchFinishedAt = 0
      let onBatch: (() => void) | undefined
      let onAlign: ((tokens: Token[]) => void) | undefined
      state.llama = new Proxy(llama, {
        get(target, key) {
          return key === 'gpu' ? 'vulkan' : Reflect.get(target, key)
        }
      })
      state.model = new Proxy(model, {
        get(target, key) {
          if (key === 'gpuLayers') return 1
          if (key === 'createContext')
            return async (options: Parameters<typeof model.createContext>[0]) => {
              assert.ok(options?.createSignal, 'context creation receives cancellation')
              contextCalls++
              if (failContext) throw new Error('injected first GPU context failure')
              const context = await target.createContext({
                ...options,
                threads: 2
              })
              const getSequence = context.getSequence.bind(context)
              context.getSequence = (...args) => {
                const sequence = getSequence(...args)
                const evaluate = sequence.evaluateWithoutGeneratingNewTokens.bind(sequence)
                sequence.evaluateWithoutGeneratingNewTokens = async (tokens, options) => {
                  batchCalls++
                  assert.ok(tokens.length <= WARM_PREFILL_BATCH_TOKENS)
                  onBatch?.()
                  await evaluate(tokens, options)
                  evaluated += tokens.length
                  batchFinishedAt = performance.now()
                }
                const adapt = sequence.adaptStateToTokens.bind(sequence)
                sequence.adaptStateToTokens = async (tokens, allowShift) => {
                  onAlign?.(tokens)
                  return adapt(tokens, allowShift)
                }
                return sequence
              }
              return context
            }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      t.after(() => engine.dispose())
      return {
        engine,
        events,
        state,
        onBatch: (fn: () => void) => {
          onBatch = fn
        },
        onAlign: (fn: (tokens: Token[]) => void) => {
          onAlign = fn
        },
        metrics: () => ({
          contextCalls,
          batchCalls,
          evaluated,
          batchFinishedAt
        })
      }
    }

    await t.test(
      'aborted warm-up releases a queued foreground operation after one native batch',
      async () => {
        const f = await fixture()
        const abort = new AbortController()
        let foreground: Promise<void> | undefined
        let abortedAt = 0
        f.onBatch(() => {
          abortedAt = performance.now()
          abort.abort(new Error('native batch cancellation'))
          foreground = assert.rejects(
            f.engine.runRaw('Tell a story.', 'Once upon a time', undefined, {
              maxTokens: 1
            }),
            /token|limit|budget/i
          )
        })
        await assert.rejects(f.engine.warm(system, abort.signal), /native batch cancellation/)
        assert.ok(foreground)
        await foreground
        assert.ok(f.events.some((e) => e.event === 'generation' && e.generatedTokens! > 0))
        const metrics = f.metrics()
        assert.equal(metrics.batchCalls, 1)
        assert.equal(metrics.evaluated, WARM_PREFILL_BATCH_TOKENS)
        assert.ok(
          performance.now() - metrics.batchFinishedAt < 3000,
          'waiter resumes after settled batch'
        )
        console.log(
          JSON.stringify({
            event: 'native-cancel',
            ...metrics,
            cancelMs: performance.now() - abortedAt
          })
        )
      }
    )

    await t.test('re-warm retains the settled prefix after bounded cancellation', async () => {
      const f = await fixture()
      const abort = new AbortController()
      f.onBatch(() => abort.abort(new Error('roster changed')))
      await assert.rejects(f.engine.warm(system, abort.signal), /roster changed/)
      assert.equal(f.state.sequence?.nextTokenIndex, WARM_PREFILL_BATCH_TOKENS)
      f.onBatch(() => {})
      await f.engine.warm(`${system} A newly observed speaker.`)
      const prefill = f.events.filter((e) => e.event === 'prefill' && e.reason === 'start').at(-1)!
      assert.equal(prefill.skippedTokens, WARM_PREFILL_BATCH_TOKENS)
      assert.equal(f.metrics().contextCalls, 1)
    })

    await t.test(
      'native warm evaluation failure discards context even if cancellation also arrives',
      async () => {
        const f = await fixture()
        const abort = new AbortController()
        f.onBatch(() => {
          abort.abort(new Error('roster changed'))
          throw new Error('injected native evaluation failure')
        })
        await assert.rejects(f.engine.warm(system, abort.signal))
        assert.equal(f.state.sequence, null)
      }
    )

    await t.test(
      'runRaw reuses every warmed prefix token with real chat rendering and native evaluation',
      async () => {
        const f = await fixture()
        await f.engine.warm(system)
        const warmed = [...f.state.sequence.contextTokens]
        assert.ok(warmed.length > WARM_PREFILL_BATCH_TOKENS * 4)
        let aligned = false
        f.onAlign((tokens) => {
          assert.deepEqual(tokens.slice(0, warmed.length), warmed)
          assert.equal(
            f.state.sequence.compareContextTokens(tokens).firstDifferentIndex,
            warmed.length
          )
          aligned = true
        })
        // A tiny story model is not a notes model. A one-token budget deliberately
        // ends with the engine's output-budget error, after real native generation.
        await assert.rejects(
          f.engine.runRaw(system, 'Once upon a time', undefined, {
            maxTokens: 1
          }),
          /token|limit|budget/i
        )
        assert.ok(aligned)
        assert.ok(f.events.some((e) => e.event === 'prefill' && e.skippedTokens === warmed.length))
        console.log(
          JSON.stringify({
            event: 'native-prefix',
            reusedTokens: warmed.length
          })
        )
      }
    )

    await t.test(
      'failed GPU context falls back to real CPU without speculative evaluation',
      async () => {
        const f = await fixture(true)
        await f.engine.warm(system)
        assert.equal(f.metrics().contextCalls, 1)
        assert.equal(f.metrics().batchCalls, 0)
        assert.equal(f.state.sequence.nextTokenIndex, 0)
        assert.ok(f.events.some((e) => e.event === 'warmup' && e.reason === 'cpu-prefill'))
        await assert.rejects(
          f.engine.runRaw('Tell a story.', 'Once upon a time', undefined, {
            maxTokens: 1
          }),
          /token|limit|budget/i
        )
        assert.ok(f.events.some((e) => e.event === 'generation' && e.generatedTokens! > 0))
      }
    )
  }
)
