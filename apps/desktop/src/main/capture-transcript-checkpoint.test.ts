import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MeetingFileStore } from '@repo/meetings-store'
import { persistCaptureTranscript } from './capture-transcript-checkpoint'
import { TranscriptSession } from './transcript-session'

test('audio degradation survives hidden capture, Stop, reopen and later successful parts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-audio-degradation-'))
  try {
    const meetings = new MeetingFileStore(join(dir, 'meetings'))
    meetings.upsert({ id: 'fixture', rawNotesMarkdown: 'Keep manual notes' })
    const session = new TranscriptSession(
      () => {},
      join(dir, 'sessions'),
      () => {},
      (segments, ended, failures) =>
        persistCaptureTranscript(meetings, 'fixture', [], 0, segments, ended, failures)
    )
    session.bindMeeting('fixture')
    session.handle({ event: 'started', command: 'live', binaryPath: 'synthetic', captureId: 'a' })
    session.handle({ event: 'ready' })
    for (const channel of ['mic', 'system'] as const) {
      session.handle({ event: 'status', stage: 'audio_save_failed', channel, captureId: 'a' })
      assert.equal(meetings.get('fixture')?.savedAudioFailures?.[channel], true)
    }
    session.handle({ event: 'status', stage: 'transcribing' })
    session.handle({ event: 'partial', channel: 'mic', text: 'Still transcribing' })
    const snapshot = session.snapshot('fixture')!
    assert.deepEqual(snapshot.savedAudioFailures, { mic: true, system: true })
    assert.equal(snapshot.partials.mic, 'Still transcribing')
    Reflect.deleteProperty(snapshot.savedAudioFailures!, 'mic')
    assert.equal(session.snapshot('fixture')?.savedAudioFailures?.mic, true)
    session.handle({
      event: 'timings',
      channel: 'mic',
      tokens: [{ token: ' Keep this text.', startSec: 0, endSec: 1, confidence: 1 }]
    })
    session.handle({ event: 'audio', path: 'partial-recording.m4a', durationMs: 1000 })
    session.handle({ event: 'done' })
    const reopened = new MeetingFileStore(join(dir, 'meetings')).get('fixture')!
    assert.deepEqual(reopened.savedAudioFailures, { mic: true, system: true })
    assert.equal(reopened.rawNotesMarkdown, 'Keep manual notes')
    assert.equal(reopened.segments[0].text, 'Keep this text.')
    assert.ok(reopened.endedAt)
    session.handle({ event: 'started', command: 'live', binaryPath: 'synthetic', captureId: 'b' })
    session.handle({ event: 'status', stage: 'audio_save_failed', channel: 'mic', captureId: 'a' })
    assert.deepEqual(session.snapshot('fixture')?.savedAudioFailures, {})
    session.handle({ event: 'done' })
    assert.deepEqual(meetings.get('fixture')?.savedAudioFailures, { mic: true, system: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const disposition of ['delete', 'trash'] as const) {
  test(`late finalization after ${disposition} preserves user action and session recovery`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'doodle-discard-checkpoint-'))
    try {
      const meetings = new MeetingFileStore(join(dir, 'meetings'))
      meetings.upsert({ id: 'fixture', title: 'Synthetic draft', rawNotesMarkdown: 'Keep notes' })
      const session = new TranscriptSession(
        () => {},
        join(dir, 'sessions'),
        () => {},
        (segments, ended) => {
          persistCaptureTranscript(meetings, 'fixture', [], 0, segments, ended)
        }
      )
      session.bindMeeting('fixture')
      session.handle({ event: 'started', command: 'live', binaryPath: 'synthetic' })
      // Buffered tokens have not flushed yet, just as Stop begins asynchronously.
      session.handle({
        event: 'timings',
        channel: 'mic',
        tokens: [{ token: ' Recover this.', startSec: 0, endSec: 1, confidence: 1 }]
      })
      if (disposition === 'delete') meetings.delete('fixture')
      else meetings.upsert({ id: 'fixture', trashedAt: new Date().toISOString() })
      session.handle({ event: 'done' })
      if (disposition === 'delete') assert.equal(meetings.get('fixture'), null)
      else {
        const saved = meetings.get('fixture')!
        assert.ok(saved.trashedAt)
        assert.equal(saved.endedAt, undefined)
        assert.equal(saved.rawNotesMarkdown, 'Keep notes')
      }
      assert.equal(readdirSync(join(dir, 'sessions')).length, 1)
      assert.equal(session.snapshot('fixture')?.segments[0]?.text, 'Recover this.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
