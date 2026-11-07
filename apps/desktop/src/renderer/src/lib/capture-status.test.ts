import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCaptureStatus, captureNotices } from './capture-status'

const starting = (): Parameters<typeof applyCaptureStatus>[0] => ({
  phase: 'starting' as const,
  statusText: 'Starting…',
  transcribing: false
})

test('authorized startup and legacy success events never imply permission waiting or readiness', () => {
  let state: Parameters<typeof applyCaptureStatus>[0] = starting()
  for (const stage of ['system_backend', 'starting_capture', 'permission_granted', 'aec_enabled']) {
    state = applyCaptureStatus(state, { event: 'status', stage })
    assert.equal(state.phase, 'starting')
    assert.equal(state.statusText, 'Starting…')
    assert.equal(state.transcribing, false)
  }
})

test('first-use consent has actionable, platform-neutral copy and clears after authorization', () => {
  for (const permission of ['microphone', 'system_audio', 'screen_system_audio', undefined]) {
    const waiting = applyCaptureStatus(starting(), {
      event: 'status',
      stage: 'requesting_permission',
      permission
    })
    assert.match(waiting.statusText, /^Allow .* access to start recording/)
    assert.doesNotMatch(waiting.statusText, /macOS|_/)
    const granted = applyCaptureStatus(waiting, { event: 'status', stage: 'permission_granted' })
    assert.equal(granted.statusText, 'Starting…')
    assert.equal(granted.phase, 'starting')
  }
})

test('diagnostics cannot replace model loading, finishing or permission recovery', () => {
  const loading = applyCaptureStatus(starting(), { event: 'status', stage: 'loading_models' })
  assert.equal(loading.statusText, 'Preparing transcription…')
  for (const stage of [
    'system_backend',
    'input_default_fallback',
    'future_internal_stage',
    undefined
  ]) {
    assert.equal(applyCaptureStatus(loading, { event: 'status', stage }), loading)
  }
  const failure = { ...starting(), error: 'Microphone permission denied. Open System Settings…' }
  assert.equal(
    applyCaptureStatus(failure, { event: 'status', stage: 'starting_capture' }).error,
    failure.error
  )
  const finishing = applyCaptureStatus(loading, { event: 'status', stage: 'finishing' })
  assert.equal(finishing.phase, 'finishing')
  assert.equal(finishing.statusText, 'Finishing up…')
  for (const stage of [
    'permission_granted',
    'requesting_permission',
    'starting_capture',
    'loading_models',
    'unknown'
  ]) {
    assert.equal(applyCaptureStatus(finishing, { event: 'status', stage }), finishing)
  }
})

test('Windows model preparation and refinement remain explicit without macOS terminology', () => {
  for (const stage of ['downloading_model', 'extracting_model', 'serve_loading_models']) {
    const state = applyCaptureStatus(starting(), { event: 'status', stage })
    assert.match(state.statusText, /transcription/)
    assert.doesNotMatch(state.statusText, /permission|macOS|_/)
    assert.equal(state.phase, 'starting')
  }
  const recording = { phase: 'recording' as const, statusText: '', transcribing: false }
  const transcribing = applyCaptureStatus(recording, { event: 'status', stage: 'transcribing' })
  assert.equal(transcribing.transcribing, true)
  assert.equal(transcribing.statusText, '')
})

test('the Windows captions-delayed warning is shown while late and cleared when caught up', () => {
  const recording = { phase: 'recording' as const, statusText: '', transcribing: true }
  assert.deepEqual(captureNotices(recording), [])
  const delayed = applyCaptureStatus(recording, { event: 'status', stage: 'captions_delayed' })
  assert.equal(delayed.phase, 'recording')
  // The recorder shows the clock, not statusText, while recording: the warning
  // must come from captureNotices or it is invisible.
  assert.equal(delayed.statusText, '')
  assert.match(captureNotices(delayed).join(' '), /running behind/)
  const caughtUp = applyCaptureStatus(delayed, { event: 'status', stage: 'captions_caught_up' })
  assert.deepEqual(captureNotices(caughtUp), [])
  // Re-arms: a second slow stretch shows it again.
  const again = applyCaptureStatus(caughtUp, { event: 'status', stage: 'captions_delayed' })
  assert.match(captureNotices(again).join(' '), /running behind/)
  assert.deepEqual(captureNotices({ ...again, phase: 'ended' }), [])
})

test('a capture on the previous speech model says so honestly', () => {
  const recording = { phase: 'recording' as const, statusText: '', transcribing: true }
  const legacy = applyCaptureStatus(recording, { event: 'status', stage: 'legacy_model' })
  assert.match(
    captureNotices(legacy).join(' '),
    /previous speech model while the new one downloads/
  )
  // After the background download fails, the notice no longer claims it is downloading.
  const failed = applyCaptureStatus(legacy, { event: 'status', stage: 'model_download_failed' })
  assert.doesNotMatch(captureNotices(failed).join(' '), /while the new one downloads/)
  assert.match(captureNotices(failed).join(' '), /could not be downloaded/)
  const startedFailed = applyCaptureStatus(recording, {
    event: 'status',
    stage: 'legacy_model',
    download: 'failed'
  })
  assert.match(captureNotices(startedFailed).join(' '), /could not be downloaded/)
})

test('idle and completed sessions ignore delayed status events', () => {
  for (const phase of ['idle', 'ended'] as const) {
    const state = { ...starting(), phase, statusText: '' }
    for (const stage of [
      'requesting_permission',
      'permission_granted',
      'transcribing',
      'finishing'
    ]) {
      assert.equal(applyCaptureStatus(state, { event: 'status', stage }), state)
    }
  }
})

test('channel warnings survive lifecycle copy without stopping transcription or trusting diagnostics', () => {
  let state: Parameters<typeof applyCaptureStatus>[0] = {
    phase: 'recording',
    statusText: '',
    transcribing: true,
    captureId: 'current'
  }
  const stale = {
    event: 'status' as const,
    stage: 'audio_save_failed',
    channel: 'mic' as const,
    captureId: 'previous'
  }
  assert.equal(applyCaptureStatus(state, stale), state)
  for (const channel of ['mic', 'system'] as const) {
    state = applyCaptureStatus(state, { ...stale, channel, captureId: 'current' })
    assert.equal(state.phase, 'recording')
    assert.equal(state.transcribing, true)
    assert.equal(state.savedAudioFailures?.[channel], true)
  }
  for (const stage of ['transcribing', 'saving_audio', 'captions_delayed', 'audio_saved']) {
    state = applyCaptureStatus(state, { event: 'status', stage, captureId: 'current' })
    assert.deepEqual(state.savedAudioFailures, { mic: true, system: true })
  }
  const ended = { ...state, phase: 'ended' as const }
  assert.equal(applyCaptureStatus(ended, { ...stale, captureId: 'current' }), ended)
})
