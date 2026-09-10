import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

    assert.equal(events.at(-1)?.event, 'capture-finalized')
    session.handle({ event: 'done' })
    session.handle({ event: 'exit', code: 0, signal: null })
    assert.equal(events.filter((event) => event.event === 'capture-finalized').length, 1)
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

test('empty successful capture emits a terminal completion without waiting for transcript', () => {
  const events: EngineEvent[] = []
  const session = new TranscriptSession((event) => events.push(event), 'unused-empty-session')
  session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
  session.handle({ event: 'done' })
  assert.deepEqual(events, [{ event: 'capture-finalized' }])
})

test('abnormal exit preserves available transcript but does not report successful finalization', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-session-exit-'))
  const events: EngineEvent[] = []
  try {
    const session = new TranscriptSession((event) => events.push(event), dir)
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
    session.handle({ event: 'exit', code: 1, signal: null })
    assert.match((events.at(-1) as { error: string }).error, /before finalization/)
    session.handle({ event: 'done' })
    assert.equal(events.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session persistence failure produces an explicit failed completion after flushed segments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-session-failure-'))
  const events: EngineEvent[] = []
  try {
    const blocked = join(dir, 'file-not-directory')
    writeFileSync(blocked, 'synthetic fixture')
    const session = new TranscriptSession((event) => events.push(event), blocked)
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Test.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'done' })
    assert.ok(events.some((event) => event.event === 'segments'))
    assert.match((events.at(-1) as { error: string }).error, /Failed to save session/)
    assert.equal(
      events.some((event) => event.event === 'session-saved'),
      false
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
