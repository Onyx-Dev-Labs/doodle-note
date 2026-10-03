import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudReaderClient } from './cloud-reader-client'
test('desktop cloud reader confines token to fixed origin and never flattens selected versions', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = cloudReaderClient(
    () => ({ token: 'synthetic-token', enabled: true, baseUrl: 'https://fixture.example' }),
    async (input, init) => {
      calls.push({ url: String(input), init })
      return Response.json({ status: 'ok' })
    }
  )
  const action = {
    kind: 'choose',
    operationId: 'op',
    noteId: 'note',
    selectedRevision: 'revision',
    expectedRevision: 'head',
    expectedLifecycleGeneration: 'generation',
    libraryId: 'library'
  }
  await client({ kind: 'action', value: action })
  assert.equal(calls[0].url, 'https://fixture.example/api/sync/reader?')
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), action)
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    'Bearer synthetic-token'
  )
  assert.equal(calls[0].init?.redirect, 'error')
  assert.equal(calls[0].init?.cache, 'no-store')
  await assert.rejects(client({ kind: 'http', url: 'https://attacker.example' }), /Invalid/)
})
test('desktop reader blocks disabled sync and stale account responses with safe errors', async () => {
  const auth = { token: 'one', enabled: false, baseUrl: 'https://fixture.example' }
  let fetched = false
  const client = cloudReaderClient(
    () => auth,
    async () => {
      fetched = true
      auth.token = 'two'
      return Response.json({ private: 'content' })
    }
  )
  await assert.rejects(client({ kind: 'list' }), /enable Cloud Sync/)
  assert.equal(fetched, false)
  auth.enabled = true
  await assert.rejects(client({ kind: 'list' }), /Cloud notes unavailable/)
  const failed = cloudReaderClient(
    () => auth,
    async () => {
      throw new Error('secret-provider-diagnostic')
    }
  )
  await assert.rejects(
    failed({ kind: 'list' }),
    (e) => e instanceof Error && !e.message.includes('secret')
  )
})
