import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertRequestFits } from './bounded-request'
import { CloudNotesEngine } from './cloud-engine'
import { utf8TokenUpperBound } from './global-ask-prompt'

test('complete recipe request fits exact boundary and rejects Unicode overflow without truncation', () => {
  const budget = { contextWindowTokens: 100, outputReserveTokens: 20, safetyMarginTokens: 10, accounting: 'utf8-upper-bound' as const, countInputTokens: (s: string, u: string) => utf8TokenUpperBound(s + u) }
  assert.doesNotThrow(() => assertRequestFits('s'.repeat(10), '界'.repeat(20), budget))
  assert.throws(() => assertRequestFits('s'.repeat(11), '界'.repeat(20), budget), /exceed/)
  assert.throws(() => assertRequestFits('', '', { ...budget, contextWindowTokens: NaN }), /supported request budget/)
})

test('bounded hosted adapter rejects missing consent, unknown models and oversized full recipe before sending', async () => {
  const previous = globalThis.fetch; let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected transmission') }
  try {
    await assert.rejects(new CloudNotesEngine({ provider: 'grok', apiKey: 'fixture' }).runBounded('system', 'prompt'), /data-use requirements/)
    await assert.rejects(new CloudNotesEngine({ provider: 'grok', model: 'unknown', apiKey: 'fixture', dataPolicyConfirmed: true }).runBounded('system', 'prompt'), /verify the context limit/)
    await assert.rejects(new CloudNotesEngine({ provider: 'grok', apiKey: 'fixture', dataPolicyConfirmed: true }).runBounded('system', '界'.repeat(500_000)), /exceed/)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = previous }
})

test('bounded hosted wire retains exact prompt and output cap and propagates cancellation', async () => {
  const previous = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.max_tokens, 4096)
    assert.equal(body.messages[0].content, 'Synthetic system')
    assert.equal(body.messages[1].content, 'Synthetic prompt')
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: 'Output' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })
  }
  try {
    const engine = new CloudNotesEngine({ provider: 'grok', apiKey: 'fixture', dataPolicyConfirmed: true })
    assert.equal((await engine.runBounded('Synthetic system', 'Synthetic prompt')).markdown, 'Output')
    const controller = new AbortController(); controller.abort(new Error('Synthetic canceled'))
    await assert.rejects(engine.runBounded('Synthetic system', 'Synthetic prompt', { signal: controller.signal }), /canceled/)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = previous }
})
