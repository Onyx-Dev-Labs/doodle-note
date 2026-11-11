import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  HELPER_PASTE_ESTIMATE_MS,
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

/**
 * The C# helper's own numbers, read from Delivery.cs (not restated here): TypeEstimateMs is
 * `normalized.Length * <perChar> + boundaries * <boundary> + <overhead>`, PasteEstimateMs returns
 * <paste>. The TS estimate must be computed from exactly these.
 */
function csharpEstimate(): { perChar: number; boundary: number; overhead: number; paste: number } {
  const source = readFileSync(
    new URL('../../../../engine/windows/dictation-helper/Delivery.cs', import.meta.url),
    'utf8'
  )
  const typing = /return normalized\.Length \* (\d+) \+ boundaries \* (\d+) \+ (\d+);/.exec(source)
  const paste = /static int PasteEstimateMs \{ get \{ return (\d+); \} \}/.exec(source)
  assert.ok(typing, 'TypeEstimateMs found in Delivery.cs')
  assert.ok(paste, 'PasteEstimateMs found in Delivery.cs')
  return {
    perChar: Number(typing[1]),
    boundary: Number(typing[2]),
    overhead: Number(typing[3]),
    paste: Number(paste[1])
  }
}

test("the TS estimate constants are the C# helper's, read from Delivery.cs", () => {
  const cs = csharpEstimate()
  assert.equal(HELPER_TYPE_PER_CHAR_MS, cs.perChar, 'per character')
  assert.equal(HELPER_TYPE_BOUNDARY_MS, cs.boundary, 'per word boundary')
  assert.equal(HELPER_TYPE_OVERHEAD_MS, cs.overhead, 'fixed overhead')
  assert.equal(HELPER_PASTE_ESTIMATE_MS, cs.paste, 'paste estimate')
})

test('the estimate counts U+0085 (NEL) as a boundary, where JS \\s would not', () => {
  // 36 × U+0085 was the reviewer's counter-example; TS must match the C# count, computed here
  // from the C# constants themselves.
  const cs = csharpEstimate()
  const text = '\u0085'.repeat(36)
  assert.equal(helperDeliverEstimateMs(text), 36 * cs.perChar + 36 * cs.boundary + cs.overhead)
  // A plain word: 5 units, no boundary.
  assert.equal(helperDeliverEstimateMs('hello'), Math.max(cs.paste, 5 * cs.perChar + cs.overhead))
})
