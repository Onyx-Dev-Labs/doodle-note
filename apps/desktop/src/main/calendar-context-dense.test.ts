import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { localSourceScope } from '@repo/meetings-store/sources'
import { CalendarContextStore, CONTEXT_FILE, CONTEXT_MAX_BYTES } from './calendar-context-store'
import { validateContextFileAsync } from './calendar-context-validation'
import { denseCalendarContext } from './test-fixtures/calendar-context'
import { LibraryActivity } from './library-activity'

test('dense known history yields during strict validation; a last-record invalid reference is still rejected', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-dense-test-')))
  mkdirSync(join(root, 'meetings'))
  const scope = localSourceScope(join(root, 'meetings'), true)
  const store = new CalendarContextStore(
    () => root,
    () => {},
    new LibraryActivity()
  )
  t.after(async () => {
    await store.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const data = denseCalendarContext(scope, 6000)
  const raw = JSON.stringify(data)
  assert.ok(Buffer.byteLength(raw) < CONTEXT_MAX_BYTES)
  const path = join(root, CONTEXT_FILE)
  writeFileSync(path, raw)
  let last = performance.now()
  const gaps: number[] = []
  const timer = setInterval(() => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }, 1)
  try {
    const read = await store.read({ assertCurrent: () => {} })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(read.changes.length, 6000)
    assert.ok(gaps.length > 3, 'callbacks must run during dense validation')
    assert.ok(Math.max(...gaps) < 250, `material main stall: ${Math.max(...gaps)}ms`)
    // Check the tail too: yielding does not drop records or weaken reference validation.
    const payload = data.changes.at(-1)!.payload
    assert.equal(payload.op, 'link-meeting')
    if (payload.op === 'link-meeting') payload.snapshotId = '11111111-1111-1111-1111-111111111111'
    const corrupt = JSON.stringify(data)
    writeFileSync(path, corrupt)
    await assert.rejects(store.read({ assertCurrent: () => {} }), /reference/)
    assert.equal(readFileSync(path, 'utf8'), corrupt)
  } finally {
    clearInterval(timer)
  }
})
test('a cancellation delivered during dense validation stops before any publication', async () => {
  const data = denseCalendarContext(
    { libraryId: 'synthetic', accountId: null, workspaceId: null },
    6000
  )
  let cancelled = false
  const immediate = setImmediate(() => {
    cancelled = true
  })
  try {
    await assert.rejects(
      validateContextFileAsync(data, data.scope, () => {
        if (cancelled) throw new Error('cancelled')
      }),
      /cancelled/
    )
  } finally {
    clearImmediate(immediate)
  }
})
