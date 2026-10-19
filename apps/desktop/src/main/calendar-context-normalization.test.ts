import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCalendarInvitees, readCalendarInvitees } from './calendar-context-normalization'
import { accountKey, scopeCalendar, scopeEvent } from './calendar-identity'

for (const provider of ['google', 'microsoft'] as const) {
  const attendee = (address: string, name = 'Same name'): Record<string, unknown> =>
    provider === 'google'
      ? { email: address, displayName: name }
      : { emailAddress: { address, name }, type: 'required' }
  test(`${provider}: absent roster is unknown, explicit empty is complete, legacy cache stays unknown`, () => {
    assert.equal(normalizeCalendarInvitees(provider, {}).roster.state, 'unknown')
    assert.equal(normalizeCalendarInvitees(provider, { attendees: [] }).roster.state, 'complete')
    assert.equal(readCalendarInvitees(undefined).roster.state, 'unknown')
  })
  test(`${provider}: exact addresses retain case/tags and same names never merge`, () => {
    const rows = normalizeCalendarInvitees(provider, {
      attendees: ['A@example.test', 'a@example.test', 'a+tag@example.test'].map((a) => attendee(a))
    }).entries
    assert.equal(rows.length, 3)
    assert.equal(new Set(rows.map((r) => r.identifierKey)).size, 3)
    assert.ok(rows.every((r) => r.self === 'unknown'))
  })
  test(`${provider}: duplicate identifiers remain ambiguous rather than becoming confirmed matches`, () => {
    const rows = normalizeCalendarInvitees(provider, {
      attendees: [attendee('a@example.test'), attendee('a@example.test')]
    }).entries
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.identifierKey === null))
  })
  test(`${provider}: organizer deduplicates only exact proven identity and retains both roles`, () => {
    const raw = { attendees: [attendee('a@example.test')], organizer: attendee('a@example.test') }
    const rows = normalizeCalendarInvitees(provider, raw).entries
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0]!.roles, ['attendee', 'organizer'])
    const external = normalizeCalendarInvitees(provider, {
      ...raw,
      organizer: attendee('outside@example.test')
    })
    assert.equal(external.entries.length, 2)
  })
  test(`${provider}: bounds and malformed identity never create truncated matching keys`, () => {
    const raw = {
      attendees: [attendee('x'.repeat(513), '😀'.repeat(300)), attendee('bad\u0000@example.test')]
    }
    const result = normalizeCalendarInvitees(provider, raw)
    assert.equal(result.roster.state, 'partial')
    assert.equal(Array.from(result.entries[0]!.displayName!).length, 256)
    assert.ok(result.entries.every((r) => r.identifierKey === null))
    const huge = normalizeCalendarInvitees(provider, {
      attendees: Array.from({ length: 300 }, (_, i) =>
        attendee(`${i}@example.test`, '😀'.repeat(256))
      )
    })
    assert.equal(huge.roster.state, 'partial')
    assert.ok(huge.entries.length <= 256)
    assert.ok(Buffer.byteLength(JSON.stringify(huge)) <= 65536)
    assert.equal(huge.roster.omittedCount, 300 - huge.entries.length)
  })
}
test('Google omitted/shared-calendar self and Graph delegated organizer remain unknown', () => {
  const google = normalizeCalendarInvitees('google', {
    attendeesOmitted: true,
    attendees: [{ email: 'shared@example.test', self: true }]
  })
  assert.equal(google.roster.state, 'partial')
  assert.equal(google.roster.omittedCount, null)
  assert.equal(google.entries[0]!.self, 'unknown')
  const graph = normalizeCalendarInvitees('microsoft', {
    isOrganizer: true,
    attendees: [],
    organizer: { emailAddress: { address: 'delegate@example.test' } }
  })
  assert.equal(graph.entries[0]!.self, 'unknown')
})
test('authenticated exact address evidence is explicit; resources never become matchable people', () => {
  const result = normalizeCalendarInvitees(
    'google',
    { attendees: [{ email: 'me@example.test' }, { email: 'room@example.test', resource: true }] },
    { authenticatedAddresses: ['me@example.test'] }
  )
  assert.equal(result.entries[0]!.self, 'confirmed-self')
  assert.equal(result.entries[0]!.selfEvidence, 'authenticated-address')
  assert.equal(result.entries[1]!.identifierKey, null)
  assert.ok(result.entries[1]!.roles.includes('resource'))
})
test('conflicting profile IDs sharing an address cannot match or deduplicate', () => {
  const result = normalizeCalendarInvitees('google', {
    attendees: [
      { id: 'p1', email: 'a@example.test' },
      { id: 'p2', email: 'a@example.test' }
    ]
  })
  assert.ok(result.entries.every((r) => r.identifierKey === null))
})
test('strict cached observation validation withholds malformed or future data without changing its source', () => {
  const valid = normalizeCalendarInvitees('google', { attendees: [{ email: 'a@example.test' }] })
  assert.deepEqual(readCalendarInvitees(valid), valid)
  for (const bad of [
    { ...valid, version: 2 },
    { ...valid, entries: [{ ...valid.entries[0], self: 'yes' }] },
    { ...valid, roster: { state: 'complete', omittedCount: -1 } }
  ]) {
    const before = JSON.stringify(bad)
    assert.equal(readCalendarInvitees(bad).roster.state, 'unknown')
    assert.equal(JSON.stringify(bad), before)
  }
})
test('optional observations do not change account, calendar or occurrence identities', () => {
  const event = {
    id: 'raw',
    subject: 'Synthetic',
    startIso: '2026-10-18T20:00:00Z',
    endIso: '2026-10-18T21:00:00Z',
    isAllDay: false,
    isOnlineMeeting: false,
    calendarId: 'raw-cal',
    hasParticipants: false
  }
  const identity = { provider: 'google' as const, subject: 'account-one' }
  const calendar = scopeCalendar(identity, {
    id: 'raw-cal',
    name: 'Synthetic',
    colorHex: '#000000',
    isDefault: true,
    canEdit: false
  })
  const bare = scopeEvent(identity, calendar, event)
  const observed = scopeEvent(identity, calendar, {
    ...event,
    invitees: normalizeCalendarInvitees('google', { attendees: [{ email: 'a@example.test' }] })
  })
  assert.equal(observed.id, bare.id)
  assert.equal(observed.hasParticipants, bare.hasParticipants)
  assert.notEqual(accountKey(identity), accountKey({ ...identity, subject: 'account-two' }))
  assert.notEqual(scopeEvent(identity, calendar, { ...event, occurrenceId: 'other' }).id, bare.id)
})
test('organizer conflicting with an attendee identifier makes both ambiguous', () => {
  const result = normalizeCalendarInvitees('google', {
    attendees: [{ id: 'p1', email: 'a@example.test' }],
    organizer: { id: 'p2', email: 'a@example.test' }
  })
  assert.equal(result.entries.length, 2)
  assert.ok(result.entries.every((row) => row.identifierKey === null))
})
test('overflow cannot assert uniqueness of an identifier whose duplicate was omitted', () => {
  const result = normalizeCalendarInvitees('google', {
    attendees: Array.from({ length: 257 }, (_, i) => ({
      email: `${i === 256 ? 0 : i}@example.test`
    }))
  })
  assert.equal(result.entries[0]!.identifierKey, null)
})

test('cached ambiguous identifiers and impossible complete-roster counts fail closed', () => {
  const valid = normalizeCalendarInvitees('google', { attendees: [{ email: 'a@example.test' }] })
  const ambiguous = {
    ...valid,
    entries: [valid.entries[0], { ...valid.entries[0], id: 'invitee:1' }]
  }
  assert.equal(readCalendarInvitees(ambiguous).roster.state, 'unknown')
  assert.equal(
    readCalendarInvitees({ ...valid, roster: { state: 'complete', omittedCount: 1 } }).roster.state,
    'unknown'
  )
})
