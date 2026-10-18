import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as host from './cited-ask-host'

test('main renderer owners reject other senders and child frames, retire on reload, and fence old publication', () => {
  const messages: unknown[] = []
  const renderer = {
    id: 1,
    mainFrame: {},
    isDestroyed: () => false,
    send: (...args: unknown[]) => {
      messages.push(args)
    }
  }
  let current: typeof renderer | null = renderer
  const owners = new host.CitedRendererOwners(() => current)
  const event = { sender: renderer, senderFrame: renderer.mainFrame }
  const first = owners.capture(event)
  assert.equal(owners.capture(event).ownerId, first.ownerId)
  assert.throws(() => owners.capture({ ...event, sender: { ...renderer, id: 2 } }), /renderer/)
  assert.throws(() => owners.capture({ ...event, senderFrame: {} }), /frame/)
  owners.publish(first.ownerId, 'synthetic', {})
  assert.equal(messages.length, 1)
  owners.retire(renderer)
  assert.equal(first.signal.aborted, true)
  assert.throws(first.assertCurrent)
  assert.equal(owners.publish(first.ownerId, 'synthetic', {}), false)
  const second = owners.capture(event)
  assert.notEqual(second.ownerId, first.ownerId)
  current = null
  assert.throws(second.assertCurrent)
  assert.equal(owners.publish(second.ownerId, 'synthetic', {}), false)
})

test('invalidation retires consumers synchronously, isolates listener failures/recursion, and awaits only shared producer cleanup', async () => {
  let began!: () => void
  let release!: () => void
  const started = new Promise<void>((r) => {
    began = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const shared = host.createCitedAskHost(
    {
      sources: {
        retrieveEvidence: async () => {
          began()
          await held
          throw new Error('synthetic stopped read')
        },
        validateEvidence: async () => 'valid',
        resolveAcknowledged: async () => ({ status: 'missing' })
      },
      generate: async () => {
        throw new Error('must not generate')
      },
      validateModel: async () => true
    },
    () => null
  )
  let retired = 0
  let recursed = 0
  const unsubscribe = shared.subscribeInvalidation(() => {
    retired++
    throw new Error('synthetic subscriber failure')
  })
  shared.subscribeInvalidation(() => {
    recursed++
    void shared.invalidate()
  })
  shared.subscribeInvalidation(async () => {
    throw new Error('synthetic asynchronous subscriber failure')
  })
  shared.subscribeInvalidation(async () => {
    await new Promise(() => {})
  })
  const run = shared.cited.run(
    { purpose: 'library-ask', selection: { mode: 'question', question: 'Orchid', filters: {} } },
    {
      ownerId: 'owner',
      runId: 'run',
      signal: new AbortController().signal,
      assertCurrent: () => {}
    }
  )
  await started
  let drained = false
  const invalidating = shared.invalidate().then(() => {
    drained = true
  })
  assert.equal(retired, 1)
  assert.equal(recursed, 1)
  await new Promise((r) => setImmediate(r))
  assert.equal(drained, false)
  release()
  await invalidating
  assert.equal((await run).status, 'error')
  unsubscribe()
  await shared.invalidate()
  assert.equal(retired, 1)
  assert.equal(recursed, 2)
})
