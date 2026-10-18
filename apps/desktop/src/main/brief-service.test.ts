import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  localSourceScope,
  projectSources,
  resolveOriginalSource
} from '@repo/meetings-store/sources'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '@repo/meetings-store/evidence'
import { buildCitedAskPrompt } from '@repo/ai'
import { createHash } from 'node:crypto'
import { CalendarContextStore } from './calendar-context-store'
import { normalizeCalendarInvitees } from './calendar-context-normalization'
import { accountKey, scopeCalendar, scopeEvent } from './calendar-identity'
import { MainCitedAskService } from './cited-ask-service'
import { BriefService, type BriefDependencies } from './brief-service'
import type { CalendarEvent } from '../shared/calendar-api'
import { LibraryActivity } from './library-activity'
import type { BriefView } from '../shared/briefs-api'

interface Fixture {
  root: string
  briefs: BriefService
  store: CalendarContextStore
  cited: MainCitedAskService
  views: BriefView[]
  event: CalendarEvent
  account: string
  put(id: string, text: string): void
  generated(): number
  changeEvent(): void
  disconnect(): void
  listenerCount(): number
}
function fixture(t: test.TestContext): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-brief-')))
  const meetingsDir = join(root, 'meetings')
  mkdirSync(meetingsDir)
  const context = { meetingsDir, scope: localSourceScope(meetingsDir, true), authorized: true }
  const identity = { provider: 'google' as const, subject: 'synthetic-one' }
  const cal = scopeCalendar(identity, {
    id: 'calendar',
    name: 'Synthetic',
    colorHex: '#000',
    isDefault: true,
    canEdit: false
  })
  let event = scopeEvent(identity, cal, {
    id: 'event',
    subject: 'Synthetic Review',
    startIso: '2026-10-18T20:00:00Z',
    endIso: '2026-10-18T21:00:00Z',
    isAllDay: false,
    isOnlineMeeting: false,
    hasParticipants: true,
    calendarId: cal.id,
    invitees: normalizeCalendarInvitees('google', {
      attendees: [{ email: 'a@example.test', displayName: 'Alex' }]
    })
  })
  let epoch = 0
  let connected = true
  let generated = 0
  const listeners = new Set<() => void>()
  const views: BriefView[] = []
  const activity = new LibraryActivity()
  const store = new CalendarContextStore(
    () => root,
    () => {},
    activity
  )
  const sources = {
    retrieveEvidence: async (selection: Parameters<typeof retrieveOriginalEvidence>[1]) =>
      retrieveOriginalEvidence(context, selection),
    validateEvidence: async (manifest: Parameters<typeof validateOriginalEvidence>[1]) =>
      validateOriginalEvidence(context, manifest),
    resolve: async (anchor: Parameters<typeof resolveOriginalSource>[1]) =>
      resolveOriginalSource(context, anchor)
  }
  const cited = new MainCitedAskService({
    sources,
    activity,
    validateModel: async () => true,
    generate: async (input) => {
      generated++
      const prompt = buildCitedAskPrompt(input, {
        contextWindowTokens: 16384,
        outputReserveTokens: 4096,
        safetyMarginTokens: 256,
        accounting: 'model-tokenizer',
        countInputTokens: (a, b) => Buffer.byteLength(a + b)
      })
      return {
        rawJson: JSON.stringify({
          status: 'answered',
          claims: [
            {
              id: 'claim',
              kind: 'paraphrase',
              text: 'Orchid ships Friday.',
              evidenceIds: [prompt.inclusion.ranges[0]!.id]
            }
          ]
        }),
        inclusion: prompt.inclusion,
        engineId: 'local:synthetic',
        modelArtifactRevision: 'fixture'
      }
    }
  })
  const put = (id: string, text: string): void =>
    writeFileSync(
      join(meetingsDir, id + '.json'),
      JSON.stringify({ id, title: id, rawNotesMarkdown: text, createdAt: '2020-01-01T00:00:00Z' })
    )
  put('old', 'Orchid ships Friday.')
  put('unrelated', 'Private unrelated original.')
  const original = async (id: string): ReturnType<BriefDependencies['originals']['get']> => {
    try {
      const bytes = readFileSync(join(meetingsDir, id + '.json'))
      const raw = JSON.parse(bytes.toString())
      const projected = projectSources(raw, context.scope)
      if (!projected) return null
      return {
        meetingId: id,
        title: raw.title,
        occurredAt: raw.createdAt,
        dateBasis: 'createdAt' as const,
        calendarEventId: raw.calendarEventId,
        scope: context.scope,
        rawSha256: createHash('sha256').update(bytes).digest('hex'),
        projectedRevisionId: projected.revisionId,
        trashed: false
      }
    } catch {
      return null
    }
  }
  const briefs = new BriefService({
    store,
    cited,
    calendar: {
      resolveBrief: (id) => {
        if (!connected || id !== event.id) return null
        const captured = epoch
        return {
          event: structuredClone(event),
          lastSyncIso: null,
          assertCurrent: () => {
            if (!connected || epoch !== captured) throw new Error('Calendar unavailable')
          }
        }
      },
      subscribeBrief: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    },
    originals: {
      get: original,
      list: async () => [(await original('old'))!],
      assertCurrent: () => {}
    },
    publish: (_owner, view) => views.push(view)
  })
  t.after(async () => {
    await briefs.dispose()
    await store.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    briefs,
    store,
    cited,
    views,
    event,
    put,
    account: accountKey(identity),
    generated: () => generated,
    changeEvent: () => {
      event = { ...event, subject: 'Changed' }
      epoch++
      listeners.forEach((fn) => fn())
    },
    disconnect: () => {
      connected = false
      epoch++
      listeners.forEach((fn) => fn())
    },
    listenerCount: () => listeners.size
  }
}
test('open/refresh never infer; explicit empty selection is validated no-history without whole-library fallback', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window-one', f.event.id)
  assert.equal(opened.state, 'no-history')
  assert.equal(f.generated(), 0)
  await f.briefs.refresh('window-one', opened.sessionId)
  assert.equal(f.generated(), 0)
  const empty = await f.briefs.generate('window-one', opened.sessionId, 'run-empty', {})
  assert.equal(empty.result?.status, 'no-history')
  assert.equal(f.generated(), 0)
  assert.match(empty.result!.snapshot.requestSha256!, /^[a-f0-9]{64}$/)
  assert.deepEqual(empty.result!.snapshot.evidence.coverage.selection, {
    mode: 'linked-history',
    meetingIds: []
  })
})
test('explicit event link uses actual shared service, preserves originals, and cannot widen selected history', async (t) => {
  const f = fixture(t)
  const original = readFileSync(join(f.root, 'meetings/old.json'))
  const opened = await f.briefs.open('window-one', f.event.id)
  const linked = await f.briefs.link('window-one', opened.sessionId, opened.revision!, 'old', {
    kind: 'event'
  })
  const answer = await f.briefs.generate('window-one', opened.sessionId, 'run-answer', {})
  assert.equal(answer.state, 'ready')
  assert.equal(f.generated(), 1)
  assert.deepEqual(
    answer.result!.snapshot.evidence.meetings.map((m) => m.meetingId),
    ['old']
  )
  assert.deepEqual(readFileSync(join(f.root, 'meetings/old.json')), original)
  const invalid = await f.briefs.generate('window-one', opened.sessionId, 'run-wide', {
    meetingIds: ['unrelated']
  })
  assert.equal(invalid.errorCode, 'invalid-subset')
  assert.equal(f.generated(), 1)
  assert.equal(linked.history!.length, 1)
})
test('disconnect immediately withholds names/claims and teardown disposes subscriptions', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window-one', f.event.id)
  f.disconnect()
  const last = f.views.at(-1)!
  assert.equal(last.event, undefined)
  assert.equal(last.people, undefined)
  assert.equal(last.result, undefined)
  await assert.rejects(f.briefs.refresh('other-window', opened.sessionId), /owner|session/i)
  await f.briefs.dispose()
  assert.equal(f.listenerCount(), 0)
})

test('every empty snapshot validates again; missing digest, partial domain and changed context are withheld', async (t) => {
  const f = fixture(t)
  const originalRun = f.cited.run.bind(f.cited)
  const originalValidate = f.cited.validate.bind(f.cited)
  let validations = 0
  f.cited.validate = async (...args) => {
    validations++
    return originalValidate(...args)
  }
  const opened = await f.briefs.open('window', f.event.id)
  await f.briefs.generate('window', opened.sessionId, 'empty', {})
  assert.ok(validations >= 2)
  f.cited.run = async (...args) => {
    const result = await originalRun(...args)
    if (result.status !== 'error') delete result.snapshot.requestSha256
    return result
  }
  const missing = await f.briefs.generate('window', opened.sessionId, 'missing', {})
  assert.equal(missing.result, undefined)
  f.cited.run = async (...args) => {
    const result = await originalRun(...args)
    if (result.status !== 'error') result.snapshot.evidence.coverage.scanComplete = false
    return result
  }
  const partial = await f.briefs.generate('window', opened.sessionId, 'partial', {})
  assert.equal(partial.result, undefined)
  f.cited.run = async (...args) => {
    const result = await originalRun(...args)
    f.changeEvent()
    return result
  }
  const changed = await f.briefs.generate('window', opened.sessionId, 'changed', {})
  assert.equal(changed.result, undefined)
  assert.equal(changed.event, undefined)
})
test('sidecar edits during final validation cannot admit an old no-history result', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  const validate = f.cited.validate.bind(f.cited)
  let calls = 0
  f.cited.validate = async (...args) => {
    const result = await validate(...args)
    if (++calls === 2) {
      const path = join(f.root, 'calendar-context-v1.json')
      const data = JSON.parse(readFileSync(path, 'utf8'))
      data.future = 'external same-revision edit'
      writeFileSync(path, JSON.stringify(data))
    }
    return result
  }
  const result = await f.briefs.generate('window', opened.sessionId, 'external', {})
  assert.equal(result.result, undefined)
})
test('refresh validates cached answers, never regenerates and hides source edits', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
  await f.briefs.generate('window', opened.sessionId, 'run', {})
  assert.equal((await f.briefs.refresh('window', opened.sessionId)).result?.status, 'complete')
  assert.equal(f.generated(), 1)
  f.put('old', 'Changed original')
  const refreshed = await f.briefs.refresh('window', opened.sessionId)
  assert.equal(refreshed.result, undefined)
  assert.equal(f.generated(), 1)
})
test('missing linked original is unavailable, not no-history; explicit [] remains empty', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
  rmSync(join(f.root, 'meetings/old.json'))
  const missing = await f.briefs.generate('window', opened.sessionId, 'missing', {})
  assert.equal(missing.result, undefined)
  assert.equal(missing.state, 'unavailable')
  assert.equal(f.generated(), 0)
  const empty = await f.briefs.generate('window', opened.sessionId, 'explicit-empty', {
    meetingIds: []
  })
  assert.equal(empty.result?.status, 'no-history')
  assert.equal(empty.history?.[0]?.available, false)
})
test('wrong owner cannot cancel; closing waits for owned consumer completion and withholds late output', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  let entered!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = f.cited.run.bind(f.cited)
  f.cited.run = async (...args) => {
    entered()
    await held
    return run(...args)
  }
  const pending = f.briefs.generate('window', opened.sessionId, 'held', {})
  await ready
  await assert.rejects(f.briefs.cancel('wrong', opened.sessionId, 'held'), /owner/)
  let closed = false
  const closing = f.briefs.close('window', opened.sessionId).then(() => {
    closed = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await closing
  assert.equal((await pending).result, undefined)
  assert.ok(f.views.every((v) => !v.result))
})
test('explicit forget keeps originals and does not recapture the forgotten observation', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  const preview = await f.briefs.previewForget('window', opened.sessionId)
  await f.briefs.forget('window', opened.sessionId, preview.previewId, preview.revision)
  const data = JSON.parse(readFileSync(join(f.root, 'calendar-context-v1.json'), 'utf8'))
  assert.equal(Object.keys(data.snapshots).length, 0)
  assert.match(readFileSync(join(f.root, 'meetings/old.json'), 'utf8'), /Orchid/)
})
test('an older concurrent Open cannot leave an orphan owned session', async (t) => {
  const f = fixture(t)
  const first = f.briefs.open('window', f.event.id)
  const second = f.briefs.open('window', f.event.id)
  await assert.rejects(first, /superseded/)
  const current = await second
  await f.briefs.closeOwner('window')
  await assert.rejects(f.briefs.refresh('window', current.sessionId), /owner/)
})
