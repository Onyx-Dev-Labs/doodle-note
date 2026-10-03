import assert from 'node:assert/strict'
import { test } from 'node:test'
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
