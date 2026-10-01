import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { batchChannelsForPart } from './import-channels'
import { assembleBatchTokens } from './import-logic'
import type { EngineTokenTiming } from '../shared/engine-events'

function words(text: string, offset = 0): EngineTokenTiming[] {
  return text.split(' ').map((token, index) => ({
    token: ` ${token}`,
    startSec: offset + index * 0.3,
    endSec: offset + index * 0.3 + 0.2,
    confidence: 0.95
  }))
}

test('batch echoes are suppressed for either event order including long recordings', () => {
  for (const order of [
    ['mic', 'system'],
    ['system', 'mic']
  ] as const) {
    const tokens = { mic: [] as EngineTokenTiming[], system: [] as EngineTokenTiming[] }
    for (const ch of order) tokens[ch].push(...words('We should review the budget together'))
    tokens.system.push(...words('The meeting is now finished', 7200))
    const result = assembleBatchTokens(tokens, 'split')
    assert.equal(result.find((s) => s.channel === 'mic')?.echo, true)
    assert.equal(result.filter((s) => !s.echo).length, 2)
  }
})

test('distinct overlapping speech and later repeated phrases remain', () => {
  const result = assembleBatchTokens(
    {
      mic: [
        ...words('The invoices went out yesterday'),
        ...words('We should review the budget together', 20)
      ],
      system: words('We should review the budget together')
    },
    'split'
  )
  assert.equal(result.length, 3)
  assert.ok(result.every((s) => !s.echo))
})

test('mixed audio has a neutral speaker instead of inventing You and Them', () => {
  const result = assembleBatchTokens({ mic: words('Some imported words'), system: [] }, 'mixed')
  assert.equal(result[0]?.speaker, 'Speaker')
  assert.equal(result[0]?.speakerId, 'imported-speaker')
})

test('part provenance preserves mixed imports and known captures with safe legacy fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-channel-policy-'))
  try {
    assert.equal(batchChannelsForPart(dir), 'mixed')
    writeFileSync(join(dir, 'part.json'), '{corrupt')
    assert.equal(batchChannelsForPart(dir), 'mixed')
    mkdirSync(join(dir, 'checkpoints'))
    assert.equal(batchChannelsForPart(dir), 'split')
    writeFileSync(join(dir, 'part.json'), JSON.stringify({ channels: 'mixed' }))
    assert.equal(batchChannelsForPart(dir), 'mixed')
    writeFileSync(join(dir, 'part.json'), JSON.stringify({ channels: 'split' }))
    assert.equal(batchChannelsForPart(dir), 'split')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
