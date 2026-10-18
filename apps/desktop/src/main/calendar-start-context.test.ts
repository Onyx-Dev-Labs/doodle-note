import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CalendarStartContext } from './calendar-start-context'
import { RecordingStartCoordinator } from './recording-start-coordinator'
import type { CalendarEvent } from '../shared/calendar-api'
import type { RecordingStartRequest } from '../shared/recording-api'

const event: CalendarEvent = {
  id: 'canonical-event',
  accountId: 'account',
  calendarId: 'calendar',
  provider: 'google',
  providerEventId: 'raw',
  occurrenceId: 'occurrence',
  subject: 'Synthetic',
  startIso: '2026-10-18T20:00:00Z',
  endIso: '2026-10-18T21:00:00Z',
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: false
}
const original = {
  meetingId: 'new-note',
  calendarEventId: event.id,
  rawSha256: 'a'.repeat(64),
  projectedRevisionId: 'b'.repeat(64),
  scope: { libraryId: 'library', accountId: null, workspaceId: null },
  trashed: false
}
function setup(): {
  adapter: CalendarStartContext
  writes: unknown[]
  warnings: string[]
  unavailable(): void
  existing(): void
  remove(): void
  wrongEvent(): void
  hold(): void
  release(): void
} {
  const writes: unknown[] = []
  const warnings: string[] = []
  let available = true
  let exists = false
  let note: typeof original | null = original
  let release: (() => void) | undefined
  const adapter = new CalendarStartContext({
    resolve: (id) =>
      id === event.id
        ? {
            event: structuredClone(event),
            lastSyncIso: null,
            assertCurrent: () => {
              if (!available) throw new Error('account changed')
            }
          }
        : null,
    originalExists: () => exists,
    readOriginal: async () => note,
    assertOriginalCurrent: (value) => {
      if (value !== note) throw new Error('original changed')
    },
    persist: async (accepted, control) => {
      if (release !== undefined)
        await new Promise<void>((r) => {
          release = r
        })
      control.assertCurrent()
      writes.push(accepted)
    },
    warn: (message) => warnings.push(message)
  })
  return {
    adapter,
    writes,
    warnings,
    unavailable: () => {
      available = false
    },
    existing: () => {
      exists = true
    },
    remove: () => {
      note = null
    },
    wrongEvent: () => {
      note = { ...original, calendarEventId: 'another' }
    },
    hold: () => {
      release = () => {}
    },
    release: () => release?.()
  }
}
test('shared coordinator reservation/attach never persists; matching actual start does', async () => {
  const f = setup()
  const delivered: RecordingStartRequest[] = []
  const coordinator = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {},
    async () => {},
    f.adapter.observer
  )
  coordinator.ready(true)
  assert.equal(
    coordinator.request({
      action: 'start',
      eventId: event.id,
      subject: 'Renderer text ignored',
      startIso: event.startIso
    }),
    true
  )
  const request = delivered[0]!
  assert.equal('invitees' in request.event, false)
  assert.equal(coordinator.attach(request.id, original.meetingId), true)
  assert.equal(f.writes.length, 0)
  assert.equal(coordinator.beginEngine(original.meetingId), true)
  const token = f.adapter.pendingAttempt!
  await f.adapter.started(token, 'actual-capture', original.meetingId)
  assert.equal(f.writes.length, 1)
  assert.equal((f.writes[0] as { event: CalendarEvent }).event.subject, 'Synthetic')
  await f.adapter.started(token, 'actual-capture', original.meetingId)
  assert.equal(f.writes.length, 1)
})
test('ad-hoc and ordinary Resume have no calendar context', async () => {
  const f = setup()
  f.adapter.observer.accepted?.({
    id: 'adhoc',
    event: { action: 'start', eventId: '', subject: 'Ad hoc', startIso: event.startIso }
  })
  f.adapter.observer.engineBegin?.(null, original.meetingId)
  await f.adapter.started('not-reserved', 'capture', original.meetingId)
  assert.equal(f.writes.length, 0)
})
test('old notes stay identified as existing so persistence cannot infer historical invitees', async () => {
  const f = setup()
  f.existing()
  f.adapter.observer.accepted?.({
    id: 'request',
    event: { action: 'start', eventId: event.id, subject: '', startIso: event.startIso }
  })
  f.adapter.observer.attached?.('request', original.meetingId)
  f.adapter.observer.engineBegin?.('request', original.meetingId)
  await f.adapter.started(f.adapter.pendingAttempt!, 'capture', original.meetingId)
  assert.equal((f.writes[0] as { existedAtAttach: boolean }).existedAtAttach, true)
})
test('canceled/superseded/failed requests, missing original and mismatched event never link', async () => {
  for (const reason of ['cancel', 'account', 'missing', 'wrong-event', 'failed'] as const) {
    const f = setup()
    f.adapter.observer.accepted?.({
      id: 'request',
      event: { action: 'start', eventId: event.id, subject: '', startIso: event.startIso }
    })
    f.adapter.observer.attached?.('request', original.meetingId)
    f.adapter.observer.engineBegin?.('request', original.meetingId)
    const token = f.adapter.pendingAttempt!
    if (reason === 'cancel' || reason === 'failed') f.adapter.observer.reset?.()
    else if (reason === 'account') f.unavailable()
    else if (reason === 'missing') f.remove()
    else f.wrongEvent()
    await f.adapter.started(token, 'capture', original.meetingId)
    assert.equal(f.writes.length, 0, reason)
  }
})
test('invalidated in-flight optional save cannot persist late or release a later capture', async () => {
  const f = setup()
  f.hold()
  const start = (id: string): string => {
    f.adapter.observer.accepted?.({
      id,
      event: { action: 'start', eventId: event.id, subject: '', startIso: event.startIso }
    })
    f.adapter.observer.attached?.(id, original.meetingId)
    f.adapter.observer.engineBegin?.(id, original.meetingId)
    return f.adapter.pendingAttempt!
  }
  const first = start('first')
  const pending = f.adapter.started(first, 'capture-one', original.meetingId)
  await new Promise((resolve) => setImmediate(resolve))
  f.adapter.observer.reset?.()
  const second = start('second')
  f.release()
  await pending
  assert.equal(f.writes.length, 0)
  assert.equal(f.adapter.pendingAttempt, second)
})
test('optional observation failure cannot interrupt valid coordinator/audio lifecycle', async () => {
  const f = setup()
  f.unavailable()
  const delivered: RecordingStartRequest[] = []
  const c = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {},
    async () => {},
    f.adapter.observer
  )
  c.ready(true)
  assert.equal(
    c.request({
      action: 'start',
      eventId: event.id,
      subject: 'Synthetic',
      startIso: event.startIso
    }),
    true
  )
  assert.equal(c.attach(delivered[0]!.id, original.meetingId), true)
  assert.equal(c.beginEngine(original.meetingId), true)
  c.handle({ event: 'ready' })
  assert.equal(c.snapshot().phase, 'recording')
  assert.ok(f.warnings.length)
})
