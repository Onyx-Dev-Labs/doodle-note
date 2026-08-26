import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MeetingRecord } from '../shared/meetings-api'
import { contentHash } from './sync-content-hash'

function meeting(segments: MeetingRecord['segments']): MeetingRecord {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Sync hash fixture',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawNotesMarkdown: '',
    segments,
    echoSuppressed: 0
  }
}

describe('contentHash', () => {
  it('ignores echo-flagged segments so pull does not fight local bleed suppression', () => {
    const spoken = {
      id: 'seg-1',
      channel: 'mic' as const,
      speaker: 'You',
      speakerId: 'self',
      text: 'Hello',
      startMs: 0,
      endMs: 500,
      confidence: 0.9
    }
    const echo = {
      ...spoken,
      id: 'seg-2',
      echo: true,
      text: 'Hello bleed'
    }
    const withoutEcho = contentHash(meeting([spoken]), {})
    const withEcho = contentHash(meeting([spoken, echo]), {})
    assert.equal(withoutEcho, withEcho)
  })

  it('includes quick-note kind so note documents stay distinct from meetings', () => {
    const base = meeting([])
    const meetingHash = contentHash(base, {})
    const noteHash = contentHash({ ...base, kind: 'note' }, {})
    assert.notEqual(meetingHash, noteHash)
  })
})
