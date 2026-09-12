import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatedModelLabel } from './generated-model-label'

test('generation labels preserve recorded models without guessing historical defaults', () => {
  assert.equal(generatedModelLabel('cloud:openai:gpt-5'), 'OpenAI · gpt-5')
  assert.equal(
    generatedModelLabel('cloud:openai:default'),
    'OpenAI · default model (exact version not recorded)'
  )
  assert.equal(generatedModelLabel('cloud:ollama:llama3.1:8b'), 'Ollama · llama3.1:8b')
  assert.equal(
    generatedModelLabel('local:hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M'),
    'On-device · Llama 3.1 8B'
  )
  assert.equal(generatedModelLabel(), 'an unrecorded model (older notes)')
})
