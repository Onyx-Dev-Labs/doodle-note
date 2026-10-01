import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MeetingFileStore } from '@repo/meetings-store'
import { persistCaptureTranscript } from './capture-transcript-checkpoint'
import { TranscriptSession } from './transcript-session'

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
