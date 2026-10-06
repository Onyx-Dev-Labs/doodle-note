import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecordingStopCoordinator } from './recording-stop-coordinator'

test('main owns one capture-specific Stop independent of any editor listener', () => {
  let stopped = 0
  const coordinator = new RecordingStopCoordinator(
    () => {
      stopped++
    },
    () => {}
  )
  coordinator.begin('first', 'meeting')
  assert.equal(coordinator.request('meeting-ended', 'first'), true)
  assert.equal(stopped, 1)
  assert.equal(coordinator.snapshot()?.phase, 'requested')
  assert.equal(coordinator.request('manual', 'first'), false)
  assert.equal(coordinator.request('meeting-ended', 'first'), false)
  assert.equal(stopped, 1)
  coordinator.handle({ event: 'status', stage: 'capture_stopped' })
  assert.equal(coordinator.snapshot()?.phase, 'stopped')
  coordinator.handle({ event: 'done' })
  assert.equal(coordinator.snapshot()?.phase, 'completed')
  coordinator.begin('second', 'meeting')
  assert.equal(coordinator.request('meeting-ended', 'first'), false)
  assert.equal(stopped, 1)
  assert.equal(coordinator.request('manual', 'second'), true)
  assert.equal(stopped, 2)
})

test('stop and finalization failures never announce successful automatic completion', () => {
  const coordinator = new RecordingStopCoordinator(
    () => {
      throw Error('synthetic')
    },
    () => {}
  )
  coordinator.begin('first', 'meeting')
  coordinator.request('meeting-ended', 'first')
  assert.equal(coordinator.snapshot()?.phase, 'failed')
  coordinator.handle({ event: 'done' })
  assert.equal(coordinator.snapshot()?.phase, 'failed')
  const recover = new RecordingStopCoordinator(
    () => {},
    () => {}
  )
  recover.begin('second', 'meeting')
  recover.request('meeting-ended', 'second')
  recover.handle({ event: 'error', message: 'synthetic refinement failure' })
  recover.handle({ event: 'done' })
  recover.handle({ event: 'exit', code: 0, signal: null })
  assert.equal(recover.snapshot()?.phase, 'failed')
})

test('unexpected engine exit is actionable and no early completion is inferred from finishing', () => {
  const coordinator = new RecordingStopCoordinator(
    () => {},
    () => {}
  )
  coordinator.begin('first', 'meeting')
  coordinator.request('meeting-ended', 'first')
  coordinator.handle({ event: 'status', stage: 'finishing' })
  assert.equal(coordinator.snapshot()?.phase, 'requested')
  coordinator.handle({ event: 'exit', code: 1, signal: null })
  assert.equal(coordinator.snapshot()?.phase, 'failed')
})

test('manual Stop can retry a thrown stop request but cannot restart a completed capture', () => {
  let calls = 0
  const coordinator = new RecordingStopCoordinator(
    () => {
      if (++calls === 1) throw Error('synthetic')
    },
    () => {}
  )
  coordinator.begin('first', 'meeting')
  coordinator.request('meeting-ended', 'first')
  assert.equal(coordinator.request('manual', 'first'), true)
  assert.equal(calls, 2)
  coordinator.handle({ event: 'done' })
  assert.equal(coordinator.request('manual', 'first'), false)
})

test('persisted transcript failure cannot announce success and stale capture finalization is ignored', () => {
  const coordinator = new RecordingStopCoordinator(
    () => {},
    () => {}
  )
  coordinator.begin('second', 'meeting')
  coordinator.request('meeting-ended', 'second')
  coordinator.handle({ event: 'capture-finalized', captureId: 'first', error: 'stale failure' })
  assert.equal(coordinator.snapshot()?.phase, 'requested')
  coordinator.handle({
    event: 'capture-finalized',
    captureId: 'second',
    error: 'synthetic disk error'
  })
  coordinator.handle({ event: 'done' })
  assert.equal(coordinator.snapshot()?.phase, 'failed')
})
