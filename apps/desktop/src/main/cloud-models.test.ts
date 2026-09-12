import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchCloudModels } from './cloud-models'

test('OpenAI catalog uses saved-key auth, rejects redirects, and excludes non-text models', async () => {
  const result = await fetchCloudModels('openai', 'fixture-key', async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/models')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-key')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.body, undefined)
    return Response.json({
      data: [
        { id: 'gpt-5' },
        { id: 'gpt-5' },
        { id: 'text-embedding-3-large' },
        { id: 'gpt-image-1' },
        { id: 'gpt-audio' },
        { id: 'o3' }
      ]
    })
  })
  assert.deepEqual(
    result.models.map((model) => model.id),
    ['gpt-5', 'o3']
  )
})

test('Gemini follows page tokens on the same endpoint and only offers text generation models', async () => {
  let count = 0
  const result = await fetchCloudModels('gemini', 'fixture-key', async (url, init) => {
    count++
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fixture-key')
    assert.ok(!String(url).includes('fixture-key'))
    if (count === 1)
      return Response.json({
        models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }],
        nextPageToken: 'page-two'
      })
    assert.equal(new URL(String(url)).searchParams.get('pageToken'), 'page-two')
    return Response.json({
      models: [
        {
          name: 'models/gemini-flash',
          displayName: 'Flash',
          supportedGenerationMethods: ['generateContent']
        }
      ]
    })
  })
  assert.equal(count, 2)
  assert.deepEqual(result.models, [{ id: 'gemini-flash', label: 'Flash' }])
})

test('Anthropic pagination and Grok language-model catalog have provider-specific shapes', async () => {
  let count = 0
  const anthropic = await fetchCloudModels('anthropic', 'fixture', async (url, init) => {
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'fixture')
    count++
    if (count === 1)
      return Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' })
    assert.equal(new URL(String(url)).searchParams.get('after_id'), 'claude-a')
    return Response.json({ data: [{ id: 'claude-b' }], has_more: false })
  })
  assert.equal(anthropic.models.length, 2)
  const grok = await fetchCloudModels('grok', 'fixture', async (url) => {
    assert.equal(String(url), 'https://api.x.ai/v1/language-models')
    return Response.json({ models: [{ id: 'grok-4.6' }] })
  })
  assert.equal(grok.models[0]?.id, 'grok-4.6')
})

test('catalog failures never expose provider response bodies or thrown secrets', async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await fetchCloudModels(
      'openai',
      'secret-fixture',
      async () => new Response('secret-fixture', { status })
    )
    assert.ok(result.error)
    assert.ok(!result.error.includes('secret-fixture'))
  }
  const failed = await fetchCloudModels('openai', 'secret-fixture', async () => {
    throw new Error('secret-fixture')
  })
  assert.ok(!failed.error?.includes('secret-fixture'))
  let calls = 0
  const never: typeof fetch = async () => {
    calls++
    throw new Error('unexpected')
  }
  await fetchCloudModels('openai', '', never)
  await fetchCloudModels('openrouter', 'fixture', never)
  assert.equal(calls, 0)
})
