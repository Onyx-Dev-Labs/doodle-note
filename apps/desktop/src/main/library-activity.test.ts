import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryActivity } from './library-activity'
import { LibraryStorage } from './library-storage'
import { MeetingFileStore } from '@repo/meetings-store'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('transfer drains active saves, queues later writes, and same store writes to the live root', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-live-transfer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'),
    parent = join(root, 'destination')
  mkdirSync(profile)
  mkdirSync(parent)
  const storage = new LibraryStorage(profile)
  const store = new MeetingFileStore(() => join(storage.root, 'meetings'), storage.assertAvailable)
  const gate = new LibraryActivity(),
    saving = deferred(),
    copying = deferred(),
    started = deferred()
  const first = gate.run(async () => {
    await saving.promise
    store.upsert({ id: 'before', title: 'Latest pending edit' })
  })
  const transfer = gate.exclusive(async () => {
    assert.equal(store.get('before')?.title, 'Latest pending edit')
    storage.schedule(parent)
    started.resolve()
    await copying.promise
    await storage.finishPending()
  })
  let queuedRan = false
  const queued = gate.run(() => {
    queuedRan = true
    store.upsert({ id: 'after', title: 'Queued edit' })
  })
  assert.equal(gate.moving, true)
  saving.resolve()
  await first
  await started.promise
  assert.equal(queuedRan, false)
  copying.resolve()
  await transfer
  await queued
  assert.equal(gate.moving, false)
  assert.equal(store.get('before')?.title, 'Latest pending edit')
  assert.equal(store.get('after')?.title, 'Queued edit')
  assert.equal(new MeetingFileStore(join(profile, 'meetings')).get('after'), null)
  assert.match(
    readFileSync(join(storage.root, 'meetings/before.json'), 'utf8'),
    /Latest pending edit/
  )
})

test('failed transfer releases queued work against the original path without swallowing failure', async () => {
  const gate = new LibraryActivity(),
    started = deferred(),
    fail = deferred()
  let path = 'original',
    queuedPath = ''
  const transfer = gate.exclusive(async () => {
    started.resolve()
    await fail.promise
    throw new Error('copy failed')
  })
  await started.promise
  const queued = gate.run(() => {
    queuedPath = path
  })
  fail.resolve()
  await assert.rejects(transfer, /copy failed/)
  await queued
  assert.equal(queuedPath, 'original')
  assert.equal(gate.moving, false)
  await gate.exclusive(async () => {
    path = 'retry'
  })
  assert.equal(path, 'retry')
})

test('busy drain times out without starting a transfer and unblocks queued operations', async () => {
  const gate = new LibraryActivity(),
    active = deferred()
  const work = gate.run(() => active.promise)
  let transferred = false,
    queuedRan = false
  const transfer = gate.exclusive(async () => {
    transferred = true
  }, 10)
  const queued = gate.run(() => {
    queuedRan = true
  })
  await assert.rejects(transfer, /still finishing/)
  await queued
  assert.equal(transferred, false)
  assert.equal(queuedRan, true)
  active.resolve()
  await work
})

test('concurrent transfers are rejected and ordinary operation errors release the drain', async () => {
  const gate = new LibraryActivity(),
    wait = deferred()
  const transfer = gate.exclusive(() => wait.promise)
  await assert.rejects(
    gate.exclusive(async () => {}),
    /already running/
  )
  wait.resolve()
  await transfer
  await assert.rejects(
    gate.run(async () => {
      throw new Error('save error')
    }),
    /save error/
  )
  await gate.exclusive(async () => {})
})
