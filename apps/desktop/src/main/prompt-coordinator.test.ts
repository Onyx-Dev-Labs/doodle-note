import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CalendarEvent, CalendarStartMeetingEvent } from '../shared/calendar-api'
import {
  choosePromptSurface,
  coordinatePrompt,
  initialPromptCoordinatorState,
  setPromptRecording
} from './prompt-coordinator'

const NOW = Date.parse('2026-08-01T15:00:00.000Z')

function eventAt(startOffsetMs: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    subject: 'Customer call',
    startIso: new Date(NOW + startOffsetMs).toISOString(),
    endIso: new Date(NOW + startOffsetMs + 60 * 60_000).toISOString(),
    isAllDay: false,
    isOnlineMeeting: true,
    calendarId: 'calendar-1',
    hasParticipants: true,
    ...overrides
  }
}

function calendarPrompt(event: CalendarEvent): CalendarStartMeetingEvent {
  return {
    action: 'prompt',
    eventId: event.id,
    subject: event.subject,
    startIso: event.startIso
  }
}

function micPrompt(subject = 'Zoom meeting'): CalendarStartMeetingEvent {
  return {
    action: 'prompt',
    eventId: '',
    subject,
    startIso: new Date(NOW).toISOString(),
    adHoc: true
  }
}

describe('prompt coordination', () => {
  it('delivers only one prompt when calendar and mic detect the same meeting', () => {
    const event = eventAt(90_000)
    const first = coordinatePrompt(
      initialPromptCoordinatorState(),
      calendarPrompt(event),
      [event],
      NOW
    )
    assert.equal(first.prompt?.eventId, event.id)

    const second = coordinatePrompt(first.state, micPrompt(), [event], NOW + 10_000)
    assert.equal(second.prompt, null)
  })

  it('honors a persisted calendar prompt after the app restarts', () => {
    const event = eventAt(0)
    const hydrated = initialPromptCoordinatorState({ [`calendar:${event.id}`]: NOW - 60_000 })
    assert.equal(coordinatePrompt(hydrated, micPrompt(), [event], NOW).prompt, null)
  })

  it('maps an early mic detection onto an imminent calendar event', () => {
    const event = eventAt(4 * 60_000)
    const first = coordinatePrompt(initialPromptCoordinatorState(), micPrompt(), [event], NOW)

    assert.deepEqual(first.prompt, calendarPrompt(event))
    assert.equal(first.matchedCalendarEventId, event.id)

    const calendarLater = coordinatePrompt(
      first.state,
      calendarPrompt(event),
      [event],
      NOW + 2 * 60_000
    )
    assert.equal(calendarLater.prompt, null)
  })

  it('does not map mic activity to distant, ended, or all-day events', () => {
    const distant = eventAt(20 * 60_000)
    const ended = eventAt(-60 * 60_000, { id: 'ended', endIso: new Date(NOW - 1).toISOString() })
    const allDay = eventAt(0, { id: 'all-day', isAllDay: true })
    const decision = coordinatePrompt(
      initialPromptCoordinatorState(),
      micPrompt(),
      [distant, ended, allDay],
      NOW
    )

    assert.equal(decision.prompt?.eventId, '')
    assert.equal(decision.prompt?.adHoc, true)
  })

  it('suppresses every prompt while DoodleNote is recording', () => {
    const state = setPromptRecording(initialPromptCoordinatorState(), true)
    assert.equal(coordinatePrompt(state, micPrompt(), [], NOW).prompt, null)
    assert.equal(
      coordinatePrompt(state, calendarPrompt(eventAt(0)), [eventAt(0)], NOW).prompt,
      null
    )
  })

  it('deduplicates repeated ad-hoc prompts inside the cooldown', () => {
    const first = coordinatePrompt(initialPromptCoordinatorState(), micPrompt(), [], NOW)
    assert.ok(first.prompt)
    assert.equal(coordinatePrompt(first.state, micPrompt(), [], NOW + 4 * 60_000).prompt, null)
    assert.ok(coordinatePrompt(first.state, micPrompt(), [], NOW + 6 * 60_000).prompt)
  })
})

describe('prompt surface selection', () => {
  it('uses exactly one attention surface', () => {
    assert.equal(choosePromptSurface(true, true), 'banner')
    assert.equal(choosePromptSurface(false, true), 'panel')
    assert.equal(choosePromptSurface(false, false), 'notification')
  })
})
