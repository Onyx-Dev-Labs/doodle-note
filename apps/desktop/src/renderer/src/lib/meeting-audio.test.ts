import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { AudioPart } from '../../../shared/audio-api'
import { watchMeetingAudio } from './meeting-audio'

const recovered: AudioPart[] = [
  { url: 'doodle-audio://meeting-a/1000/audio.m4a', startEpochMs: 1200, durationMs: 1000 }
]
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('only the latest list response updates a meeting; teardown ignores pending reads and events', async () => {
  const events = new EventEmitter()
  const reads: Array<(parts: AudioPart[]) => void> = []
  const visible: AudioPart[][] = []
  const stop = watchMeetingAudio(
    'meeting-a',
    {
      list: () => new Promise((resolve) => reads.push(resolve)),
      onChanged: (cb) => {
        events.on('changed', cb)
        return () => {
          events.off('changed', cb)
        }
      }
    },
    {
      onEvent: (cb) => {
        events.on('engine', cb)
        return () => {
          events.off('engine', cb)
        }
      }
    },
    (parts) => visible.push(parts)
  )
  try {
    events.emit('changed', { meetingId: 'other-meeting' })
    assert.equal(reads.length, 1, 'unrelated recovered meetings do not invalidate this view')
    events.emit('changed', { meetingId: 'meeting-a' })
    reads[1]!(recovered)
    await settle()
    reads[0]!([])
    await settle()
    assert.deepEqual(visible, [recovered], 'a stale pre-recovery response cannot remove the player')

    events.emit('engine', { event: 'audio', durationMs: 1000 })
    assert.equal(reads.length, 3, 'the existing clean-stop engine refresh contract is retained')
    stop()
    reads[2]!([])
    events.emit('changed', { meetingId: 'meeting-a' })
    events.emit('engine', { event: 'audio', durationMs: 1000 })
    await settle()
    assert.deepEqual(visible, [recovered])
    assert.equal(reads.length, 3)
    assert.equal(events.listenerCount('changed'), 0)
    assert.equal(events.listenerCount('engine'), 0)
  } finally {
    stop()
  }
})
