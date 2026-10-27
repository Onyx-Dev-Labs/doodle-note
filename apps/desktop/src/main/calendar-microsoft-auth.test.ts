import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { get } from 'node:http'
import { test } from 'node:test'
import {
  PublicClientApplication,
  type Configuration,
  type AuthenticationResult,
  type AccountInfo,
  type NetworkRequestOptions
} from '@azure/msal-node'
import { CalendarAuthLoopback } from './calendar-auth-loopback'
import { acquireCalendarMicrosoftToken } from './calendar-microsoft-auth'
import { accountKey, microsoftIdentity } from './calendar-identity'

const scopes = ['User.Read', 'Calendars.Read', 'offline_access']
const authority = 'https://login.microsoftonline.com/fixture-tenant'
const tokenEndpoint = `${authority}/oauth2/v2.0/token`
const clientInfo = Buffer.from(
  JSON.stringify({ uid: 'fixture-user', utid: 'fixture-tenant' })
).toString('base64url')
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

// No system browser and no provider traffic. Only the app's local HTTP callback is contacted.
async function callback(url: URL): Promise<void> {
  assert.equal(url.hostname, 'localhost')
  url.hostname = '127.0.0.1'
  await new Promise<void>((resolve, reject) => {
    get(url, (response) => {
      response.resume()
      response.once('end', () => {
        try {
          assert.equal(response.statusCode, 302)
          assert.equal(new URL(response.headers.location!).search, '')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    }).once('error', reject)
  })
}

interface Fixture {
  client: PublicClientApplication
  config: Configuration
  loopback: CalendarAuthLoopback
  requests: URLSearchParams[]
  headers: Record<string, string>[]
  run(): Promise<AuthenticationResult>
}
function fixture(
  nonceMode: 'matching' | 'missing' | 'wrong' | 'missing-id-token' = 'matching',
  callbackClientInfo = clientInfo,
  tokenClientInfo: string | null = clientInfo
): Fixture {
  let authorization: URL
  const requests: URLSearchParams[] = []
  const headers: Record<string, string>[] = []
  const config: Configuration = {
    auth: {
      clientId: 'fixture-client',
      authority,
      knownAuthorities: ['login.microsoftonline.com'],
      authorityMetadata: JSON.stringify({
        authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
        token_endpoint: tokenEndpoint,
        end_session_endpoint: `${authority}/oauth2/v2.0/logout`,
        issuer: `${authority}/v2.0`,
        jwks_uri: `${authority}/discovery/v2.0/keys`
      })
    },
    system: {
      loggerOptions: { loggerCallback: () => {} },
      networkClient: {
        async sendGetRequestAsync<T>(): Promise<{
          headers: Record<string, string>
          body: T
          status: number
        }> {
          throw new Error('Unexpected external discovery request')
        },
        async sendPostRequestAsync<T>(
          url: string,
          options?: NetworkRequestOptions
        ): Promise<{ headers: Record<string, string>; body: T; status: number }> {
          const endpoint = new URL(url)
          assert.equal(
            endpoint.origin + endpoint.pathname,
            tokenEndpoint,
            'callback metadata cannot redirect the token request'
          )
          assert.deepEqual([...endpoint.searchParams.keys()], ['client-request-id'])
          const body = new URLSearchParams(options?.body)
          requests.push(body)
          headers.push(options?.headers ?? {})
          assert.equal(body.get('client_id'), 'fixture-client')
          if (body.get('grant_type') === 'authorization_code') {
            assert.equal(body.get('code'), 'fixture-code')
            assert.equal(body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
            assert.equal(
              createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),
              authorization.searchParams.get('code_challenge')
            )
          } else {
            assert.equal(body.get('grant_type'), 'refresh_token')
            assert.equal(body.get('refresh_token'), 'fixture-refresh')
          }
          const claims = {
            aud: 'fixture-client',
            iss: `${authority}/v2.0`,
            tid: 'fixture-tenant',
            oid: 'fixture-user',
            sub: 'fixture-subject',
            preferred_username: 'fixture@example.test',
            name: 'Fixture',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...(nonceMode === 'missing'
              ? {}
              : {
                  nonce:
                    nonceMode === 'wrong'
                      ? 'attacker-nonce'
                      : authorization.searchParams.get('nonce')
                })
          }
          return {
            headers: {},
            status: 200,
            body: {
              token_type: 'Bearer',
              scope: 'User.Read Calendars.Read',
              expires_in: 3600,
              access_token: `fixture-access-${requests.length}`,
              refresh_token: 'fixture-refresh',
              ...(tokenClientInfo === null ? {} : { client_info: tokenClientInfo }),
              ...(nonceMode === 'missing-id-token'
                ? {}
                : { id_token: `${encode({ alg: 'none' })}.${encode(claims)}.fixture` })
            } as T
          }
        }
      }
    }
  }
  const client = new PublicClientApplication(config)
  const loopback = new CalendarAuthLoopback()
  const run = (): Promise<AuthenticationResult> =>
    acquireCalendarMicrosoftToken(
      client,
      loopback,
      scopes,
      async (url) => {
        authorization = new URL(url)
        assert.equal(authorization.origin, 'https://login.microsoftonline.com')
        assert.equal(authorization.searchParams.get('state'), loopback.state)
        assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
        assert.equal(authorization.searchParams.get('response_mode'), 'query')
        assert.equal(authorization.searchParams.get('prompt'), 'select_account')
        assert.ok(authorization.searchParams.get('nonce'))
        assert.notEqual(authorization.searchParams.get('nonce'), loopback.state)
        assert.equal(authorization.searchParams.has('code_verifier'), false)
        const redirect = new URL(authorization.searchParams.get('redirect_uri')!)
        redirect.search = new URLSearchParams({
          code: 'fixture-code',
          state: loopback.state,
          client_info: callbackClientInfo,
          cloud_instance_host_name: 'attacker.example.test',
          cloud_graph_host_name: 'attacker.example.test',
          msgraph_host: 'attacker.example.test',
          authority: 'https://attacker.example.test',
          nonce: 'attacker-nonce'
        }).toString()
        await callback(redirect)
      },
      () => {},
      '<h1>Connected</h1>',
      '<h1>Retry</h1>'
    )
  return { client, config, loopback, requests, headers, run }
}

test('pinned MSAL exchanges a state-bound code with S256 and original nonce; serialized cache restores and refreshes silently', async (t) => {
  const f = fixture()
  t.after(() => f.loopback.closeServer())
  const result = await f.run()
  assert.equal(result.account?.username, 'fixture@example.test')
  assert.equal(result.accessToken, 'fixture-access-1')
  assert.equal(f.requests.length, 1)
  assert.throws(() => f.loopback.getRedirectUri(), /cancelled/)
  const restored = new PublicClientApplication(f.config)
  restored.getTokenCache().deserialize(f.client.getTokenCache().serialize())
  const [account] = await restored.getTokenCache().getAllAccounts()
  assert.equal(account?.homeAccountId, result.account?.homeAccountId)
  const silent = await restored.acquireTokenSilent({
    account: account!,
    scopes,
    forceRefresh: true
  })
  assert.equal(silent.accessToken, 'fixture-access-2')
  assert.equal(f.requests.length, 2)
})

for (const mode of ['missing', 'wrong', 'missing-id-token'] as const) {
  test(`pinned MSAL rejects ${mode} nonce evidence before caching any account or token`, async (t) => {
    const f = fixture(mode)
    t.after(() => f.loopback.closeServer())
    const before = f.client.getTokenCache().serialize()
    await assert.rejects(f.run(), /nonce_mismatch/)
    assert.equal(f.requests.length, 1)
    assert.deepEqual(await f.client.getTokenCache().getAllAccounts(), [])
    assert.equal(f.client.getTokenCache().serialize(), before)
    assert.throws(() => f.loopback.getRedirectUri(), /cancelled/)
  })
}

for (const [label, value, expectedHint] of [
  ['absent', '', undefined],
  ['malformed', 'not-base64-json', undefined],
  [
    'conflicting',
    encode({ uid: 'untrusted-user', utid: 'untrusted-tenant' }),
    'Oid:untrusted-user@untrusted-tenant'
  ],
  ['missing uid', encode({ utid: 'untrusted-tenant' }), 'Oid:undefined@untrusted-tenant']
] as const) {
  test(`callback client_info ${label} cannot set the authenticated account/cache partition`, async (t) => {
    const f = fixture('matching', value)
    t.after(() => f.loopback.closeServer())
    const result = await f.run()
    assert.equal(f.headers[0]?.['X-AnchorMailbox'], expectedHint)
    assert.equal(result.account?.homeAccountId, 'fixture-user.fixture-tenant')
    assert.equal(result.account?.tenantId, 'fixture-tenant')
    assert.equal(result.account?.localAccountId, 'fixture-user')
    const expected = {
      homeAccountId: 'fixture-user.fixture-tenant',
      environment: 'login.microsoftonline.com',
      tenantId: 'fixture-tenant',
      localAccountId: 'fixture-user'
    } as AccountInfo
    assert.equal(
      accountKey(microsoftIdentity(result.account!, 'fixture-client')),
      accountKey(microsoftIdentity(expected, 'fixture-client'))
    )
    const cached = await f.client.getTokenCache().getAllAccounts()
    assert.equal(cached.length, 1)
    assert.equal(cached[0]?.homeAccountId, 'fixture-user.fixture-tenant')
    assert.doesNotMatch(f.client.getTokenCache().serialize(), /untrusted-user|untrusted-tenant/)
  })
}

test('absent token-response client_info falls back to token subject, never callback client_info', async (t) => {
  const f = fixture('matching', encode({ uid: 'untrusted-user', utid: 'untrusted-tenant' }), null)
  t.after(() => f.loopback.closeServer())
  const result = await f.run()
  assert.equal(result.account?.homeAccountId, 'fixture-subject')
  assert.equal(result.account?.tenantId, 'fixture-tenant')
  assert.equal(result.account?.localAccountId, 'fixture-user')
  assert.doesNotMatch(f.client.getTokenCache().serialize(), /untrusted-user|untrusted-tenant/)
})
