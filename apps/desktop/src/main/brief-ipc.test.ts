import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CitedRendererOwners } from './cited-ask-host'
import { installBriefIpc, type BriefCommands, type BriefIpcEvent } from './brief-ipc'
import { BRIEFS_INVOKE } from '../shared/briefs-api'

interface Fixture {
  calls: unknown[][]
  service: BriefCommands
  owners: CitedRendererOwners
  event: BriefIpcEvent
  handlers: Map<string, (event: BriefIpcEvent, request: unknown) => Promise<unknown>>
  install(): () => Promise<void>
  dispose(): Promise<void>
  setEnabled(value: boolean): void
  invoke(request: unknown, event?: BriefIpcEvent): Promise<unknown>
}
function fixture(): Fixture {
  const calls: unknown[][] = []
  const view = { sessionId: 'session', state: 'review-ready' as const }
  const service: BriefCommands = {
    open: async (...args) => {
      calls.push(['open', ...args])
      return view
    },
    select: async () => view,
    refresh: async () => view,
    generate: async () => view,
    edit: async () => view,
    candidates: async () => [],
    link: async () => view,
    previewHistory: async () => ({
      previewId: 'preview',
      revision: 1,
      count: 1,
      firstDate: null,
      lastDate: null
    }),
    applyHistory: async () => view,
    previewForget: async () => ({
      previewId: 'preview',
      revision: 1,
      snapshots: 0,
      people: 0,
      companies: 0,
      changes: 0
    }),
    forget: async () => view,
    citation: async () => ({ status: 'missing', reason: 'missing' }),
    cancel: async (...args) => {
      calls.push(['cancel', ...args])
    },
    close: async () => {},
    closeOwner: async (...args) => {
      calls.push(['closeOwner', ...args])
    }
  }
  const renderer = { id: 1, mainFrame: {}, isDestroyed: () => false, send: () => {} }
  const event = { sender: renderer, senderFrame: renderer.mainFrame }
  const owners = new CitedRendererOwners(() => renderer)
  let enabled = true
  const handlers = new Map<string, (event: BriefIpcEvent, request: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (
      channel: string,
      callback: (event: BriefIpcEvent, request: unknown) => Promise<unknown>
    ) => {
      assert.equal(handlers.has(channel), false)
      handlers.set(channel, callback)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  }
  const install = (): (() => Promise<void>) =>
    installBriefIpc({ ipc, owners, service, enabled: () => enabled })
  const dispose = install()
  return {
    calls,
    service,
    owners,
    event,
    handlers,
    install,
    dispose,
    setEnabled: (value: boolean) => {
      enabled = value
    },
    invoke: (request: unknown, e = event) => handlers.get(BRIEFS_INVOKE)!(e, request)
  }
}
const eventId = `cal2:event:${'a'.repeat(64)}`
const uuid = '11111111-1111-4111-8111-111111111111'

test('brief IPC derives owner from current main frame, gates capability, and rejects forged/extra payload', async () => {
  const f = fixture()
  assert.equal(await f.invoke({ method: 'available', args: [] }), true)
  await f.invoke({ method: 'open', args: [eventId] })
  assert.deepEqual(f.calls[0], ['open', f.owners.capture(f.event).ownerId, eventId])
  for (const request of [
    { method: 'open', args: [eventId], ownerId: 'forged' },
    { method: 'open', args: [eventId, 'forged'] },
    { method: 'open', args: ['arbitrary'] },
    { method: 'generate', args: [uuid, uuid, { meetingIds: [], ownerId: 'forged' }] },
    {
      method: 'edit',
      args: [uuid, 1, { op: 'bind', inviteeId: 'a', personId: null, future: 'yes' }]
    },
    { method: 'constructor', args: [] },
    { method: 'closeOwner', args: ['other'] }
  ])
    await assert.rejects(f.invoke(request), /Invalid/)
  await assert.rejects(
    f.invoke({ method: 'available', args: [] }, { ...f.event, senderFrame: {} }),
    /frame/
  )
  await assert.rejects(
    f.invoke(
      { method: 'available', args: [] },
      { ...f.event, sender: { ...f.event.sender, id: 2 } }
    ),
    /renderer/
  )
  f.setEnabled(false)
  assert.equal(await f.invoke({ method: 'available', args: [] }), false)
  await assert.rejects(f.invoke({ method: 'open', args: [eventId] }), /disabled/)
  assert.equal(f.calls.filter((c) => c[0] === 'open').length, 1)
  await f.dispose()
})

test('retiring an owner closes outstanding work and suppresses its late IPC result', async () => {
  const f = fixture()
  let release!: () => void
  f.service.open = async () => {
    await new Promise<void>((r) => {
      release = r
    })
    return { sessionId: uuid, state: 'ready' }
  }
  const opening = f.invoke({ method: 'open', args: [eventId] })
  const owner = f.owners.capture(f.event).ownerId
  f.owners.retire()
  assert.deepEqual(f.calls, [['closeOwner', owner]])
  release()
  await assert.rejects(opening, /ownership/)
  await f.dispose()
})

test('cancel bypasses a pending request; disposal removes handler and waits for owned cleanup without duplicate subscriptions', async () => {
  const f = fixture()
  let release!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  f.service.open = async () => {
    await held
    return { sessionId: uuid, state: 'ready' }
  }
  const opening = f.invoke({ method: 'open', args: [eventId] })
  await f.invoke({ method: 'cancel', args: [uuid, uuid] })
  assert.equal(f.calls[0]?.[0], 'cancel')
  f.service.closeOwner = async (...args) => {
    f.calls.push(['closeOwner', ...args])
    await held
  }
  let disposed = false
  const disposing = f.dispose().then(() => {
    disposed = true
  })
  assert.equal(f.handlers.size, 0)
  await Promise.resolve()
  assert.equal(disposed, false)
  f.owners.retire()
  assert.equal(f.calls.filter((c) => c[0] === 'closeOwner').length, 1)
  release()
  await assert.rejects(opening)
  await disposing
  const disposeAgain = f.install()
  await f.invoke({ method: 'available', args: [] })
  await disposeAgain()
  assert.equal(f.calls.filter((c) => c[0] === 'closeOwner').length, 2)
})
