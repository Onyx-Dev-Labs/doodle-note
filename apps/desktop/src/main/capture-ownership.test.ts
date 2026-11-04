import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CaptureOwnership } from './capture-ownership'

test('dictation cannot claim while a meeting holds the sidecar', () => {
  const ownership = new CaptureOwnership()
  const meeting = ownership.claim('meeting', false)
  assert.ok(meeting.ok)
  const dictation = ownership.claim('dictation', true)
  assert.equal(dictation.ok, false)
  assert.equal(dictation.ok === false && dictation.heldBy, 'meeting')
})

test('an untracked live sidecar session still blocks dictation', () => {
  const ownership = new CaptureOwnership()
  assert.equal(ownership.claim('dictation', true).ok, false)
  assert.equal(ownership.owner, null)
})

test('a meeting cannot start over dictation', () => {
  const ownership = new CaptureOwnership()
  assert.ok(ownership.claim('dictation', false).ok)
  const meeting = ownership.claim('meeting', false)
  assert.equal(meeting.ok, false)
  assert.match(meeting.ok === false ? meeting.message : '', /Dictation is using the microphone/)
})

test('a stale lease cannot release a newer claim', () => {
  const ownership = new CaptureOwnership()
  const first = ownership.claim('dictation', false)
  assert.ok(first.ok)
  assert.equal(ownership.release(first.lease), true)
  const second = ownership.claim('dictation', false)
  assert.ok(second.ok)
  assert.equal(ownership.release(first.lease), false, 'old token is ignored')
  assert.equal(ownership.owner, 'dictation')
  assert.equal(ownership.release(second.lease), true)
  assert.equal(ownership.owner, null)
})

test('only one dictation claim at a time', () => {
  const ownership = new CaptureOwnership()
  assert.ok(ownership.claim('dictation', false).ok)
  assert.equal(ownership.claim('dictation', false).ok, false)
})
