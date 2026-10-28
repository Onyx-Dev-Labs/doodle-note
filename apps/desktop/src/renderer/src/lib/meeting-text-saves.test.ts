import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MeetingTextSaves, type MeetingText } from './meeting-text-saves'
const initial = { title: 'Title', rawNotesMarkdown: 'Notes' }

test('in-flight edits serialize, including reverting a field while an older value saves', async () => {
  let release!: () => void
  const writes: Partial<MeetingText>[] = []
  const saves = new MeetingTextSaves(async (patch) => {
    writes.push(patch)
    if (writes.length === 1)
      await new Promise<void>((r) => {
        release = r
      })
  })
  saves.load(initial)
  saves.edit({ title: 'Changed' })
  const first = saves.flush()
  await Promise.resolve()
  saves.edit({ title: initial.title, rawNotesMarkdown: 'New notes' })
  const second = saves.flush()
  release()
  await Promise.all([first, second])
  assert.deepEqual(writes, [
    { title: 'Changed' },
    { title: initial.title, rawNotesMarkdown: 'New notes' }
  ])
  await saves.flush()
  assert.equal(writes.length, 2)
})

test('synchronous rejection leaves dirty edits retryable and does not strand pending ownership', async () => {
  let fail = true
  const writes: Partial<MeetingText>[] = []
  const saves = new MeetingTextSaves((patch) => {
    if (fail) throw new Error('Unavailable')
    writes.push(patch)
    return Promise.resolve()
  })
  saves.load(initial)
  saves.edit({ title: 'Keep me' })
  await assert.rejects(saves.flush(), /Unavailable/)
  fail = false
  await saves.flush()
  assert.deepEqual(writes, [{ title: 'Keep me' }])
})

test('discard waits for dispatched save, suppresses unsent edits and can resume after deletion failure', async () => {
  let release!: () => void
  const writes: Partial<MeetingText>[] = []
  const saves = new MeetingTextSaves(async (patch) => {
    writes.push(patch)
    if (writes.length === 1)
      await new Promise<void>((r) => {
        release = r
      })
  })
  saves.load(initial)
  saves.edit({ title: 'First' })
  const saving = saves.flush()
  await Promise.resolve()
  saves.edit({ title: 'Unsent' })
  let drained = false
  const discarded = saves.discard().then(() => {
    drained = true
  })
  await Promise.resolve()
  assert.equal(drained, false)
  release()
  await Promise.all([saving, discarded])
  await saves.flush()
  assert.deepEqual(writes, [{ title: 'First' }])
  saves.resume()
  await saves.flush()
  assert.deepEqual(writes, [{ title: 'First' }, { title: 'Unsent' }])
})
