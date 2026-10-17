import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureEventForSession } from './capture-event'

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
