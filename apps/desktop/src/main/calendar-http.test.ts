import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarPages, CalendarRequestError, mapCalendarTasks } from './calendar-http'
const graph = 'https://graph.microsoft.com/v1.0/me/calendars?$top=50'
const google = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250'
const json = (body: unknown, status = 200, headers = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

test('Graph follows every nextLink and Google encodes opaque page tokens on the original endpoint', async (t) => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(url)
    assert.equal(init.redirect, 'error')
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic')
    if (url.startsWith('https://graph'))
      return json(
        calls.length === 1
          ? { value: [1], '@odata.nextLink': `${graph}&$skiptoken=next` }
          : { value: [2] }
      )
    return json(
      new URL(url).searchParams.has('pageToken')
        ? { items: [4] }
        : { items: [3], nextPageToken: 'https://evil.test/?x=1&secret=2' }
    )
  })
  assert.deepEqual(await calendarPages(graph, 'synthetic', 'microsoft'), [1, 2])
  assert.deepEqual(await calendarPages(google, 'synthetic', 'google'), [3, 4])
  assert.equal(new URL(calls[3]!).origin, 'https://www.googleapis.com')
  assert.equal(new URL(calls[3]!).searchParams.get('pageToken'), 'https://evil.test/?x=1&secret=2')
})

test('untrusted origins, changed paths and repeated pages are rejected before any token-bearing follow-up', async (t) => {
  for (const destination of [
    'https://evil.test/v1.0/me/calendars',
    'https://graph.microsoft.com/v1.0/users/other/calendars',
    graph
  ]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return json({ value: [1], '@odata.nextLink': destination })
    })
    await assert.rejects(calendarPages(graph, 'synthetic', 'microsoft'), /unsafe|repeated/)
    assert.equal(calls, 1)
    mock.mock.restore()
  }
})

test('pagination caps fail explicitly and never return partial success', async (t) => {
  let page = 0
  t.mock.method(globalThis, 'fetch', async () =>
    json({ value: [page], '@odata.nextLink': `${graph}&page=${++page}` })
  )
  await assert.rejects(calendarPages(graph, 'synthetic', 'microsoft'), /exceeded 100 pages/)
  assert.equal(page, 100)
  t.mock.method(globalThis, 'fetch', async () =>
    json({ items: Array.from({ length: 10_001 }, (_, i) => i) })
  )
  await assert.rejects(calendarPages(google, 'synthetic', 'google'), /exceeded 10,000 results/)
})

test('transient errors retry within a bound; long Retry-After returns an account cooldown', async (t) => {
  let calls = 0
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    ++calls < 3 ? json({}, 429, { 'retry-after': '0' }) : json({ value: [1] })
  )
  assert.deepEqual(await calendarPages(graph, 'synthetic', 'microsoft'), [1])
  assert.equal(calls, 3)
  mock.mock.restore()
  calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return json({ secret: 'never show provider body' }, 429, { 'retry-after': '120' })
  })
  await assert.rejects(
    calendarPages(graph, 'synthetic', 'microsoft'),
    (err) =>
      err instanceof CalendarRequestError &&
      !!err.retryAt &&
      err.retryAt > Date.now() + 110_000 &&
      !err.message.includes('secret')
  )
  assert.equal(calls, 1)
})

test('task concurrency is bounded and result order is stable', async () => {
  let active = 0,
    maximum = 0
  const result = await mapCalendarTasks([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return value * 2
  })
  assert.equal(maximum, 3)
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10, 12])
})
