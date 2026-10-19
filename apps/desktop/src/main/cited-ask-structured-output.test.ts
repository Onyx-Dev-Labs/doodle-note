import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parseCitedClaims } from './cited-ask-validation'
import type { EvidenceRange } from '@repo/meetings-store/evidence-contract'

test('immutable native79 outputs retain exactly eight valid and twenty-five rejected verdicts', () => {
  const bytes = readFileSync(
    new URL('../../../../docs/qa/dev507/native-evidence-79e506a.jsonl.gz', import.meta.url)
  )
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb'
  )
  const records = gunzipSync(bytes)
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  let accepted = 0,
    rejected = 0
  for (const r of records) {
    const parse = (): unknown =>
      parseCitedClaims(
        JSON.parse(r.generation.output.rawJson),
        r.generation.output.inclusion.ranges
      )
    if (r.record.status === 'complete') {
      parse()
      accepted++
    } else {
      assert.throws(parse)
      rejected++
    }
  }
  assert.equal(accepted, 8)
  assert.equal(rejected, 25)
})

test('grammar cannot replace strict duplicate, nonblank, UTF16 and citation membership checks', () => {
  const records = gunzipSync(
    readFileSync(
      new URL('../../../../docs/qa/dev507/native-evidence-79e506a.jsonl.gz', import.meta.url)
    )
  )
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const ranges: EvidenceRange[] = records[0].generation.output.inclusion.ranges
  const id = ranges[0]!.id
  const claim = { id: 'claim-1', kind: 'paraphrase', text: 'Supported text', evidenceIds: [id] }
  for (const claims of [
    [claim, claim],
    [{ ...claim, evidenceIds: [id, id] }],
    [{ ...claim, text: '   ' }],
    [{ ...claim, text: '😀'.repeat(2049) }],
    [{ ...claim, evidenceIds: ['not-on-wire'] }],
    [{ ...claim, kind: 'conflict' }]
  ])
    assert.throws(() => parseCitedClaims({ status: 'answered', claims }, ranges))
})
