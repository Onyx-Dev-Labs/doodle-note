import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  HELPER_TYPE_BOUNDARY_MS,
  HELPER_TYPE_OVERHEAD_MS,
  HELPER_TYPE_PER_CHAR_MS,
  helperDeliverEstimateMs,
  isTypingBoundaryUnit
} from '../shared/dictation-helper-protocol'

/**
 * The reference bitset is the C# helper's own classification (char.IsWhiteSpace || char.IsPunctuation)
 * for every BMP code unit, captured on Dev04 via the __boundary-table test op. This test proves the
 * TS predicate used to size the deliver deadline agrees with .NET code unit for code unit, so a
 * transcript can never be under-budgeted (which would surface as a false deadline-exceeded).
 */
const bits = readFileSync(
  new URL('./dotnet-boundary-bmp.base64.txt', import.meta.url),
  'utf8'
).trim()
const table = Buffer.from(bits, 'base64')

test('the TS typing-boundary predicate matches .NET for every BMP code unit', () => {
  assert.equal(table.length, 8192, 'the reference covers all 65536 code units')
  let mismatches = 0
  let firstMismatch = -1
  for (let cu = 0; cu <= 0xffff; cu++) {
    const expected = (table[cu >> 3] & (1 << (cu & 7))) !== 0
    if (isTypingBoundaryUnit(cu) !== expected) {
      mismatches++
      if (firstMismatch < 0) firstMismatch = cu
    }
  }
  assert.equal(
    mismatches,
    0,
    `${mismatches} code units disagree with .NET (first U+${firstMismatch.toString(16).toUpperCase().padStart(4, '0')})`
  )
})

test('the estimate counts U+0085 (NEL) as a boundary, where JS \\s would not', () => {
  // 36 × U+0085 was the reviewer's counter-example; TS must match the C# count.
  const text = '\u0085'.repeat(36)
  // 36 units × the per-character cost + 36 boundaries × the boundary pause + the fixed overhead,
  // exactly as Delivery.cs TypeEstimateMs computes it (the constants mirror the C# values).
  assert.equal(
    helperDeliverEstimateMs(text),
    36 * HELPER_TYPE_PER_CHAR_MS + 36 * HELPER_TYPE_BOUNDARY_MS + HELPER_TYPE_OVERHEAD_MS
  )
})
