import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function estimator(metadata: Record<string, unknown>, modelBytes = 2_490_000_000) {
  const exports: {
    estimateNotesWarmupBytes?: (path: string, context: number) => Promise<number | null>
  } = {}
  runInNewContext(
    ts.transpileModule(readFileSync('src/local-memory.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      require: (name: string) => {
        if (name === 'node:fs/promises') return { stat: async () => ({ size: modelBytes }) }
        assert.equal(name, './local-engine')
        return {
          loadNodeLlamaCpp: async () => ({
            readGgufFileInfo: async () => ({
              metadata: { general: { architecture: 'qwen3' } },
              architectureMetadata: metadata
            })
          })
        }
      }
    }
  )
  return exports.estimateNotesWarmupBytes!
}

test('Qwen3-4B f16 KV uses metadata head dimensions, file bytes and 1GiB headroom', async () => {
  const estimate = estimator({
    block_count: 36,
    embedding_length: 2560,
    attention: { head_count: 32, head_count_kv: 8, key_length: 128, value_length: 128 }
  })
  assert.equal(await estimate('synthetic', 8192), 2_490_000_000 + 144 * 1024 * 8192 + 1024 ** 3)
  assert.equal(await estimate('synthetic', 16384), 2_490_000_000 + 144 * 1024 * 16384 + 1024 ** 3)
})

test('metadata fallback derives equal head dimensions without optimistic missing-architecture guesses', async () => {
  const estimate = estimator(
    { block_count: 32, embedding_length: 4096, attention: { head_count: 32, head_count_kv: 8 } },
    100
  )
  assert.equal(await estimate('synthetic', 4096), 100 + 2 * 32 * 8 * 256 * 4096 + 1024 ** 3)
  assert.equal(await estimator({})('synthetic', 8192), null)
  assert.equal(
    await estimator({
      block_count: 36,
      embedding_length: 2560,
      attention: { head_count: 0, head_count_kv: 8 }
    })('synthetic', 8192),
    null
  )
})
