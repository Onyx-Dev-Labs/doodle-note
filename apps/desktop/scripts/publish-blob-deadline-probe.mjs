// Isolated test process only. Its caller supplies a sanitized fake-token env.
import assert from 'node:assert/strict'
import { openAsBlob } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { createBlobTransport } from './publish-mac-release.mjs'

const [mode, file] = process.argv.slice(2)
assert.ok(['active', 'retry-delay'].includes(mode))
const require = createRequire(import.meta.resolve('@vercel/blob'))
const { MockAgent, setGlobalDispatcher } = require('undici')
const mock = new MockAgent()
mock.disableNetConnect()
mock.enableNetConnect((host) => host.startsWith('127.0.0.1:'))
setGlobalDispatcher(mock)
const controller = new AbortController()
let requests = 0
let closed = false
let abortedAt
let timer
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString(), 'signed zip fixture')
  requests++
  response.on('close', () => {
    closed = true
  })
  if (requests === 1) {
    // Start the 100 ms deadline once the real SDK request has reached the peer;
    // this isolates cancellation latency from worker/import startup time.
    timer = setTimeout(() => {
      abortedAt = performance.now()
      controller.abort(new DOMException('Test operation deadline', 'TimeoutError'))
    }, 100)
  }
  if (mode === 'retry-delay') {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { code: 'service_unavailable' } }))
  }
  // Active mode consumes the body but deliberately never acknowledges it.
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${server.address().port}`
try {
  const transport = await createBlobTransport()
  let error
  try {
    await transport.put('updates/probe.zip', await openAsBlob(file), {
      sourceFile: file,
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      abortSignal: controller.signal
    })
  } catch (caught) {
    error = caught
  }
  const afterDeadlineMs = performance.now() - abortedAt
  assert.ok(
    Number.isFinite(afterDeadlineMs),
    'deadline must have fired during the real request/delay'
  )
  assert.ok(afterDeadlineMs < 700, `SDK outlived cancellation: ${Math.round(afterDeadlineMs)} ms`)
  assert.equal(error?.name, 'AbortError')
  await delay(50)
  assert.equal(closed, true, 'real request socket must close, not just the caller promise')
  // Keep the peer available beyond the SDK's randomized 1–2 second first delay.
  await delay(2200)
  assert.equal(requests, 1, 'no request/write may run after cancellation')
  const before = requests
  await assert.rejects(
    transport.put('updates/probe.zip', new Blob(['unused']), {
      access: 'public',
      allowOverwrite: false,
      abortSignal: controller.signal
    }),
    { name: 'AbortError' }
  )
  assert.equal(requests, before, 'an already-aborted operation must not start a worker request')
  console.log(
    JSON.stringify({
      mode,
      deadlineMs: 100,
      afterDeadlineMs: Math.round(afterDeadlineMs),
      requests,
      closed
    })
  )
} finally {
  clearTimeout(timer)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await mock.close()
}
