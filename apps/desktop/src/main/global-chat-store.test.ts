import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storeModule from './global-chat-store'
const entry = {
  question: 'Synthetic question',
  answer: 'Legacy answer',
  askedAt: '2026-10-18T00:00:00Z'
}
function fixture(t: test.TestContext): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'dev507-chat-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, path: join(root, 'global-chat.json') }
}
test('atomic append preserves legacy entries and unknown richer fields; clear advances epoch and blocks late append', (t) => {
  const f = fixture(t)
  writeFileSync(f.path, JSON.stringify([{ ...entry, unknown: { retained: true } }]))
  assert.equal(typeof storeModule.GlobalChatStore, 'function')
  const store = new storeModule.GlobalChatStore(
    () => f.path,
    () => {}
  )
  const epoch = store.epoch()
  store.append({ ...entry, id: 'run' }, epoch)
  assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8'))[0].unknown, { retained: true })
  store.clear()
  assert.throws(() => store.append(entry, epoch), /changed|cleared/)
  assert.deepEqual(store.read(), [])
})
test('corrupt and unsupported richer history block overwrite and preserve exact bytes', (t) => {
  const f = fixture(t)
  const store = new storeModule.GlobalChatStore(
    () => f.path,
    () => {}
  )
  for (const text of [
    '{',
    '{}',
    JSON.stringify([{ ...entry, citedAnswer: { version: 99 } }]),
    JSON.stringify([{ ...entry, citedAnswer: { version: 1 } }])
  ]) {
    writeFileSync(f.path, text)
    assert.throws(() => store.read())
    assert.throws(() => store.append(entry, store.epoch()))
    assert.throws(() => store.clear())
    assert.equal(readFileSync(f.path, 'utf8'), text)
  }
})
test('rename/fsync failure surfaces an error and leaves prior history bytes intact', (t) => {
  const f = fixture(t)
  writeFileSync(f.path, JSON.stringify([entry]))
  const before = readFileSync(f.path)
  const store = new storeModule.GlobalChatStore(
    () => f.path,
    () => {},
    {
      rename: () => {
        throw new Error('synthetic rename failure')
      }
    }
  )
  assert.throws(() => store.append(entry, store.epoch()), /rename/)
  assert.deepEqual(readFileSync(f.path), before)
  const syncFailed = new storeModule.GlobalChatStore(
    () => f.path,
    () => {},
    {
      fsync: () => {
        throw new Error('synthetic fsync failure')
      }
    }
  )
  assert.throws(() => syncFailed.append(entry, syncFailed.epoch()), /fsync/)
  assert.deepEqual(readFileSync(f.path), before)
})
test('duplicate run IDs are idempotent and relocation invalidates an old write epoch', (t) => {
  const f = fixture(t)
  let path = f.path
  const store = new storeModule.GlobalChatStore(
    () => path,
    () => {}
  )
  store.append({ ...entry, id: 'run' }, store.epoch())
  store.append({ ...entry, id: 'run' }, store.epoch())
  assert.equal(store.read().length, 1)
  assert.throws(
    () => store.append({ ...entry, id: 'run', question: 'different' }, store.epoch()),
    /run ID/
  )
  const epoch = store.epoch()
  renameSync(f.path, join(f.root, 'moved.json'))
  path = join(f.root, 'moved.json')
  assert.throws(() => store.append(entry, epoch), /changed|cleared/)
  assert.equal(store.read().length, 1)
})
