import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remoteMcpEligibilityClient } from './remote-mcp-eligibility'

test('only an explicit successful server eligibility result grants visibility', async () => {
  const auth = {
    token: 'synthetic-device-token',
    baseUrl: 'https://notes.example.test',
    revision: 0
  }
  for (const body of [
    null,
    [],
    {},
    { entitled: true },
    { remoteMcpEligible: 'true' },
    { remoteMcpEligible: false }
  ]) {
    const check = remoteMcpEligibilityClient(
      () => auth,
      async () => Response.json(body)
    )
    assert.equal(await check(), false)
  }
  const check = remoteMcpEligibilityClient(
    () => auth,
    async (url, init) => {
      assert.equal(url, 'https://notes.example.test/api/sync/account')
      assert.equal(init?.method, 'GET')
      assert.equal(init?.cache, 'no-store')
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)
      assert.deepEqual(init?.headers, { Authorization: 'Bearer synthetic-device-token' })
      return Response.json({ remoteMcpEligible: true })
    }
  )
  assert.equal(await check(), true)
})

test('unlinked, failing, unauthorized, older-server and malformed responses fail closed', async () => {
  let requests = 0
  const disconnected = remoteMcpEligibilityClient(
    () => ({ token: null, baseUrl: 'https://notes.example.test', revision: 0 }),
    async () => {
      requests++
      return Response.json({ remoteMcpEligible: true })
    }
  )
  assert.equal(await disconnected(), false)
  assert.equal(requests, 0)
  const auth = (): { token: string; baseUrl: string; revision: number } => ({
    token: 'fixture',
    baseUrl: 'https://notes.example.test',
    revision: 0
  })
  for (const status of [401, 402, 403, 404, 503]) {
    assert.equal(
      await remoteMcpEligibilityClient(auth, async () =>
        Response.json({ remoteMcpEligible: true }, { status })
      )(),
      false
    )
  }
  assert.equal(
    await remoteMcpEligibilityClient(auth, async () => new Response('invalid json'))(),
    false
  )
  assert.equal(
    await remoteMcpEligibilityClient(auth, async () => {
      throw new Error('offline')
    })(),
    false
  )
})

test('responses for an old token, server or connection revision never grant visibility', async () => {
  for (const change of ['token', 'baseUrl', 'revision'] as const) {
    let auth = { token: 'first', baseUrl: 'https://notes.example.test', revision: 0 }
    let complete!: (response: Response) => void
    const check = remoteMcpEligibilityClient(
      () => auth,
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve
        })
    )
    const pending = check()
    auth = { ...auth, [change]: change === 'revision' ? 1 : 'second' }
    complete(Response.json({ remoteMcpEligible: true }))
    assert.equal(await pending, false)
  }
})

test('every check revalidates paid status and recovers after failure without cached grants', async () => {
  let response = Response.json({ remoteMcpEligible: true })
  const check = remoteMcpEligibilityClient(
    () => ({ token: 'fixture', baseUrl: 'https://notes.example.test', revision: 0 }),
    async () => response
  )
  assert.equal(await check(), true)
  response = new Response(null, { status: 503 })
  assert.equal(await check(), false)
  response = Response.json({ remoteMcpEligible: false })
  assert.equal(await check(), false)
  response = Response.json({ remoteMcpEligible: true })
  assert.equal(await check(), true)
})
