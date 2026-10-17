import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureEventForSession } from './capture-event'

for (const previousCaptureId of [undefined, 'capture-a']) {
  test(`pre-start failures do not inherit the last capture (${previousCaptureId ?? 'first attempt'})`, () => {
    const failure = {
      event: 'spawn-error' as const,
      message: 'Engine is restarting. Try again in a moment.'
    }
    const delivered = captureEventForSession(failure, previousCaptureId)
    assert.equal(delivered?.captureId, undefined)
    assert.equal(delivered?.event, 'spawn-error')
    assert.equal(
      delivered && 'message' in delivered ? delivered.message : undefined,
      failure.message
    )
  })
}

test('explicit capture ownership is still enforced for startup failures', () => {
  const failure = {
    event: 'spawn-error' as const,
    message: 'Delayed failure',
    captureId: 'capture-a'
  }
  assert.equal(captureEventForSession(failure, 'capture-b'), null)
  assert.deepEqual(captureEventForSession(failure, 'capture-a'), failure)
})

test('audio writer diagnostics are allowlisted before leaving main', () => {
  const raw = {
    event: 'status' as const,
    stage: 'audio_save_failed',
    channel: 'mic' as const,
    reason: 'ENOSPC /private/synthetic/recording.caf',
    path: '/private/synthetic'
  }
  assert.deepEqual(captureEventForSession(raw, 'current'), {
    event: 'status',
    stage: 'audio_save_failed',
    channel: 'mic',
    captureId: 'current'
  })
  assert.equal(captureEventForSession({ ...raw, captureId: 'previous' }, 'current'), null)
  assert.equal(
    captureEventForSession({ event: 'status', stage: 'audio_save_failed' }, 'current'),
    null
  )
})
