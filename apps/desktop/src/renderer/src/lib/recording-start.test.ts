import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareRecordingMeeting } from './recording-start'
import type { MeetingsApi, MeetingRecord } from '../../../shared/meetings-api'

const request = {
  id: 'request-1',
  event: {
    action: 'start' as const,
    eventId: '',
    subject: 'Meeting',
    startIso: '2026-09-08T17:00:00Z'
  }
}
function fixture(): {
  meetings: Pick<MeetingsApi, 'list' | 'upsert'>
  writes: unknown[]
  records: MeetingRecord[]
} {
  const writes: unknown[] = []
  const records: MeetingRecord[] = []
  const meetings: Pick<MeetingsApi, 'list' | 'upsert'> = {
    list: async () => records,
    upsert: async (m) => {
      writes.push(m)
      return m as MeetingRecord
    }
  }
  return { meetings, writes, records }
}
test('ad-hoc recordings create new documents even if older records have an empty calendar ID', async () => {
  const { meetings, writes, records } = fixture()
  records.push({ id: 'old', calendarEventId: '' } as MeetingRecord)
  let bound: string | null = null
  const id = await prepareRecordingMeeting(
    request,
    meetings,
    {
      attach: async (_r, m) => {
        bound = m
        return true
      },
      cancel: async () => {}
    },
    () => 'new'
  )
  assert.equal(bound, 'new')
  assert.equal(id, 'new')
  assert.equal(writes.length, 1)
  assert.equal('calendarEventId' in (writes[0] as object), false)
})
test('calendar starts reuse their existing live document without overwriting content', async () => {
  const { meetings, writes, records } = fixture()
  records.push({ id: 'existing', calendarEventId: 'calendar-1' } as MeetingRecord)
  const id = await prepareRecordingMeeting(
    { ...request, event: { ...request.event, eventId: 'calendar-1' } },
    meetings,
    {
      attach: async () => true,
      cancel: async () => {}
    },
    () => 'new'
  )
  assert.equal(id, 'existing')
  assert.equal(writes.length, 0)
})
test('a rejected or cancelled reservation creates no meeting', async () => {
  const { meetings, writes } = fixture()
  assert.equal(
    await prepareRecordingMeeting(
      request,
      meetings,
      { attach: async () => false, cancel: async () => {} },
      () => 'new'
    ),
    null
  )
  assert.equal(writes.length, 0)
})
test('storage failure cancels the reservation and reports recovery to the caller', async () => {
  const { meetings } = fixture()
  meetings.upsert = async () => {
    throw new Error('disk full')
  }
  const cancelled: string[] = []
  await assert.rejects(
    prepareRecordingMeeting(
      request,
      meetings,
      {
        attach: async () => true,
        cancel: async (id) => {
          cancelled.push(id)
        }
      },
      () => 'new'
    ),
    /disk full/
  )
  assert.deepEqual(cancelled, ['request-1'])
})
