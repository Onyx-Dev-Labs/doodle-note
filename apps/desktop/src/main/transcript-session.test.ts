import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineEvent } from '../shared/engine-events'
import { TranscriptSession } from './transcript-session'

test('persists refined wording while preserving the live seek anchor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-session-test-'))
  const events: EngineEvent[] = []
  try {
    const session = new TranscriptSession((event) => events.push(event), dir)
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
    session.handle({ event: 'channel_start', channel: 'mic', epochMs: 1_000_000 })
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: 'THE VAUDE CONFIRMATION NUMBER IS SEVEN FOUR NINE'.split(' ').map((word, index) => ({
        token: ` ${word}`,
        startSec: index * 0.3,
        endSec: index * 0.3 + 0.2,
        confidence: 0.8
      }))
    })
    session.handle({
      event: 'refined',
      transcripts: [
        { channel: 'mic', text: 'The final confirmation number is 749.', audioSeconds: 3 }
      ]
    })
    session.handle({ event: 'done' })

    const replacement = events.find((event) => event.event === 'segments-replaced')
    assert.ok(replacement && replacement.event === 'segments-replaced')
    assert.equal(replacement.segments[0]!.text, 'The final confirmation number is 749.')
    assert.equal(replacement.segments[0]!.startMs, 0)
    assert.equal(replacement.segments[0]!.absoluteStartMs, 1_000_000)

    const file = join(dir, readdirSync(dir)[0]!)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      finals: { mic: string }
      segments: Array<{ text: string; startMs: number }>
    }
    assert.equal(saved.finals.mic, 'The final confirmation number is 749.')
    assert.equal(saved.segments[0]!.text, 'The final confirmation number is 749.')
    assert.equal(saved.segments[0]!.startMs, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
