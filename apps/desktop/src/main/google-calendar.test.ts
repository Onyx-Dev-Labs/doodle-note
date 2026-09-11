import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
let browser: (url: string) => Promise<void> = async () => {}
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        shell: { openExternal: (url: string) => browser(url) },
        safeStorage: {
          encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
          decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
        }
      }
    : originalLoad(id, ...args)
const { GoogleCalendarClient } = require('./google-calendar') as typeof import('./google-calendar')
loader._load = originalLoad
const secret = 'synthetic-desktop-credential'
const calendar = {
  id: 'g:primary',
  name: 'Test calendar',
  colorHex: '#123456',
  isDefault: true,
  canEdit: false
}
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

function setup(
  t: TestContext,
  persisted = false,
  credential = secret
): { client: InstanceType<typeof GoogleCalendarClient>; cache: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'google-calendar-test-'))
  const cache = join(dir, 'google-token-cache')
  if (persisted)
    writeFileSync(
      cache,
      'encrypted:' + JSON.stringify({ refreshToken: 'fixture-refresh', email: 'qa@example.test' })
    )
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { client: new GoogleCalendarClient(dir, credential), cache, dir }
}

test('initial exchange includes desktop credential, PKCE and matching redirect; restart refresh uses same credential', async (t) => {
  const { client, cache, dir } = setup(t)
  const networkFetch = globalThis.fetch
  const grants: string[] = []
  let auth: URL
  browser = async (url) => {
    auth = new URL(url)
    const callback = new URL(auth.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'fixture-code')
    callback.searchParams.set('state', auth.searchParams.get('state')!)
    await networkFetch(callback)
  }
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(init?.body as URLSearchParams)
      assert.equal(params.get('client_secret'), secret)
      grants.push(params.get('grant_type')!)
      if (params.get('grant_type') === 'authorization_code') {
        assert.equal(params.get('redirect_uri'), auth.searchParams.get('redirect_uri'))
        assert.equal(
          createHash('sha256').update(params.get('code_verifier')!).digest('base64url'),
          auth.searchParams.get('code_challenge')
        )
        assert.equal(
          auth.searchParams.get('scope'),
          'openid email https://www.googleapis.com/auth/calendar.readonly'
        )
      } else assert.equal(params.get('refresh_token'), 'fixture-refresh')
      return response({
        access_token: 'fixture-access',
        expires_in: 3600,
        refresh_token: 'fixture-refresh'
      })
    }
    assert.equal(new URL(url).origin, 'https://www.googleapis.com')
    assert.ok(new URL(url).pathname.startsWith('/calendar/v3/'))
    return response({ items: [{ id: 'primary', summary: 'Test calendar', primary: true }] })
  })
  await client.connect()
  assert.match(readFileSync(cache, 'utf8'), /^encrypted:/)
  await client.fetchCalendars()
  await new GoogleCalendarClient(dir, secret).fetchCalendars()
  assert.deepEqual(grants, ['authorization_code', 'refresh_token'])
})

test('missing credential fails before browser/network and preserves persisted credentials', async (t) => {
  const { client, cache } = setup(t, true, '')
  browser = async () => assert.fail('must not open browser with missing configuration')
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not send unconfigured request'))
  await assert.rejects(client.connect(), /Google Calendar.*configured.*Update DoodleNote/)
  await assert.rejects(client.fetchCalendars(), /Google Calendar.*configured/)
  assert.match(readFileSync(cache, 'utf8'), /fixture-refresh/)
})

test('Google missing-client-secret response gives application recovery without leaking provider payload; retry succeeds', async (t) => {
  const { client, cache } = setup(t, true)
  let failed = true
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      if (failed)
        return response(
          {
            error: 'invalid_request',
            error_description: 'client_secret is missing. private-provider-detail'
          },
          400
        )
      return response({ access_token: 'fixture-access', expires_in: 3600 })
    }
    return response({ items: [{ id: 'primary' }] })
  })
  await assert.rejects(client.fetchCalendars(), (error) => {
    assert.match(String(error), /Google Calendar.*Update DoodleNote/)
    assert.doesNotMatch(String(error), /private-provider-detail|synthetic-desktop/)
    return true
  })
  assert.match(readFileSync(cache, 'utf8'), /fixture-refresh/)
  failed = false
  assert.equal((await client.fetchCalendars()).length, 1)
})

test('expired access token refreshes, invalid grant requests reconnect, disconnect removes only Google tokens', async (t) => {
  const { client, cache, dir } = setup(t, true)
  writeFileSync(join(dir, 'notes-fixture'), 'preserve')
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  let refreshes = 0
  let revoked = false
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      refreshes++
      return revoked
        ? response({ error: 'invalid_grant' }, 400)
        : response({ access_token: 'fixture-access', expires_in: 3600 })
    }
    return response({ items: [] })
  })
  await client.fetchEvents(calendar)
  await client.fetchEvents(calendar)
  assert.equal(refreshes, 1)
  t.mock.timers.tick(3_600_000)
  await client.fetchEvents(calendar)
  assert.equal(refreshes, 2)
  revoked = true
  t.mock.timers.tick(3_600_000)
  await assert.rejects(client.fetchEvents(calendar), /Google Calendar.*reconnect/i)
  client.disconnect()
  assert.equal(client.signedIn, false)
  assert.throws(() => readFileSync(cache))
  assert.equal(readFileSync(join(dir, 'notes-fixture'), 'utf8'), 'preserve')
})
