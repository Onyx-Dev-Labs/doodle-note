import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotesGenerationJobs } from './notes-generation-job'

const identity = { meetingId: 'synthetic-meeting', runId: 'first' }
test('cancellation is scoped to sender, meeting and run; busy persists through cleanup, then retry succeeds', async () => {
  const jobs = new NotesGenerationJobs()
  let cleaned = false
  const work = jobs.run(identity, 1, async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    )
    assert.equal(jobs.busy, true)
    await assert.rejects(
      jobs.run({ ...identity, runId: 'second' }, 1, async () => 'bad'),
      /already/
    )
    cleaned = true
    return 'late result'
  })
  assert.equal(jobs.cancel(identity, 2), false)
  assert.equal(jobs.cancel({ ...identity, meetingId: 'other' }, 1), false)
  assert.equal(jobs.cancel({ ...identity, runId: 'stale' }, 1), false)
  assert.equal(jobs.cancel(identity, 1), true)
  await assert.rejects(work, /canceled/)
  assert.equal(cleaned, true)
  assert.equal(jobs.busy, false)
  assert.equal(await jobs.run({ ...identity, runId: 'retry' }, 1, async () => 'success'), 'success')
  assert.equal(jobs.cancel(identity, 1), false)
})

test('shutdown aborts preparation and waits before disposing the engine', async () => {
  const jobs = new NotesGenerationJobs()
  let cleaned = false
  const work = jobs.run(identity, 1, async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    )
    cleaned = true
  })
  const rejected = assert.rejects(work, /canceled/)
  await jobs.stop()
  assert.equal(cleaned, true)
  assert.equal(jobs.busy, false)
  await rejected
})
