import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordingElapsed, recordingTrayTitle } from './recording-indicator-logic'

test('recordingElapsed formats seconds, minutes and hours', () => {
  assert.equal(recordingElapsed(0), '0:00')
  assert.equal(recordingElapsed(7_000), '0:07')
  assert.equal(recordingElapsed(754_000), '12:34')
  assert.equal(recordingElapsed(3_725_000), '1:02:05')
})

test('recordingElapsed never goes negative on clock skew', () => {
  assert.equal(recordingElapsed(-5_000), '0:00')
})

test('recordingTrayTitle carries the always-red dot', () => {
  assert.equal(recordingTrayTitle(61_000), '🔴 1:01')
})
