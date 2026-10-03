import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CloudNotesEngine, type CloudProviderId } from './cloud-engine'

const chatResponse = () =>
  Response.json({
    id: 'fixture',
    object: 'chat.completion',
    created: 1,
    model: 'fixture',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Synthetic notes' },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
  })

test('direct Gemini and Grok use their own endpoints and retain no aggregator routing', async () => {
  const previous = globalThis.fetch
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return chatResponse()
  }
  try {
    for (const [provider, endpoint, model] of [
      [
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        'gemini-3.8-flash'
      ],
      ['grok', 'https://api.x.ai/v1/chat/completions', 'grok-4.6']
    ] as const) {
      const engine = new CloudNotesEngine({
        provider,
        apiKey: 'test-only-fixture',
        dataPolicyConfirmed: true
      })
      assert.equal(
        (await engine.runRaw('system', 'synthetic calendar-derived title')).markdown,
        'Synthetic notes'
      )
      const call = calls.at(-1)!
      assert.equal(call.url, endpoint)
      assert.equal(call.body.model, model)
      assert.equal(call.body.provider, undefined)
    }
  } finally {
    globalThis.fetch = previous
  }
})

test('all hosted providers fail before transmitting without data policy confirmation', async () => {
  const previous = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    throw new Error('unexpected network request')
  }
  try {
    for (const provider of ['gemini', 'grok', 'openai', 'anthropic'] as const) {
      await assert.rejects(
        new CloudNotesEngine({ provider, apiKey: 'fixture' }).runRaw('system', 'fixture'),
        /Confirm the AI data-use/
      )
    }
    for (const provider of ['groq', 'openrouter']) {
      assert.throws(
        () =>
          new CloudNotesEngine({
            provider: provider as CloudProviderId,
            apiKey: 'old-provider-fixture',
            dataPolicyConfirmed: true
          }),
        /retired/
      )
    }
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = previous
  }
})

test('OpenAI disables response storage without claiming account-wide ZDR', async () => {
  const previous = globalThis.fetch
  let body: Record<string, unknown> | undefined
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return Response.json(
      {
        error: {
          message: 'Synthetic rejection',
          type: 'invalid_request_error'
        }
      },
      { status: 400 }
    )
  }
  try {
    await assert.rejects(
      new CloudNotesEngine({
        provider: 'openai',
        apiKey: 'fixture',
        dataPolicyConfirmed: true
      }).runRaw('system', 'fixture')
    )
    assert.equal(body?.store, false)
  } finally {
    globalThis.fetch = previous
  }
})
