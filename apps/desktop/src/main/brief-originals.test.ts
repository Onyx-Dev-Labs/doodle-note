import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import { localSourceScope } from '@repo/meetings-store/sources'
import { CalendarContextStore } from './calendar-context-store'
import { LibraryActivity } from './library-activity'
import { BriefOriginals } from './brief-originals'
const require = createRequire(import.meta.url)
class HeldWorker extends Worker {
  hold = false
  held: unknown[][] = []
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'message' && this.hold && !(args[0] as { ready?: boolean }).ready) {
      this.held.push(args)
      super.emit('held')
      return true
    }
    return super.emit(event, ...args)
  }
  release(): void {
    this.hold = false
    for (const args of this.held.splice(0)) super.emit('message', ...args)
  }
}
function fixture(t: test.TestContext): {
  root: string
  originals: BriefOriginals
  sources: SourceIndexClient
  worker: HeldWorker
  activity: LibraryActivity
  put(id: string, fields?: Record<string, unknown>): void
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-originals-')))
  const meetingsDir = join(root, 'meetings')
  mkdirSync(meetingsDir)
  const scope = localSourceScope(meetingsDir, true)
  const worker = new HeldWorker(
    `require(${JSON.stringify(require.resolve('tsx/cjs'))});require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});`,
    { eval: true, workerData: { meetingsDir, cacheDir: join(root, 'cache') } }
  )
  const sources = new SourceIndexClient(worker, () => ({ meetingsDir, scope, authorized: true }))
  const activity = new LibraryActivity()
  const store = new CalendarContextStore(
    () => root,
    () => {},
    activity
  )
  const originals = new BriefOriginals(store, sources, activity)
  t.after(async () => {
    worker.release()
    await originals.dispose()
    await sources.close()
    await store.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    originals,
    sources,
    worker,
    activity,
    put: (id, fields = {}) =>
      writeFileSync(
        join(meetingsDir, id + '.json'),
        JSON.stringify({
          id,
          title: 'Synthetic original',
          rawNotesMarkdown: 'Orchid decisions',
          ...fields
        })
      )
  }
}
const current = { assertCurrent: () => {} }

test('shared worker supplies eligibility and original date basis, including empty originals; nomination preserves bytes', async (t) => {
  const f = fixture(t)
  f.put('empty', {
    rawNotesMarkdown: '',
    calendarEventId: 'event',
    startedAt: '2020-01-01T00:00:00Z',
    unknown: { retained: true }
  })
  const bytes = readFileSync(join(f.root, 'meetings/empty.json'))
  const original = await f.originals.get('empty', current)
  assert.equal(original?.dateBasis, 'startedAt')
  assert.equal(original?.occurredAt, '2020-01-01T00:00:00.000Z')
  assert.equal(original?.calendarEventId, 'event')
  assert.equal(original?.scope.accountId, null)
  f.originals.assertCurrent(original!)
  f.put('created', { createdAt: '2021-01-01T00:00:00Z' })
  f.put('unknown')
  assert.equal((await f.originals.get('created', current))?.dateBasis, 'createdAt')
  assert.equal((await f.originals.get('unknown', current))?.occurredAt, null)
  assert.equal((await f.originals.list('', current)).length, 3)
  assert.equal((await f.originals.list('Orchid', current)).length, 2)
  assert.deepEqual(readFileSync(join(f.root, 'meetings/empty.json')), bytes)
})

test('missing, wrong scope, trash, malformed and symlink originals cannot become link nominations', async (t) => {
  const f = fixture(t)
  f.put('wrong', { sourceScope: { libraryId: 'other', accountId: null, workspaceId: null } })
  f.put('trash', { trashedAt: '2020-01-01T00:00:00Z' })
  f.put('malformed', { calendarEventId: {} })
  symlinkSync(join(f.root, 'meetings/trash.json'), join(f.root, 'meetings/link.json'))
  for (const id of ['missing', 'wrong', 'trash', 'malformed', 'link'])
    assert.equal(await f.originals.get(id, current), null)
  await assert.rejects(f.originals.list('', current), /unavailable/i)
  assert.equal(f.originals.exists('missing'), false)
  assert.equal(
    f.originals.exists('link'),
    true,
    'unsafe/existing paths must not be labeled new recordings'
  )
  assert.throws(() => f.originals.get('../escape', current))
})

test('original byte changes and library scope changes revoke nominated metadata before persistence', async (t) => {
  const f = fixture(t)
  f.put('a')
  const original = (await f.originals.get('a', current))!
  f.put('a', { unknown: 'changed without changing source projection' })
  assert.throws(() => f.originals.assertCurrent(original), /changed/)
  const next = (await f.originals.get('a', current))!
  writeFileSync(
    join(f.root, 'meetings/.doodlenote-source-library.json'),
    JSON.stringify({ version: 1, libraryId: 'other' })
  )
  assert.throws(() => f.originals.assertCurrent(next), /changed/)
})

test('nomination cancellation retains the library lease until real worker acknowledgement, then prevents late publication', async (t) => {
  const f = fixture(t)
  f.put('a')
  await f.originals.get('a', current)
  f.worker.hold = true
  const held = once(f.worker, 'held')
  const abort = new AbortController()
  const pending = f.originals.get('a', {
    signal: abort.signal,
    assertCurrent: () => abort.signal.throwIfAborted()
  })
  const rejected = assert.rejects(pending, /abort|cancel/i)
  await held
  abort.abort()
  let moved = false
  const moving = f.activity.exclusive(async () => {
    moved = true
  })
  try {
    await new Promise((r) => setImmediate(r))
    assert.equal(moved, false)
  } finally {
    f.worker.release()
  }
  await rejected
  await moving
  assert.equal(moved, true)
})
