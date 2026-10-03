import assert from 'node:assert/strict'
import test from 'node:test'
import { autoGenerateNotesAfterStop, MeetingGeneration } from '../shared/auto-notes'

test('failed startup completes without arming automatic notes or blocking a retry', () => {
  const lane = new MeetingGeneration()
  lane.startCapture('denied')
  assert.equal(lane.finalize('System audio access is off.', 'denied'), true)
  assert.equal(lane.takeAutomatic(), null)
  assert.ok(lane.begin(), 'manual notes remain available')
})

test('fresh and upgraded preferences default on; explicit off survives JSON reload', () => {
  for (const value of [undefined, null, true, 'false', 0]) {
    assert.equal(autoGenerateNotesAfterStop(value), true)
  }
  for (const value of [true, false]) {
    const stored = JSON.parse(JSON.stringify({ autoGenerateNotesAfterStop: value }))
    assert.equal(autoGenerateNotesAfterStop(stored.autoGenerateNotesAfterStop), value)
  }
})

test('manual and detected stops only arm generation after finalization, exactly once', () => {
  for (const route of ['manual', 'detected']) {
    const lane = new MeetingGeneration()
    lane.startCapture()
    lane.markReady()
    assert.equal(lane.takeAutomatic(), null, route)
    assert.equal(lane.begin(), null, 'cannot generate during capture/finalization')
    lane.finalize()
    lane.finalize()
    assert.deepEqual(lane.takeAutomatic(), {})
    assert.equal(lane.takeAutomatic(), null)
    const run = lane.begin()!
    assert.ok(run)
    assert.equal(lane.begin(), null, 'concurrent manual click is suppressed')
    lane.finish(run)
    lane.finalize()
    assert.equal(lane.takeAutomatic(), null, 'duplicate completion never re-arms')
    assert.ok(lane.begin(), 'explicit regeneration remains available')
  }
})

test('manual generation wins the completion race without a later automatic duplicate', () => {
  const lane = new MeetingGeneration()
  lane.startCapture()
  lane.markReady()
  lane.finalize()
  const manual = lane.begin()!
  assert.ok(manual)
  assert.equal(lane.takeAutomatic(), null)
  lane.finish(manual)
  assert.equal(lane.takeAutomatic(), null)
})

test('skipped or failed attempts are consumed rather than waiting for settings changes', () => {
  for (const reason of ['empty transcript', 'missing model', 'disabled', 'provider failed']) {
    const lane = new MeetingGeneration()
    lane.startCapture()
    lane.markReady()
    lane.finalize()
    assert.ok(lane.takeAutomatic(), reason)
    assert.equal(lane.takeAutomatic(), null)
  }
  const lane = new MeetingGeneration()
  lane.startCapture()
  lane.markReady()
  lane.finalize('Transcript could not be saved')
  assert.deepEqual(lane.takeAutomatic(), { error: 'Transcript could not be saved' })
  assert.equal(lane.takeAutomatic(), null)
})

test('Resume, newer edits and unmount invalidate in-flight results without unlocking a running provider', () => {
  for (const change of ['resume', 'edit', 'unmount']) {
    const lane = new MeetingGeneration()
    lane.startCapture()
    lane.markReady()
    lane.finalize()
    const run = lane.begin()!
    assert.equal(lane.isCurrent(run), true)
    if (change === 'resume') lane.startCapture()
    else if (change === 'edit') lane.edit()
    else lane.invalidate()
    assert.equal(lane.isCurrent(run), false, change)
    assert.equal(lane.begin(), null, 'old provider still owns the lock')
    lane.finish(run)
    if (change === 'resume') lane.finalize()
    assert.ok(lane.begin(), 'manual recovery is available')
  }
})

test('new capture cancels a pending completion before any AI request begins', () => {
  const lane = new MeetingGeneration()
  lane.startCapture()
  lane.markReady()
  lane.finalize()
  lane.startCapture()
  lane.markReady()
  assert.equal(lane.takeAutomatic(), null)
  assert.equal(lane.begin(), null)
})

test('a delayed completion for an earlier capture cannot finish a resumed capture', () => {
  const lane = new MeetingGeneration()
  lane.startCapture('old')
  lane.markReady()
  lane.startCapture('new')
  lane.markReady()
  assert.equal(lane.finalize(undefined, 'old'), false)
  assert.equal(lane.takeAutomatic(), null)
  assert.equal(lane.begin(), null)
  assert.equal(lane.finalize(undefined, 'new'), true)
  assert.ok(lane.takeAutomatic())
})

test('readiness resets on Resume; denied retry cannot summarize the previous recording', () => {
  const lane = new MeetingGeneration()
  lane.startCapture('first')
  lane.markReady()
  lane.finalize(undefined, 'first')
  assert.deepEqual(lane.takeAutomatic(), {})
  lane.startCapture('retry')
  lane.finalize('Microphone access is off.', 'retry')
  assert.equal(lane.takeAutomatic(), null)
  lane.startCapture('recovered')
  lane.markReady()
  lane.finalize(undefined, 'recovered')
  assert.deepEqual(lane.takeAutomatic(), {})
})
