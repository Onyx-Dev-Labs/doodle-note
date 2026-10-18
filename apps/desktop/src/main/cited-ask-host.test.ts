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
