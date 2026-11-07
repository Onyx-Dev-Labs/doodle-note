import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineEvent, EngineTokenTiming } from '../shared/engine-events'
import { TranscriptSession } from './transcript-session'

test('a pending meeting cannot take ownership of an empty ended capture', () => {
  const session = new TranscriptSession(() => {}, 'unused-empty-session')
  session.bindMeeting('a')
  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'capture-a' })
  session.handle({ event: 'status', stage: 'audio_save_failed', channel: 'mic' })
  session.handle({ event: 'done' })
  const ended = session.snapshot('a')!
  assert.deepEqual(ended.segments, [])
  assert.deepEqual(ended.savedAudioFailures, { mic: true })

  session.bindMeeting('b')
  session.handle({ event: 'spawn-error', message: 'Worker restarting' })
  assert.equal(session.snapshot('b'), null)
  assert.deepEqual(session.snapshot('a'), ended)

  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'capture-b' })
  session.handle({
    event: 'status',
    stage: 'audio_save_failed',
    channel: 'system',
    captureId: 'capture-a'
  })
  session.handle({ event: 'done', captureId: 'capture-a' })
  assert.equal(session.snapshot('a'), null)
  assert.deepEqual(session.snapshot('b')?.savedAudioFailures, {})
  assert.equal(session.snapshot('b')?.phase, 'starting')
})

test('first failed start has no snapshot; failed Resume retains the completed capture', () => {
  const session = new TranscriptSession(() => {}, 'unused-empty-session')
  session.bindMeeting('a')
  session.handle({ event: 'spawn-error', message: 'Worker restarting' })
  assert.equal(session.snapshot('a'), null)
  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'capture-a' })
  session.handle({ event: 'status', stage: 'audio_save_failed', channel: 'mic' })
  session.handle({ event: 'done' })
  const ended = session.snapshot('a')
  session.bindMeeting('a')
  session.handle({ event: 'spawn-error', message: 'Worker restarting' })
  assert.deepEqual(session.snapshot('a'), ended)
  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'resume-a' })
  assert.deepEqual(session.snapshot('a')?.savedAudioFailures, {})
})

test('file attempts preserve the live owner until started, then remove the live snapshot', () => {
  const session = new TranscriptSession(() => {}, 'unused-empty-session')
  session.bindMeeting('a')
  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'capture-a' })
  session.handle({ event: 'status', stage: 'audio_save_failed', channel: 'mic' })
  session.handle({ event: 'done' })
  const ended = session.snapshot('a')
  session.bindMeeting()
  session.handle({ event: 'spawn-error', message: 'No file' })
  assert.deepEqual(session.snapshot('a'), ended)
  session.handle({ event: 'started', command: 'transcribe', binaryPath: 'test', captureId: 'file' })
  assert.equal(session.snapshot('a'), null)
  session.bindMeeting('b')
  session.handle({ event: 'spawn-error', message: 'Worker restarting' })
  assert.equal(session.snapshot('b'), null)
  session.handle({ event: 'started', command: 'live', binaryPath: 'test', captureId: 'capture-b' })
  assert.deepEqual(session.snapshot('b')?.savedAudioFailures, {})
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
    session.bindMeeting('failed-capture')
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
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
    session.bindMeeting('failed-save')
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Test.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'done' })
    assert.ok(events.some((event) => event.event === 'segments'))
    assert.match((events.at(-1) as { error: string }).error, /Failed to save session/)
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
        throw new Error('ENOSPC /private/synthetic/meeting.json')
      }
    )
    session.bindMeeting('failed-save')
    session.handle({ event: 'started', command: 'live', binaryPath: 'synthetic' })
    session.handle({ event: 'status', stage: 'audio_save_failed', channel: 'mic' })
    assert.deepEqual(session.snapshot('failed-save')?.savedAudioFailures, { mic: true })
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Keep this.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'done' })
    assert.ok(events.some((event) => event.event === 'session-saved'))
    assert.equal(
      JSON.stringify(events.filter((event) => event.event === 'error')).includes('/private/'),
      false
    )
    assert.match(
      (events.at(-1) as { error: string }).error,
      /Could not save the meeting transcript/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows sessions checkpoint the open utterance and save in time order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-session-win-'))
  const checkpoints: Array<{ texts: string[]; ended: boolean }> = []
  try {
    const session = new TranscriptSession(
      () => {},
      dir,
      () => {},
      (segments, ended) => checkpoints.push({ texts: segments.map((s) => s.text), ended }),
      { checkpointOpenText: true, sortOnFinish: true }
    )
    session.bindMeeting('w')
    session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
    session.handle({ event: 'channel_start', channel: 'mic', epochMs: 1_000_000 })
    session.handle({ event: 'channel_start', channel: 'system', epochMs: 1_000_000 })
    // One committed utterance, still an open segment: a crash must keep it.
    const token = (text: string, startSec: number): EngineTokenTiming => ({
      token: ` ${text}`,
      startSec,
      endSec: startSec + 0.3,
      confidence: 0.9
    })
    session.handle({
      event: 'timings',
      channel: 'system',
      tokens: [token('Later', 10), token('words.', 10.4)]
    })
    assert.deepEqual(checkpoints.at(-1), { texts: ['Later words.'], ended: false })
    // The mic utterance is committed later but happened earlier.
    session.handle({ event: 'timings', channel: 'mic', tokens: [token('Earlier.', 2)] })
    session.handle({ event: 'final', channel: 'system', text: 'Later words.' })
    session.handle({ event: 'final', channel: 'mic', text: 'Earlier.' })
    session.handle({ event: 'done' })
    assert.deepEqual(checkpoints.at(-1), { texts: ['Earlier.', 'Later words.'], ended: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the not-transcribed notice survives a renderer snapshot and resets per capture', () => {
  const session = new TranscriptSession(() => {}, 'unused')
  session.bindMeeting('u')
  session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
  session.handle({ event: 'status', stage: 'audio_not_transcribed', seconds: 96 })
  assert.equal(session.snapshot('u')?.untranscribedSec, 96)
  session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
  assert.equal(session.snapshot('u')?.untranscribedSec, undefined)
})

test('the captions-delayed state survives a renderer snapshot until it clears', () => {
  const session = new TranscriptSession(() => {}, 'unused')
  session.bindMeeting('d')
  session.handle({ event: 'started', command: 'live', binaryPath: 'test' })
  session.handle({ event: 'status', stage: 'captions_delayed' })
  assert.equal(session.snapshot('d')?.captionsDelayed, true)
  session.handle({ event: 'status', stage: 'captions_caught_up' })
  assert.equal(session.snapshot('d')?.captionsDelayed, undefined)
})
