import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localSourceScope, resolveOriginalSource } from '@repo/meetings-store/sources'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '@repo/meetings-store/evidence'
import { createCitedAskHost } from './cited-ask-host'
import { installBriefs } from './brief-installer'
import { RecordingStartCoordinator } from './recording-start-coordinator'
import { scopeCalendar, scopeEvent } from './calendar-identity'
import { normalizeCalendarInvitees } from './calendar-context-normalization'
import { LibraryActivity } from './library-activity'
import { BRIEFS_INVOKE, type BriefView } from '../shared/briefs-api'
import type { BriefIpcEvent } from './brief-ipc'
import type { RecordingStartRequest } from '../shared/recording-api'

interface Fixture {
  root: string
  event: ReturnType<typeof scopeEvent>
  host: ReturnType<typeof createCitedAskHost>
  sources: {
    retrieveEvidence(
      selection: Parameters<typeof retrieveOriginalEvidence>[1]
    ): Promise<ReturnType<typeof retrieveOriginalEvidence>>
  }
  calendar: Parameters<typeof installBriefs>[0]['calendar']
  listeners: Set<() => void>
  published: BriefView[]
  power: EventEmitter
  warnings: string[]
  recording: RecordingStartCoordinator
  invoke(method: string, ...args: unknown[]): Promise<unknown>
  start(meetingId: string): string | undefined
  readonly installed: ReturnType<typeof installBriefs>
  generated(): number
  disable(): void
  reinstall(): void
}
function fixture(t: test.TestContext): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-install-')))
  const meetingsDir = join(root, 'meetings')
  mkdirSync(meetingsDir)
  const context = { meetingsDir, scope: localSourceScope(meetingsDir, true), authorized: true }
  const account = { provider: 'google' as const, subject: 'synthetic' }
  const cal = scopeCalendar(account, {
    id: 'cal',
    name: 'Synthetic',
    colorHex: '#000',
    isDefault: true,
    canEdit: false
  })
  const event = scopeEvent(account, cal, {
    id: 'event',
    subject: 'Synthetic Review',
    startIso: '2026-10-18T20:00:00Z',
    endIso: '2026-10-18T21:00:00Z',
    isAllDay: false,
    isOnlineMeeting: false,
    hasParticipants: true,
    calendarId: cal.id,
    invitees: normalizeCalendarInvitees('google', { attendees: [{ email: 'a@example.test' }] })
  })
  const listeners = new Set<() => void>()
  const calendar = {
    resolveBrief: () => ({ event, lastSyncIso: null, assertCurrent: () => {} }),
    subscribeBrief: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  const sources = {
    retrieveEvidence: async (selection: Parameters<typeof retrieveOriginalEvidence>[1]) =>
      retrieveOriginalEvidence(context, selection),
    validateEvidence: async (manifest: Parameters<typeof validateOriginalEvidence>[1]) =>
      validateOriginalEvidence(context, manifest),
    resolveAcknowledged: async (anchor: Parameters<typeof resolveOriginalSource>[1]) =>
      resolveOriginalSource(context, anchor),
    census: async () => {
      throw new Error('Not requested by these fixtures')
    }
  }
  const activity = new LibraryActivity()
  const published: BriefView[] = []
  const renderer = {
    id: 1,
    mainFrame: {},
    isDestroyed: () => false,
    send: (_channel: string, value: unknown) => {
      published.push(value as BriefView)
    }
  }
  let generated = 0
  const host = createCitedAskHost(
    {
      sources,
      activity,
      validateModel: async () => true,
      generate: async () => {
        generated++
        throw new Error('No model expected')
      }
    },
    () => renderer
  )
  const handlers = new Map<string, (event: BriefIpcEvent, request: unknown) => Promise<unknown>>()
  const ipc = {
    handle: (
      channel: string,
      handler: (event: BriefIpcEvent, request: unknown) => Promise<unknown>
    ) => {
      assert.equal(handlers.has(channel), false)
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  }
  const requests: RecordingStartRequest[] = []
  const recording = new RecordingStartCoordinator(
    (r) => requests.push(r),
    () => {}
  )
  recording.ready(true)
  const power = new EventEmitter()
  const warnings: string[] = []
  let enabled = true
  const deps = {
    root: () => root,
    assertAvailable: () => {},
    calendar,
    sources,
    activity,
    host,
    ipc,
    recording,
    power,
    enabled: () => enabled,
    warn: (message: string) => warnings.push(message)
  }
  let installed = installBriefs(deps)
  t.after(async () => {
    await installed.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const invoke = (method: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(BRIEFS_INVOKE)!(
      { sender: renderer, senderFrame: renderer.mainFrame },
      { method, args }
    )
  const start = (meetingId: string): string | undefined => {
    assert.equal(
      recording.request({
        action: 'start',
        eventId: event.id,
        subject: event.subject,
        startIso: event.startIso
      }),
      true
    )
    recording.attach(requests.at(-1)!.id, meetingId)
    writeFileSync(
      join(meetingsDir, meetingId + '.json'),
      JSON.stringify({
        id: meetingId,
        title: 'Synthetic',
        rawNotesMarkdown: '',
        calendarEventId: event.id
      })
    )
    assert.equal(recording.beginEngine(meetingId), true)
    return installed.pendingAttempt
  }
  return {
    root,
    event,
    host,
    sources,
    calendar,
    listeners,
    published,
    power,
    warnings,
    recording,
    invoke,
    start,
    get installed() {
      return installed
    },
    generated: () => generated,
    disable: () => {
      enabled = false
    },
    reinstall: () => {
      installed = installBriefs(deps)
    }
  }
}

test('installer shares the host, invalidates synchronously, refreshes without inference and disposes subscriptions on recreate', async (t) => {
  const f = fixture(t)
  const opened = (await f.invoke('open', f.event.id)) as BriefView
  assert.equal(opened.state, 'no-history')
  await f.invoke('generate', opened.sessionId, 'empty', {})
  assert.equal(f.published.at(-1)?.result?.status, 'no-history')
  const invalidated = f.host.invalidate()
  assert.equal(f.published.at(-1)?.state, 'stale')
  assert.equal(f.published.at(-1)?.result, undefined)
  await invalidated
  f.power.emit('resume')
  await f.installed.settled()
  assert.equal(f.published.at(-1)?.state, 'no-history')
  assert.equal(f.generated(), 0)
  await f.installed.dispose()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.power.listenerCount('resume'), 0)
  f.reinstall()
  assert.equal(f.listeners.size, 1)
  assert.equal(f.power.listenerCount('resume'), 1)
})

test('accepted actual start links once; wrong attempt and duplicate callback never persist', async (t) => {
  const f = fixture(t)
  const attempt = f.start('new-original')!
  assert.ok(attempt)
  await f.installed.onCaptureStarted('stale', 'capture', 'new-original')
  assert.equal(existsSync(join(f.root, 'calendar-context-v1.json')), false)
  await f.installed.onCaptureStarted(attempt, 'capture', 'new-original')
  const bytes = readFileSync(join(f.root, 'calendar-context-v1.json'))
  const data = JSON.parse(bytes.toString())
  assert.equal(
    data.changes.filter((c: { provenance: string }) => c.provenance === 'accepted-start').length,
    1
  )
  await f.installed.onCaptureStarted(attempt, 'capture', 'new-original')
  assert.deepEqual(readFileSync(join(f.root, 'calendar-context-v1.json')), bytes)
  assert.equal(f.recording.snapshot().phase, 'starting')
  assert.deepEqual(f.warnings, [])
})

test('disabled feature performs ordinary capture without context writes or warnings', async (t) => {
  const f = fixture(t)
  f.disable()
  assert.equal(await f.invoke('available'), false)
  const attempt = f.start('ordinary')
  assert.equal(attempt, undefined)
  await f.installed.onCaptureStarted(attempt, 'capture', 'ordinary')
  assert.equal(existsSync(join(f.root, 'calendar-context-v1.json')), false)
  assert.deepEqual(f.warnings, [])
  assert.equal(f.recording.snapshot().phase, 'starting')
})

test('installer teardown drains an accepted-start read and preserves capture while aborting late metadata', async (t) => {
  const f = fixture(t)
  const attempt = f.start('held-original')!
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>((r) => {
    enter = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const retrieve = f.sources.retrieveEvidence
  f.sources.retrieveEvidence = async (selection) => {
    enter()
    await held
    return retrieve(selection)
  }
  const saving = f.installed.onCaptureStarted(attempt, 'capture', 'held-original')
  await entered
  let disposed = false
  const disposing = f.installed.dispose().then(() => {
    disposed = true
  })
  await new Promise<void>((r) => setImmediate(r))
  assert.equal(disposed, false)
  assert.equal(f.recording.snapshot().phase, 'starting')
  release()
  await Promise.all([saving, disposing])
  assert.equal(existsSync(join(f.root, 'calendar-context-v1.json')), false)
  assert.deepEqual(f.warnings, [])
})
