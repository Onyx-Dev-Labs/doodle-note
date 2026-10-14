import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingRecord } from '../shared/meetings-api'
import type { MeetingsService } from './meetings-service'
import type { FoldersService } from './folders-service'

// Load the real service with only Electron's OS boundary replaced; fetch is stubbed per test.
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        shell: { openExternal: async () => {} },
        safeStorage: {
          encryptString: (value: string) => Buffer.from(value),
          decryptString: (value: Buffer) => value.toString()
        }
      }
    : originalLoad(id, ...args)
const { SyncService, sanitizeShareUpdate } =
  require('./sync-service') as typeof import('./sync-service')
loader._load = originalLoad

const TOKEN = 'dnsy_' + 'ab'.repeat(32)
const BASE = 'https://www.doodlenote.ai'
const MEETING_ID = '6f1c2f0e-8f43-4d55-9a3c-1b2a3c4d5e6f'

function meeting(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: MEETING_ID,
    title: 'Quarterly planning',
    createdAt: '2026-10-01T10:00:00.000Z',
    rawNotesMarkdown: '- ship it',
    segments: [
      {
        id: 's1',
        channel: 'mic',
        speaker: 'You',
        speakerId: 'mic',
        text: 'Let us ship it',
        startMs: 0,
        endMs: 1000,
        confidence: 0.9
      }
    ],
    echoSuppressed: 0,
    ...overrides
  } as MeetingRecord
}

interface Call {
  url: string
  method: string
  authorization: string | null
  body: unknown
}

type Reply = { status?: number; body?: unknown } | Error

/** Service with a linked (or unlinked) device and a scripted fetch, one reply per call. */
function setup(
  t: TestContext,
  options: { linked?: boolean; record?: MeetingRecord; replies?: Reply[] } = {}
): { service: InstanceType<typeof SyncService>; calls: Call[] } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-share-test-'))
  const record = options.record ?? meeting()
  const service = new SyncService(
    dir,
    { readAll: () => [record] } as unknown as MeetingsService,
    { list: () => [] } as unknown as FoldersService,
    () => {}
  )
  if (options.linked !== false) {
    Object.assign(service, {
      config: {
        ...Reflect.get(service, 'config'),
        tokenEnc: Buffer.from(TOKEN).toString('base64'),
        enabled: true
      }
    })
  }
  const calls: Call[] = []
  const replies = [...(options.replies ?? [])]
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    })
    const reply = replies.shift()
    if (!reply) throw new Error(`unexpected fetch ${String(input)}`)
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { service, calls }
}

const pushed = { body: { results: [{ id: MEETING_ID, ok: true }] } }
const recipient = {
  id: '0b8a3f8e-1d4c-4a7e-9b1f-2c3d4e5f6a7b',
  email: 'rae@example.test',
  createdAt: '2026-10-14T12:00:00.000Z'
}
const workspace = { name: 'Acme', personal: false, memberCount: 3 }
/** What /api/sync/share returns (the web Share panel state plus the legacy top-level url). */
const serverState = {
  ok: true,
  url: `${BASE}/share/abc`,
  includeTranscript: true,
  link: { url: `${BASE}/share/abc`, expiresAt: '2026-10-21T12:00:00.000Z' },
  recipients: [recipient],
  workspace,
  limits: { perRequest: 20, perMeeting: 50 }
}
const parsedState = {
  includeTranscript: true,
  link: { url: `${BASE}/share/abc`, expiresAt: '2026-10-21T12:00:00.000Z' },
  recipients: [recipient],
  workspace,
  synced: true
}

test('not linked: every share action returns the guidance and makes no request', async (t) => {
  const { service, calls } = setup(t, { linked: false })
  const results = [
    await service.shareState(MEETING_ID),
    await service.addShareRecipients(MEETING_ID, 'rae@example.test'),
    await service.removeShareRecipient(MEETING_ID, recipient.id),
    await service.updateShareSettings(MEETING_ID, { link: 'on' }),
    await service.updateShareSettings(MEETING_ID, { link: 'off' }),
    await service.updateShareSettings(MEETING_ID, { includeTranscript: true })
  ]
  for (const result of results) {
    assert.deepEqual(result, { error: 'Connect cloud sync in Settings first', code: 'not_linked' })
  }
  assert.deepEqual(await service.share(MEETING_ID), {
    error: 'Connect cloud sync in Settings first'
  })
  assert.equal(calls.length, 0)
})

test('local-only text imports and missing meetings never reach the network', async (t) => {
  const record = meeting({
    segments: [{ ...meeting().segments[0]!, source: 'text' }] as MeetingRecord['segments']
  })
  const { service, calls } = setup(t, { record })
  const local = await service.addShareRecipients(MEETING_ID, 'rae@example.test')
  assert.equal('code' in local && local.code, 'local_only')
  const localSettings = await service.updateShareSettings(MEETING_ID, { link: 'on' })
  assert.equal('code' in localSettings && localSettings.code, 'local_only')
  const missing = await service.shareState('00000000-0000-4000-8000-000000000000')
  assert.equal('code' in missing && missing.code, 'not_found')
  assert.equal(calls.length, 0)
})

test('adding people pushes first, then posts only the addresses', async (t) => {
  const { service, calls } = setup(t, {
    replies: [
      pushed,
      { status: 201, body: { ok: true, added: [recipient], recipients: [recipient] } }
    ]
  })
  const result = await service.addShareRecipients(MEETING_ID, '  rae@example.test, b@x.test ')
  assert.deepEqual(result, { recipients: [recipient] })
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ['POST', `${BASE}/api/sync/push`],
      ['POST', `${BASE}/api/sync/share/recipients?meetingId=${MEETING_ID}`]
    ]
  )
  assert.ok(calls.every((c) => c.authorization === `Bearer ${TOKEN}`))
  assert.equal((calls[0]!.body as { meetings: Array<{ id: string }> }).meetings[0]!.id, MEETING_ID)
  // No per-person transcript setting is sent.
  assert.deepEqual(calls[1]!.body, { emails: 'rae@example.test, b@x.test' })
})

test('empty address input is rejected locally', async (t) => {
  const { service, calls } = setup(t)
  const result = await service.addShareRecipients(MEETING_ID, '   ')
  assert.deepEqual(result, { error: 'Enter at least one email address.', code: 'request' })
  assert.equal(calls.length, 0)
})

test('server validation errors keep their message and rejected addresses', async (t) => {
  const { service } = setup(t, {
    replies: [
      pushed,
      {
        status: 409,
        body: {
          error: 'Already shared with rae@example.test',
          code: 'already_shared',
          emails: ['rae@example.test']
        }
      }
    ]
  })
  assert.deepEqual(await service.addShareRecipients(MEETING_ID, 'rae@example.test'), {
    code: 'request',
    error: 'Already shared with rae@example.test',
    emails: ['rae@example.test']
  })
})

test('a push rejected for another workspace returns a clear error, never a stale link', async (t) => {
  const rejected = {
    body: { results: [{ id: MEETING_ID, ok: false, error: 'id belongs to another workspace' }] }
  }
  const { service, calls } = setup(t, { replies: [rejected, rejected, rejected, rejected] })
  const add = await service.addShareRecipients(MEETING_ID, 'rae@example.test')
  const on = await service.updateShareSettings(MEETING_ID, { link: 'on' })
  const transcript = await service.updateShareSettings(MEETING_ID, { includeTranscript: true })
  const legacy = await service.share(MEETING_ID)
  for (const result of [add, on, transcript]) {
    assert.equal('code' in result && result.code, 'push_rejected')
    assert.match((result as { error: string }).error, /different cloud workspace/)
  }
  assert.ok('error' in legacy && /different cloud workspace/.test(legacy.error))
  // Only the pushes went out; no share request followed any of them.
  assert.deepEqual(
    calls.map((c) => c.url),
    Array(4).fill(`${BASE}/api/sync/push`)
  )
})

test('settings changes push first, then send exactly the requested fields', async (t) => {
  const { service, calls } = setup(t, {
    replies: [pushed, { body: serverState }, pushed, { body: serverState }]
  })
  assert.deepEqual(
    await service.updateShareSettings(MEETING_ID, { link: 'on', expiresInDays: 7 }),
    parsedState
  )
  assert.deepEqual(
    await service.updateShareSettings(MEETING_ID, { includeTranscript: false }),
    parsedState
  )
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ['POST', `${BASE}/api/sync/push`],
      ['POST', `${BASE}/api/sync/share`],
      ['POST', `${BASE}/api/sync/push`],
      ['POST', `${BASE}/api/sync/share`]
    ]
  )
  assert.deepEqual(calls[1]!.body, { meetingId: MEETING_ID, link: 'on', expiresInDays: 7 })
  assert.deepEqual(calls[3]!.body, { meetingId: MEETING_ID, includeTranscript: false })
})

test('turning general access off revokes without pushing', async (t) => {
  const off = { ...serverState, url: null, link: null }
  const { service, calls } = setup(t, { replies: [{ body: off }] })
  assert.deepEqual(await service.updateShareSettings(MEETING_ID, { link: 'off' }), {
    ...parsedState,
    link: null
  })
  assert.deepEqual(calls, [
    {
      url: `${BASE}/api/sync/share`,
      method: 'POST',
      authorization: `Bearer ${TOKEN}`,
      body: { meetingId: MEETING_ID, link: 'off' }
    }
  ])
})

test('invalid or empty settings changes are rejected without a request', async (t) => {
  const { service, calls } = setup(t)
  const badExpiry = await service.updateShareSettings(MEETING_ID, { expiresInDays: 3 as 7 })
  assert.deepEqual(badExpiry, { error: 'Choose when the link expires.', code: 'request' })
  const badLink = await service.updateShareSettings(MEETING_ID, { link: 'maybe' as 'on' })
  assert.equal('code' in badLink && badLink.code, 'request')
  const empty = await service.updateShareSettings(MEETING_ID, {})
  assert.deepEqual(empty, { error: 'Nothing to change.', code: 'request' })
  assert.equal(calls.length, 0)
})

test('IPC payloads are sanitized to known, well-typed fields', () => {
  assert.deepEqual(sanitizeShareUpdate(null), {})
  assert.deepEqual(
    sanitizeShareUpdate({
      includeTranscript: 'yes',
      link: 'on',
      expiresInDays: 7,
      meetingId: 'x',
      enable: true
    }),
    { link: 'on', expiresInDays: 7 }
  )
  assert.deepEqual(sanitizeShareUpdate({ includeTranscript: false, expiresInDays: '7' }), {
    includeTranscript: false
  })
})

test('remove does not push and uses the expected request shape', async (t) => {
  const { service, calls } = setup(t, { replies: [{ body: { ok: true, recipients: [] } }] })
  assert.deepEqual(await service.removeShareRecipient(MEETING_ID, recipient.id), { recipients: [] })
  assert.equal(calls[0]!.method, 'DELETE')
  assert.equal(
    calls[0]!.url,
    `${BASE}/api/sync/share/recipients?meetingId=${MEETING_ID}&recipientId=${recipient.id}`
  )
})

test('legacy share keeps the original request shape', async (t) => {
  const { service, calls } = setup(t, { replies: [pushed, { body: serverState }] })
  assert.deepEqual(await service.share(MEETING_ID), { url: serverState.url })
  assert.deepEqual(calls[1]!.body, { meetingId: MEETING_ID, enable: true })
})

test('share state is one read of the share route and never pushes', async (t) => {
  const { service, calls } = setup(t, { replies: [{ body: serverState }] })
  assert.deepEqual(await service.shareState(MEETING_ID), parsedState)
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [['GET', `${BASE}/api/sync/share?meetingId=${MEETING_ID}`]]
  )
})

test('share state: not synced (404) is an empty state, not an error', async (t) => {
  const notSynced = { status: 404, body: { error: 'Meeting not synced yet — sync it first' } }
  const { service } = setup(t, { replies: [notSynced] })
  assert.deepEqual(await service.shareState(MEETING_ID), {
    includeTranscript: false,
    link: null,
    recipients: [],
    workspace: null,
    synced: false
  })
})

test('401, 402, 503 and network failures map to guidance without leaking the token', async (t) => {
  const subscription =
    'Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing'
  const { service, calls } = setup(t, {
    replies: [
      { status: 402, body: { error: subscription, needsSubscription: true } },
      { status: 402, body: { error: subscription, needsSubscription: true } },
      { status: 401, body: { error: 'Invalid sync token' } },
      {
        status: 503,
        body: { error: 'Cloud sync is unavailable because billing is not configured' }
      },
      new TypeError('fetch failed')
    ]
  })
  const state = await service.shareState(MEETING_ID)
  assert.deepEqual(state, { code: 'needs_subscription', error: subscription })
  // A lapsed subscription stops at the push: no share write is attempted.
  const add = await service.updateShareSettings(MEETING_ID, { link: 'on' })
  assert.deepEqual(add, { code: 'needs_subscription', error: subscription })
  assert.equal(calls.at(-1)!.url, `${BASE}/api/sync/push`)
  const unauthorized = await service.shareState(MEETING_ID)
  assert.equal('code' in unauthorized && unauthorized.code, 'unauthorized')
  assert.match((unauthorized as { error: string }).error, /Reconnect it in Settings/)
  const unavailable = await service.updateShareSettings(MEETING_ID, { link: 'off' })
  assert.equal('code' in unavailable && unavailable.code, 'unavailable')
  const offline = await service.updateShareSettings(MEETING_ID, { link: 'off' })
  assert.equal('code' in offline && offline.code, 'network')
  assert.doesNotMatch(
    JSON.stringify([state, add, unauthorized, unavailable, offline]),
    new RegExp(TOKEN)
  )
})
