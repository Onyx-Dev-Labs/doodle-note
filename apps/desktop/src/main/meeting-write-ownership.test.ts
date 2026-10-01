import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MeetingFileStore } from '@repo/meetings-store'
import { rendererMeetingPatch } from './meeting-write-ownership'

test('stale renderer flush cannot replace an imported or reopened authoritative transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-transcript-ownership-'))
  try {
    const store = new MeetingFileStore(dir)
    const segment = {
      id: 'fresh-import',
      channel: 'mic' as const,
      speaker: 'You',
      text: 'Authoritative retry result.',
      startMs: 0,
      endMs: 1000,
      confidence: 1
    }
    store.upsert({
      id: 'imported-meeting',
      segments: [segment],
      echoSuppressed: 2,
      rawNotesMarkdown: 'Original notes.'
    })
    // A newly created store instance has no captured-session set: ownership still holds.
    const reopened = new MeetingFileStore(dir)
    const patch = {
      id: 'imported-meeting',
      segments: [{ ...segment, id: 'stale', text: 'Old wording.' }],
      echoSuppressed: 0,
      rawNotesMarkdown: 'Edited notes.',
      title: 'User title'
    }
    reopened.upsert(rendererMeetingPatch(patch))
    const saved = reopened.get('imported-meeting')!
    assert.equal(saved.segments[0]?.id, 'fresh-import')
    assert.equal(saved.segments[0]?.text, 'Authoritative retry result.')
    assert.equal(saved.echoSuppressed, 2)
    assert.equal(saved.rawNotesMarkdown, 'Edited notes.')
    assert.equal(saved.title, 'User title')
    assert.equal(patch.segments[0]?.id, 'stale')
    // Main services still retain authority to replace the transcript on the same store.
    reopened.upsert({ id: 'imported-meeting', segments: [{ ...segment, id: 'second-import' }] })
    assert.equal(reopened.get('imported-meeting')?.segments[0]?.id, 'second-import')
    reopened.upsert(rendererMeetingPatch({ id: 'new-note', segments: [], title: 'New note' }))
    assert.deepEqual(reopened.get('new-note')?.segments, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
