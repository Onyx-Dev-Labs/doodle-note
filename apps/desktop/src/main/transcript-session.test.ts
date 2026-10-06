import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineEvent } from '../shared/engine-events'
import { TranscriptSession } from './transcript-session'

test('completion and snapshot carry only an explicit successful refinement, resetting on Resume', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-refinement-status-'))
  const events: EngineEvent[] = []
  try {
    const session = new TranscriptSession((event) => events.push(event), dir)
    session.bindMeeting('synthetic')
    session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'first' })
    session.handle({ event: 'ready' })
    session.handle({
      event: 'refined',
      transcripts: [{ channel: 'mic', text: 'Synthetic refined text.' }]
    })
    assert.equal(
      events.some((event) => event.event === 'capture-finalized'),
      false
    )
    session.handle({ event: 'done' })
    assert.equal((events.at(-1) as { refinement?: string }).refinement, 'refined')
    assert.equal((session.snapshot('synthetic') as { refinement?: string }).refinement, 'refined')
    session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'second' })
    session.handle({ event: 'final', channel: 'mic', text: 'STREAMING ONLY' })
    session.handle({ event: 'refined', transcripts: [{ channel: 'mic', text: '  ' }] })
    session.handle({ event: 'done' })
    assert.equal((events.at(-1) as { refinement?: string }).refinement, undefined)
    assert.equal((session.snapshot('synthetic') as { refinement?: string }).refinement, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed or interrupted refinement explicitly keeps live text without reporting success', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-refinement-fallback-'))
  try {
    for (const interrupted of [false, true]) {
      const events: EngineEvent[] = []
      const session = new TranscriptSession((event) => events.push(event), dir)
      session.bindMeeting('synthetic')
      session.handle({
        event: 'started',
        command: 'live',
        binaryPath: 'test',
        captureId: 'fallback'
      })
      session.handle({
        event: 'timings',
        channel: 'mic',
        tokens: [{ token: 'Live synthetic text.', startSec: 0, endSec: 1, confidence: 1 }]
      })
      if (interrupted) {
        session.handle({ event: 'status', stage: 'refining_transcript' })
        session.handle({ event: 'exit', code: 1, signal: null })
      } else {
        session.handle({
          event: 'error',
          message: 'Refinement unavailable.',
          refinementFailed: true
        })
        session.handle({ event: 'done' })
      }
      assert.equal((events.at(-1) as { refinement?: string }).refinement, 'fallback')
      assert.equal(session.snapshot('synthetic')?.segments[0]?.text, 'Live synthetic text.')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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
    session.bindMeeting('failed-capture')
    session.handle({ event: 'exit', code: 1, signal: null })
    assert.match((events.at(-1) as { error: string }).error, /before finalization/)
    assert.match(session.snapshot('failed-capture')?.error ?? '', /before finalization/)
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
    session.bindMeeting('failed-save')
    assert.match(session.snapshot('failed-save')?.error ?? '', /Failed to save session/)
    assert.equal(
      events.some((event) => event.event === 'session-saved'),
      false
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('main checkpoints and recovers hidden-renderer capture without a subscriber', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-hidden-capture-'))
  const checkpoints: Array<{ text: string; ended: boolean }> = []
  try {
    const session = new TranscriptSession(
      () => {},
      dir,
      () => {},
      (segments, ended) => {
        checkpoints.push({ text: segments.map((s) => s.text).join(' '), ended })
      }
    )
    session.bindMeeting('meeting-a')
    session.handle({
      event: 'started',
      command: 'live',
      binaryPath: 'synthetic',
      captureId: 'capture-a'
    })
    session.handle({ event: 'ready', channels: ['mic'] })
    session.handle({ event: 'partial', channel: 'mic', text: 'A partial' })
    assert.equal(session.snapshot('meeting-b'), null)
    assert.equal(session.snapshot('meeting-a')?.partials.mic, 'A partial')
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Synthetic speech.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'final', channel: 'mic', text: 'Synthetic speech.' })
    assert.ok(checkpoints.some((c) => c.text === 'Synthetic speech.' && !c.ended))
    session.handle({ event: 'done' })
    const snapshot = session.snapshot('meeting-a')!
    assert.equal(snapshot.captureId, 'capture-a')
    assert.equal(snapshot.phase, 'ended')
    assert.deepEqual(snapshot.partials, {})
    assert.equal(snapshot.segments.length, 1)
    assert.equal(checkpoints.at(-1)?.ended, true)
    snapshot.segments.length = 0
    assert.equal(session.snapshot('meeting-a')?.segments.length, 1)
    session.bindMeeting('meeting-b')
    session.handle({
      event: 'started',
      command: 'live',
      binaryPath: 'synthetic',
      captureId: 'capture-b'
    })
    assert.equal(session.snapshot('meeting-a'), null)
    assert.equal(session.snapshot('meeting-b')?.segments.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkpoint failure is reported at finalization while the recovery session survives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-checkpoint-failure-'))
  const events: EngineEvent[] = []
  try {
    const session = new TranscriptSession(
      (event) => events.push(event),
      dir,
      () => {},
      () => {
        throw new Error('synthetic disk failure')
      }
    )
    session.handle({ event: 'started', command: 'live', binaryPath: 'synthetic' })
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Keep this.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'done' })
    assert.ok(events.some((event) => event.event === 'session-saved'))
    assert.match(
      (events.at(-1) as { error: string }).error,
      /Could not save the meeting transcript/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
