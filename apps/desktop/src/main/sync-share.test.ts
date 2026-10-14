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
const { SyncService } = require('./sync-service') as typeof import('./sync-service')
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
  includeTranscript: true,
  createdAt: '2026-10-14T12:00:00.000Z'
}
const link = {
  ok: true,
  url: `${BASE}/share/abc`,
  includeTranscript: true,
  expiresAt: '2026-10-21T12:00:00.000Z'
}

test('not linked: every share action returns the guidance and makes no request', async (t) => {
  const { service, calls } = setup(t, { linked: false })
  const results = [
    await service.shareState(MEETING_ID),
    await service.addShareRecipients(MEETING_ID, 'rae@example.test', true),
    await service.removeShareRecipient(MEETING_ID, recipient.id),
    await service.setPublicLink(MEETING_ID, { includeTranscript: true, expiresInDays: 7 }),
    await service.revokePublicLink(MEETING_ID)
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
  const local = await service.addShareRecipients(MEETING_ID, 'rae@example.test', true)
  assert.equal('code' in local && local.code, 'local_only')
  const missing = await service.shareState('00000000-0000-4000-8000-000000000000')
  assert.equal('code' in missing && missing.code, 'not_found')
  assert.equal(calls.length, 0)
})

test('adding recipients pushes first, then posts emails and the transcript choice', async (t) => {
  const { service, calls } = setup(t, {
    replies: [
      pushed,
      { status: 201, body: { ok: true, added: [recipient], recipients: [recipient] } }
    ]
  })
  const result = await service.addShareRecipients(
    MEETING_ID,
    '  rae@example.test, b@x.test ',
    false
  )
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
  assert.deepEqual(calls[1]!.body, {
    emails: 'rae@example.test, b@x.test',
    includeTranscript: false
  })
})

test('empty address input is rejected locally', async (t) => {
  const { service, calls } = setup(t)
  const result = await service.addShareRecipients(MEETING_ID, '   ', true)
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
  assert.deepEqual(await service.addShareRecipients(MEETING_ID, 'rae@example.test', true), {
    code: 'request',
    error: 'Already shared with rae@example.test',
    emails: ['rae@example.test']
  })
})

test('a push rejected for another workspace returns a clear error, never a stale link', async (t) => {
  const rejected = {
    body: { results: [{ id: MEETING_ID, ok: false, error: 'id belongs to another workspace' }] }
  }
  const { service, calls } = setup(t, { replies: [rejected, rejected, rejected] })
  const add = await service.addShareRecipients(MEETING_ID, 'rae@example.test', true)
  const set = await service.setPublicLink(MEETING_ID, {
    includeTranscript: false,
    expiresInDays: 0
  })
  const legacy = await service.share(MEETING_ID)
  for (const result of [add, set]) {
    assert.equal('code' in result && result.code, 'push_rejected')
    assert.match((result as { error: string }).error, /different cloud workspace/)
  }
  assert.ok('error' in legacy && /different cloud workspace/.test(legacy.error))
  // Only the three pushes went out; no share request followed any of them.
  assert.deepEqual(
    calls.map((c) => c.url),
    Array(3).fill(`${BASE}/api/sync/push`)
  )
})

test('public link: pushes, then sends includeTranscript and expiresInDays', async (t) => {
  const { service, calls } = setup(t, { replies: [pushed, { body: link }] })
  const result = await service.setPublicLink(MEETING_ID, {
    includeTranscript: true,
    expiresInDays: 7
  })
  assert.deepEqual(result, {
    link: { url: link.url, includeTranscript: true, expiresAt: link.expiresAt }
  })
  assert.equal(calls[0]!.url, `${BASE}/api/sync/push`)
  assert.equal(calls[1]!.url, `${BASE}/api/sync/share`)
  assert.deepEqual(calls[1]!.body, {
    meetingId: MEETING_ID,
    enable: true,
    includeTranscript: true,
    expiresInDays: 7
  })
})

test('public link rejects an unsupported expiry without a request', async (t) => {
  const { service, calls } = setup(t)
  const result = await service.setPublicLink(MEETING_ID, {
    includeTranscript: false,
    expiresInDays: 3 as 7
  })
  assert.equal('code' in result && result.code, 'request')
  assert.equal(calls.length, 0)
})

test('revoke and remove do not push and use the expected request shapes', async (t) => {
  const { service, calls } = setup(t, {
    replies: [{ body: { ok: true, url: null } }, { body: { ok: true, recipients: [] } }]
  })
  assert.deepEqual(await service.revokePublicLink(MEETING_ID), { link: null })
  assert.deepEqual(await service.removeShareRecipient(MEETING_ID, recipient.id), { recipients: [] })
  assert.deepEqual(calls[0], {
    url: `${BASE}/api/sync/share`,
    method: 'POST',
    authorization: `Bearer ${TOKEN}`,
    body: { meetingId: MEETING_ID, enable: false }
  })
  assert.equal(calls[1]!.method, 'DELETE')
  assert.equal(
    calls[1]!.url,
    `${BASE}/api/sync/share/recipients?meetingId=${MEETING_ID}&recipientId=${recipient.id}`
  )
})

test('legacy share keeps the original request shape', async (t) => {
  const { service, calls } = setup(t, { replies: [pushed, { body: { ok: true, url: link.url } }] })
  assert.deepEqual(await service.share(MEETING_ID), { url: link.url })
  assert.deepEqual(calls[1]!.body, { meetingId: MEETING_ID, enable: true })
})

test('share state reads recipients and link without pushing', async (t) => {
  const { service, calls } = setup(t, {
    replies: [{ body: { recipients: [recipient] } }, { body: link }]
  })
  assert.deepEqual(await service.shareState(MEETING_ID), {
    recipients: [recipient],
    link: { url: link.url, includeTranscript: true, expiresAt: link.expiresAt },
    synced: true
  })
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]).sort(),
    [
      ['GET', `${BASE}/api/sync/share/recipients?meetingId=${MEETING_ID}`],
      ['GET', `${BASE}/api/sync/share?meetingId=${MEETING_ID}`]
    ].sort()
  )
})

test('share state: not synced (404) is an empty state, not an error', async (t) => {
  const notSynced = { status: 404, body: { error: 'Meeting not synced yet — sync it first' } }
  const { service } = setup(t, { replies: [notSynced, notSynced] })
  assert.deepEqual(await service.shareState(MEETING_ID), {
    recipients: [],
    link: null,
    synced: false
  })
})

test('401, 402 and network failures map to guidance without leaking the token', async (t) => {
  const subscription =
    'Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing'
  const { service, calls } = setup(t, {
    replies: [
      { status: 402, body: { error: subscription, needsSubscription: true } },
      { status: 402, body: { error: subscription, needsSubscription: true } },
      { status: 402, body: { error: subscription, needsSubscription: true } },
      { status: 401, body: { error: 'Invalid sync token' } },
      { status: 401, body: { error: 'Invalid sync token' } },
      new TypeError('fetch failed')
    ]
  })
  const state = await service.shareState(MEETING_ID)
  assert.deepEqual(state, { code: 'needs_subscription', error: subscription })
  // A lapsed subscription stops at the push: no share write is attempted.
  const add = await service.addShareRecipients(MEETING_ID, 'rae@example.test', true)
  assert.deepEqual(add, { code: 'needs_subscription', error: subscription })
  assert.equal(calls.at(-1)!.url, `${BASE}/api/sync/push`)
  const unauthorized = await service.shareState(MEETING_ID)
  assert.equal('code' in unauthorized && unauthorized.code, 'unauthorized')
  assert.match((unauthorized as { error: string }).error, /Reconnect it in Settings/)
  const offline = await service.revokePublicLink(MEETING_ID)
  assert.equal('code' in offline && offline.code, 'network')
  assert.doesNotMatch(JSON.stringify([state, add, unauthorized, offline]), new RegExp(TOKEN))
})
