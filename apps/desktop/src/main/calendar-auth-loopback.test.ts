import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Server } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { CalendarAuthLoopback } from './calendar-auth-loopback'
async function ready(listener: CalendarAuthLoopback): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      return listener.getRedirectUri().replace('localhost', '127.0.0.1')
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  throw new Error('Callback did not start')
}

test('loopback rejects unrelated callbacks, strips the authorization code from the landing redirect, and closes on cancellation', async (t) => {
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const result = listener.listenForAuthCode('<h1>Connected</h1>', '<h1>Retry</h1>')
  const url = await ready(listener)
  const wrong = await fetch(`${url}/?code=wrong&state=wrong`, { redirect: 'manual' })
  assert.equal(wrong.status, 400)
  const accepted = await fetch(`${url}/?code=synthetic&state=${listener.state}`, {
    redirect: 'manual'
  })
  assert.equal(accepted.status, 302)
  assert.equal(new URL(accepted.headers.get('location')!).search, '')
  assert.equal((await result).code, 'synthetic')
  listener.closeServer()
  await assert.rejects(fetch(url))
  const cancelled = new CalendarAuthLoopback()
  const pending = cancelled.listenForAuthCode()
  const rejection = assert.rejects(pending, /cancelled/)
  await ready(cancelled)
  cancelled.closeServer()
  await rejection
  await assert.rejects(cancelled.listenForAuthCode(), /cancelled/)
})

test('callback fields are allowlisted; malformed, duplicate and repeated terminal responses cannot replace the code', async (t) => {
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const result = listener.listenForAuthCode()
  const url = (await listener.waitForRedirectUri()).replace('localhost', '127.0.0.1')
  for (const path of [
    '/other?code=wrong',
    '/?code=wrong',
    `/?state=${listener.state}&code=a&code=b`,
    `/?state=${listener.state}&state=other&code=a`,
    `/?state=${listener.state}&code=a&error=access_denied`,
    `/?state=${listener.state}&code=a&client_info=a&client_info=b`,
    `/?state=${listener.state}`
  ]) {
    const response = await fetch(url + path, { redirect: 'manual' })
    assert.ok(response.status >= 400)
  }
  assert.equal(
    (await fetch(`${url}/?state=${listener.state}&code=post`, { method: 'POST' })).status,
    404
  )
  const params = new URLSearchParams({
    state: listener.state,
    code: 'accepted',
    client_info: 'fixture',
    nonce: 'untrusted',
    cloud_instance_host_name: 'attacker.example.test',
    cloud_graph_host_name: 'attacker.example.test',
    msgraph_host: 'attacker.example.test'
  })
  const response = await fetch(`${url}/?${params}`, { redirect: 'manual' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await result, {
    code: 'accepted',
    state: listener.state,
    client_info: 'fixture'
  })
  assert.equal(
    (await fetch(`${url}/?state=${listener.state}&code=again`, { redirect: 'manual' })).status,
    400
  )
})

test('provider error rejects without reflecting provider text or accepting a later success', async (t) => {
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const result = listener.listenForAuthCode()
  const rejected = assert.rejects(result, (error: Error) => {
    assert.match(error.message, /not completed/)
    assert.doesNotMatch(error.message, /untrusted/)
    return true
  })
  const url = (await listener.waitForRedirectUri()).replace('localhost', '127.0.0.1')
  await fetch(`${url}/?state=${listener.state}&error=access_denied&error_description=untrusted`, {
    redirect: 'manual'
  })
  await rejected
  assert.equal(
    (await fetch(`${url}/?state=${listener.state}&code=late`, { redirect: 'manual' })).status,
    400
  )
})

test('closing the callback destroys incomplete HTTP sockets and is idempotent', async (t) => {
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const result = listener.listenForAuthCode()
  const rejected = assert.rejects(result, /cancelled/)
  const url = new URL(await listener.waitForRedirectUri())
  const socket = connect(Number(url.port), '127.0.0.1')
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n')
  socket.on('error', (error: NodeJS.ErrnoException) => assert.equal(error.code, 'ECONNRESET'))
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  listener.closeServer()
  listener.closeServer()
  await rejected
  await closed
  assert.equal(socket.destroyed, true)
  await assert.rejects(fetch(`http://127.0.0.1:${url.port}`))
})

test('listener bind errors reject both readiness and authorization', async (t) => {
  t.mock.method(Server.prototype, 'listen', function (this: Server) {
    queueMicrotask(() => this.emit('error', new Error('synthetic EADDRINUSE')))
    return this
  })
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const code = assert.rejects(listener.listenForAuthCode(), /could not open its local callback/)
  const ready = assert.rejects(listener.waitForRedirectUri(), /could not open its local callback/)
  await Promise.all([code, ready])
  listener.closeServer()
})

test('cancelling before a delayed bind rejects readiness and closes a late listening socket', async (t) => {
  const listen = Server.prototype.listen
  let start!: () => void
  const servers: Server[] = []
  t.mock.method(
    Server.prototype,
    'listen',
    function (this: Server, ...args: Parameters<Server['listen']>) {
      servers.push(this)
      start = () => {
        listen.apply(this, args)
      }
      return this
    }
  )
  const listener = new CalendarAuthLoopback()
  t.after(() => listener.closeServer())
  const code = assert.rejects(listener.listenForAuthCode(), /cancelled/)
  const ready = assert.rejects(listener.waitForRedirectUri(), /cancelled/)
  listener.closeServer()
  await Promise.all([code, ready])
  const server = servers[0]!
  const listening = once(server, 'listening')
  start()
  await listening
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(server.listening, false)
  assert.equal(server.address(), null)
})
