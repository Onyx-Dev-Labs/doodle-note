import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from 'node:http'
import { DeviceLinkAttempt } from './device-link-attempt'

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
function callback(
  browserUrl: string,
  query = 'token=dnsy_fixture&email=qa%40example.test'
): string {
  return `http://127.0.0.1:${new URL(browserUrl).searchParams.get('port')}/callback?${query}`
}
function request(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, (res) => {
      res.resume()
      resolve(res.statusCode!)
    }).on('error', reject)
  })
}
async function started(
  open: (url: string) => Promise<void> = async () => {}
): Promise<{ attempt: DeviceLinkAttempt; url: string }> {
  let url = ''
  const attempt = new DeviceLinkAttempt('https://example.test', async (value) => {
    url = value
    await open(value)
  })
  attempt.start()
  while (!url) await turn()
  return { attempt, url }
}

test('success returns sanitized fixture, redirects, and releases listener and timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { attempt, url } = await started()
  assert.equal(await request(callback(url)), 302)
  const result = await attempt.result
  assert.equal(result.kind, 'linked')
  t.mock.timers.tick(5 * 60_000)
  assert.equal(await attempt.result, result)
  await assert.rejects(request(callback(url)))
})

test('invalid callback settles and permits recovery; unrelated paths do not settle', async () => {
  const { attempt, url } = await started()
  assert.equal(await request(callback(url).replace('/callback?', '/favicon.ico?')), 404)
  assert.equal(await request(callback(url, 'token=invalid_fixture')), 400)
  assert.deepEqual(await attempt.result, {
    kind: 'error',
    message: 'The browser did not return a valid token'
  })
  await assert.rejects(request(callback(url)))
})

test('browser launch rejection is caught, sanitized, and closes its listener', async () => {
  const { attempt, url } = await started(async () => {
    throw new Error('private launch detail')
  })
  assert.deepEqual(await attempt.result, {
    kind: 'error',
    message: 'Could not open your browser — try again'
  })
  await assert.rejects(request(callback(url)))
})

test('timeout releases loopback even while the browser opener is unresolved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { attempt, url } = await started(() => new Promise(() => {}))
  t.mock.timers.tick(5 * 60_000)
  assert.deepEqual(await attempt.result, {
    kind: 'error',
    message: 'Sign-in timed out — try again'
  })
  await assert.rejects(request(callback(url)))
})

test('cancel before listening prevents browser launch and settles', async () => {
  let opens = 0
  const attempt = new DeviceLinkAttempt('https://example.test', async () => {
    opens++
  })
  attempt.start()
  attempt.cancel()
  assert.deepEqual(await attempt.result, { kind: 'cancelled' })
  await turn()
  assert.equal(opens, 0)
})

test('cancel/retry isolates late launch failure and the older timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let rejectOld!: (error: Error) => void
  const old = await started(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject
      })
  )
  old.attempt.cancel()
  t.mock.timers.tick(1000)
  const next = await started()
  rejectOld(new Error('late private browser error'))
  await turn()
  t.mock.timers.tick(5 * 60_000 - 1000)
  assert.deepEqual(await old.attempt.result, { kind: 'cancelled' })
  await assert.rejects(request(callback(old.url)))
  assert.equal(await request(callback(next.url)), 302)
  assert.equal((await next.attempt.result).kind, 'linked')
})

test('malformed callback URL settles without an uncaught request-handler exception', async () => {
  const { attempt, url } = await started()
  const malformed = callback(url).replace('/callback?', '//[?')
  assert.equal(await request(malformed), 400)
  assert.equal((await attempt.result).kind, 'error')
  await assert.rejects(request(callback(url)))
})
