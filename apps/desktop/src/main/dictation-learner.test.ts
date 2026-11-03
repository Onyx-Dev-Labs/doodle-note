import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LearnedPair } from '../shared/dictation-dictionary'
import type { FieldReading } from '../shared/dictation-helper-protocol'
import {
  DictationLearner,
  LEARNER_MAX_MS,
  LEARNER_NOT_SEEN_MS,
  LEARNER_UNFOCUSED_MS
} from './dictation-learner'

function rig(): {
  learner: DictationLearner
  clock: { now: number }
  reading: { value: FieldReading }
  learned: LearnedPair[][]
  stopped: string[]
  running: () => boolean
} {
  const clock = { now: 0 }
  const reading = { value: { state: 'gone' } as FieldReading }
  const learned: LearnedPair[][] = []
  const stopped: string[] = []
  let running = false
  const learner = new DictationLearner({
    read: async () => reading.value,
    stop: (id) => void stopped.push(id),
    now: () => clock.now,
    onLearn: (pairs) => void learned.push(pairs),
    every: () => {
      running = true
      return () => {
        running = false
      }
    }
  })
  return { learner, clock, reading, learned, stopped, running: () => running }
}
const ok = (value: string, focused = true): FieldReading => ({ state: 'ok', value, focused })
const said = 'tell Alec the report is ready'

test('a fix is reported when the message is cleared, and the helper is released', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready')
  await r.learner.tick()
  assert.equal(r.learned.length, 0)
  r.reading.value = ok('')
  await r.learner.tick()
  assert.deepEqual(r.learned, [[{ from: 'Alec', to: 'Alex' }]])
  assert.deepEqual(r.stopped, ['w1'])
  assert.equal(r.running(), false)
  assert.equal(r.learner.watching, false)
})

test('the field disappearing ends the watch with what was fixed', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready')
  await r.learner.tick()
  r.reading.value = { state: 'gone' }
  await r.learner.tick()
  assert.equal(r.learned.length, 1)
})

test('text that never appears in the field is dropped after a few seconds', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('something else entirely')
  await r.learner.tick()
  assert.equal(r.learner.watching, true)
  r.clock.now = LEARNER_NOT_SEEN_MS + 1
  r.reading.value = ok('something else entirely, again')
  await r.learner.tick()
  assert.equal(r.learner.watching, false)
  assert.equal(r.learned.length, 0)
})

test('moving away without sending ends the watch after a while', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready', false)
  await r.learner.tick()
  assert.equal(r.learner.watching, true)
  r.clock.now = LEARNER_UNFOCUSED_MS + 1
  await r.learner.tick()
  assert.equal(r.learner.watching, false)
  assert.equal(r.learned.length, 1)
})

test('coming back to the field restarts the unfocused clock', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok(said, false)
  await r.learner.tick()
  r.clock.now = LEARNER_UNFOCUSED_MS - 1_000
  r.reading.value = ok(said, true)
  await r.learner.tick()
  r.clock.now = LEARNER_UNFOCUSED_MS + 5_000
  r.reading.value = ok(said, true)
  await r.learner.tick()
  assert.equal(r.learner.watching, true)
})

test('a watch ends by itself after the time limit', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready')
  await r.learner.tick()
  r.clock.now = LEARNER_MAX_MS + 1
  await r.learner.tick()
  assert.equal(r.learner.watching, false)
  assert.equal(r.learned.length, 1)
})

test('a password field, an oversized field and a control that will not say are not learned from', async () => {
  for (const state of ['secure', 'too-long'] as const) {
    const r = rig()
    r.learner.start('w1', said)
    r.reading.value = ok('tell Alex the report is ready')
    await r.learner.tick()
    r.reading.value = { state }
    await r.learner.tick()
    assert.equal(r.learner.watching, false, state)
    assert.equal(r.learned.length, 0, state)
  }
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = { state: 'unreadable' }
  await r.learner.tick()
  await r.learner.tick()
  assert.equal(r.learner.watching, true, 'one or two misses are tolerated')
  await r.learner.tick()
  assert.equal(r.learner.watching, false)
  assert.equal(r.learned.length, 0, 'nothing was ever read')
})

test('starting a new watch first reports the old one', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready')
  await r.learner.tick()
  r.learner.start('w2', 'another dictation')
  assert.equal(r.learned.length, 1)
  assert.deepEqual(r.stopped, ['w1'])
  assert.equal(r.learner.watching, true)
})

test('discard learns nothing, and a read that returns after the end is ignored', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok('tell Alex the report is ready')
  await r.learner.tick()
  r.learner.discard()
  assert.equal(r.learned.length, 0)
  await r.learner.tick()
  assert.equal(r.learner.watching, false)
})

test('untouched text teaches nothing even after the message goes', async () => {
  const r = rig()
  r.learner.start('w1', said)
  r.reading.value = ok(said)
  await r.learner.tick()
  r.reading.value = ok('')
  await r.learner.tick()
  assert.equal(r.learned.length, 0)
})
