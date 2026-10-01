import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImportJobs, checkImportCanceled } from './import-jobs'
import type { ImportProgress } from '../shared/import-api'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((r) => {
      resolve = r
    }),
    resolve
  }
}
const identity = { kind: 'import' as const, meetingId: 'fixture', label: 'fixture.wav' }

test('cancellation waits for worker exit, rejects a concurrent job and permits retry', async () => {
  const events: ImportProgress[] = []
  const jobs = new ImportJobs((state) => events.push(state))
  const exit = deferred()
  const started = deferred()
  const operation = jobs.run(identity, async ({ signal }) => {
    started.resolve()
    await exit.promise
    checkImportCanceled(signal)
    return 'unexpected'
  })
  const failure = assert.rejects(operation, { name: 'AbortError' })
  await started.promise
  const jobId = jobs.snapshot()!.jobId
  const canceled = jobs.cancel(jobId)
  const again = jobs.cancel(jobId)
  assert.equal(jobs.snapshot()!.stage, 'canceling')
  assert.equal(jobs.busy, true)
  await assert.rejects(
    jobs.run(identity, async () => ''),
    /Another import/
  )
  exit.resolve()
  await failure
  assert.equal((await canceled)?.stage, 'canceled')
  await again
  assert.equal(jobs.busy, false)
  await jobs.run(identity, async ({ commit }) => commit(() => 'saved'))
  assert.notEqual(jobs.snapshot()!.jobId, jobId)
  assert.equal(jobs.snapshot()!.stage, 'completed')
  assert.equal(events.filter((e) => e.jobId === jobId && e.stage === 'canceled').length, 1)
})

test('cancel and multipart failure never replace an existing transcript', async () => {
  const jobs = new ImportJobs(() => {})
  let saved = 'original transcript and notes'
  const exit = deferred()
  const operation = jobs.run({ ...identity, kind: 'retranscribe' }, async ({ signal, commit }) => {
    await exit.promise
    checkImportCanceled(signal)
    return commit(() => {
      saved = 'partial replacement'
    })
  })
  const failure = assert.rejects(operation, { name: 'AbortError' })
  const cancel = jobs.cancel(jobs.snapshot()!.jobId)
  exit.resolve()
  await cancel
  await failure
  assert.equal(saved, 'original transcript and notes')
  await assert.rejects(
    jobs.run({ ...identity, kind: 'retranscribe' }, async ({ commit }) => {
      await Promise.reject(new Error('Part 2 failed'))
      commit(() => {
        saved = 'partial replacement'
      })
    }),
    /Part 2 failed/
  )
  assert.equal(saved, 'original transcript and notes')
  assert.equal(jobs.snapshot()!.stage, 'failed')
})

test('commit wins cancel race truthfully and ignores stale job IDs', async () => {
  const jobs = new ImportJobs(() => {})
  let saved = false
  await jobs.run(identity, async ({ commit }) =>
    commit(() => {
      saved = true
    })
  )
  const completed = jobs.snapshot()!
  assert.equal((await jobs.cancel(completed.jobId))!.stage, 'completed')
  assert.equal(saved, true)
  const exit = deferred()
  const run = jobs.run(identity, async () => {
    await exit.promise
  })
  await jobs.cancel(completed.jobId)
  assert.equal(jobs.snapshot()!.stage, 'starting')
  exit.resolve()
  await run
})

test('snapshot survives subscribers and progress is bounded, terminal occurs once', async () => {
  const events: ImportProgress[] = []
  const jobs = new ImportJobs((state) => events.push(state))
  await jobs.run(identity, async ({ progress }) => {
    progress('downloading_model', 2)
    assert.equal(jobs.snapshot()!.progress, 1)
    progress('transcribing')
    assert.equal(jobs.snapshot()!.progress, undefined)
  })
  assert.equal(events.filter((e) => e.stage === 'completed').length, 1)
  assert.ok(events.every((event, i) => i === 0 || event.revision > events[i - 1]!.revision))
  const copy = jobs.snapshot()!
  copy.stage = 'failed'
  assert.equal(jobs.snapshot()!.stage, 'completed')
})
