import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseByteRange } from './audio-range'

test('no header → whole file', () => {
  assert.equal(parseByteRange(null, 1000), null)
  assert.equal(parseByteRange('', 1000), null)
})

test('malformed headers → whole file', () => {
  assert.equal(parseByteRange('bytes=-500', 1000), null) // suffix form unused by Chromium
  assert.equal(parseByteRange('bytes=a-b', 1000), null)
  assert.equal(parseByteRange('items=0-10', 1000), null)
  assert.equal(parseByteRange('bytes=0-10,20-30', 1000), null) // multi-range unsupported
})

test('open-ended range runs to EOF', () => {
  assert.deepEqual(parseByteRange('bytes=0-', 1000), { start: 0, end: 999 })
  assert.deepEqual(parseByteRange('bytes=400-', 1000), { start: 400, end: 999 })
})

test('bounded range, end clamped to file size', () => {
  assert.deepEqual(parseByteRange('bytes=0-499', 1000), { start: 0, end: 499 })
  assert.deepEqual(parseByteRange('bytes=500-99999', 1000), { start: 500, end: 999 })
})

test('past-EOF start is unsatisfiable', () => {
  assert.equal(parseByteRange('bytes=1000-', 1000), 'unsatisfiable')
  assert.equal(parseByteRange('bytes=5000-6000', 1000), 'unsatisfiable')
})

test('single-byte and final-byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=999-999', 1000), { start: 999, end: 999 })
  assert.deepEqual(parseByteRange('bytes=999-', 1000), { start: 999, end: 999 })
})
