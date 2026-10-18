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
import { CITED_ASK_PROMPT_VERSION, type CitedAnswerSnapshot } from '../shared/cited-ask-api'

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
function fixture(
  t: test.TestContext,
  beforeGenerate?: () => Promise<void>,
  extra: Partial<BriefDependencies> = {},
  syntheticAnswer: 'answered' | 'insufficient-evidence' = 'answered'
): Fixture {
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
    resolveAcknowledged: async (anchor: Parameters<typeof resolveOriginalSource>[1]) =>
      resolveOriginalSource(context, anchor)
  }
  const cited = new MainCitedAskService({
    sources,
    activity,
    validateModel: async () => true,
    generate: async (input) => {
      await beforeGenerate?.()
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
          status: syntheticAnswer,
          claims:
            syntheticAnswer === 'insufficient-evidence'
              ? []
              : [
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
  const originalDigests = new WeakMap<object, string>()
  const original = async (id: string): ReturnType<BriefDependencies['originals']['get']> => {
    try {
      const bytes = readFileSync(join(meetingsDir, id + '.json'))
      const raw = JSON.parse(bytes.toString())
      const projected = projectSources(raw, context.scope)
      if (!projected) return null
      const result = {
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
      originalDigests.set(result, result.rawSha256)
      return result
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
      assertCurrent: (original) => {
        const bytes = readFileSync(join(meetingsDir, original.meetingId + '.json'))
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          originalDigests.get(original),
          'Original changed'
        )
      }
    },
    publish: (_owner, view) => views.push(view),
    activity,
    ...extra
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

test('host invalidation clears display synchronously and waits for consumer cleanup without reinference', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  let entered!: () => void
  const ready = new Promise<void>((r) => {
    entered = r
  })
  let release!: () => void
  const held = new Promise<void>((r) => {
    release = r
  })
  const run = f.cited.run.bind(f.cited)
  f.cited.run = async (...args) => {
    entered()
    await held
    return run(...args)
  }
  const generating = f.briefs.generate('window', opened.sessionId, 'held', {})
  await ready
  let drained = false
  const invalidating = Promise.resolve(f.briefs.invalidate()).then(() => {
    drained = true
  })
  assert.equal(f.views.at(-1)?.event, undefined)
  assert.equal(f.views.at(-1)?.result, undefined)
  await new Promise((r) => setImmediate(r))
  try {
    assert.equal(drained, false)
  } finally {
    release()
  }
  await invalidating
  assert.equal((await generating).result, undefined)
  assert.equal(f.generated(), 0)
})

test('a revoked forget preview cannot escape after its final await', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  const preview = f.store.previewForget.bind(f.store)
  f.store.previewForget = async (...args) => {
    const result = await preview(...args)
    f.disconnect()
    return result
  }
  await assert.rejects(f.briefs.previewForget('window', opened.sessionId), /unavailable/)
})

test('an original edited during final awaited reconciliation cannot publish or cache its earlier claim', async (t) => {
  const f = fixture(t)
  const opened = await f.briefs.open('window', f.event.id)
  await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
  const validate = f.cited.validate.bind(f.cited)
  let validations = 0
  let finalValidationFinished = false
  f.cited.validate = async (...args) => {
    const result = await validate(...args)
    if (++validations === 2) {
      assert.equal(result.status, 'valid')
      finalValidationFinished = true
    }
    return result
  }
  const read = f.store.read.bind(f.store)
  let edited = false
  f.store.read = async (...args) => {
    if (finalValidationFinished && !edited) {
      f.put('old', 'Orchid was cancelled. Do not ship Friday.')
      edited = true
    }
    return read(...args)
  }
  const answer = await f.briefs.generate('window', opened.sessionId, 'race-source', {})
  assert.equal(edited, true)
  assert.equal(answer.result, undefined)
  assert.ok(f.views.every((v) => !v.result))
  const refreshed = await f.briefs.refresh('window', opened.sessionId)
  assert.equal(refreshed.result, undefined)
  assert.equal(f.generated(), 1)
})

for (const teardown of ['dispose', 'closeOwner'] as const) {
  test(`${teardown} joins an already-closing operation before shared registration`, async (t) => {
    const f = fixture(t)
    const opened = await f.briefs.open('window', f.event.id)
    let entered!: () => void, release!: () => void
    const ready = new Promise<void>((r) => {
      entered = r
    })
    const held = new Promise<void>((r) => {
      release = r
    })
    const run = f.cited.run.bind(f.cited)
    f.cited.run = async (...args) => {
      entered()
      await held
      return run(...args)
    }
    const generating = f.briefs.generate('window', opened.sessionId, 'held', {})
    await ready
    let closed = false,
      disposed = false
    const closing = f.briefs.close('window', opened.sessionId).then(() => {
      closed = true
    })
    const disposing = (
      teardown === 'dispose' ? f.briefs.dispose() : f.briefs.closeOwner('window')
    ).then(() => {
      disposed = true
    })
    try {
      await new Promise((r) => setImmediate(r))
      assert.equal(closed, false)
      assert.equal(disposed, false)
    } finally {
      release()
      await Promise.all([generating, closing, disposing])
    }
    assert.ok(f.views.every((v) => !v.result))
  })
}

test('IPC uninstall waits for the actual BriefService close handler and late consumer cleanup', async (t) => {
  const { installBriefIpc } = await import('./brief-ipc')
  const { CitedRendererOwners } = await import('./cited-ask-host')
  const { BRIEFS_INVOKE } = await import('../shared/briefs-api')
  const f = fixture(t)
  const renderer = { id: 1, mainFrame: {}, isDestroyed: () => false, send: () => {} }
  const owners = new CitedRendererOwners(() => renderer)
  const event = { sender: renderer, senderFrame: renderer.mainFrame }
  const handlers = new Map<string, (e: typeof event, request: unknown) => Promise<unknown>>()
  const off = installBriefIpc({
    ipc: {
      handle: (k, h) => {
        handlers.set(k, h)
      },
      removeHandler: (k) => {
        handlers.delete(k)
      }
    },
    owners,
    service: f.briefs,
    enabled: () => true
  })
  const invoke = (method: string, args: unknown[]): Promise<unknown> =>
    handlers.get(BRIEFS_INVOKE)!(event, { method, args })
  const opened = (await invoke('open', [f.event.id])) as BriefView
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((r) => {
    entered = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const run = f.cited.run.bind(f.cited)
  f.cited.run = async (...args) => {
    entered()
    await held
    return run(...args)
  }
  const generating = invoke('generate', [opened.sessionId, 'held', {}]).catch(() => {})
  await ready
  let closed = false,
    disposed = false
  const closing = invoke('close', [opened.sessionId])
    .catch(() => {})
    .finally(() => {
      closed = true
    })
  const disposing = off().then(() => {
    disposed = true
  })
  try {
    await new Promise((r) => setImmediate(r))
    assert.equal(closed, false)
    assert.equal(disposed, false)
    assert.equal(handlers.size, 0)
  } finally {
    release()
    await Promise.all([generating, closing, disposing])
  }
})

for (const changed of ['source', 'context'] as const) {
  test(`final admission rejects ${changed} changes at the last validation await`, async (t) => {
    const f = fixture(t)
    const opened = await f.briefs.open('window', f.event.id)
    await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
    const validate = f.cited.validate.bind(f.cited)
    let validations = 0
    f.cited.validate = async (...args) => {
      const result = await validate(...args)
      if (++validations === 3) {
        if (changed === 'source') f.put('old', 'Cancelled')
        else {
          const path = join(f.root, 'calendar-context-v1.json')
          writeFileSync(path, readFileSync(path, 'utf8') + '\n')
        }
      }
      return result
    }
    const answer = await f.briefs.generate('window', opened.sessionId, 'final-race', {})
    assert.equal(answer.result, undefined)
    assert.ok(f.views.every((v) => !v.result))
  })
}

test('dispose joins an already-closing registered shared producer until the synthetic model acknowledges', async (t) => {
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((r) => {
    entered = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const f = fixture(t, async () => {
    entered()
    await held
  })
  const opened = await f.briefs.open('window', f.event.id)
  await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
  const generating = f.briefs.generate('window', opened.sessionId, 'registered', {})
  await ready
  let closed = false,
    disposed = false
  const closing = f.briefs.close('window', opened.sessionId).then(() => {
    closed = true
  })
  const disposing = f.briefs.dispose().then(() => {
    disposed = true
  })
  try {
    await new Promise((r) => setImmediate(r))
    assert.equal(closed, false)
    assert.equal(disposed, false)
  } finally {
    release()
    await Promise.all([generating, closing, disposing])
  }
  assert.ok(f.views.every((v) => !v.result))
})

async function answered(f: Fixture): Promise<BriefView> {
  const opened = await f.briefs.open('window-one', f.event.id)
  await f.briefs.link('window-one', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
  return f.briefs.generate('window-one', opened.sessionId, 'play-answer', {})
}

test('brief playback uses the injected adapter and validates current sources before and after bytes', async (t) => {
  let calls = 0
  const f = fixture(t, undefined, {
    play: async (token, snapshot, evidenceId) => {
      calls++
      assert.equal(token, 'opaque-token')
      assert.equal(evidenceId, snapshot.prompt!.ranges[0]!.id)
      return { bytes: new Uint8Array([1, 2]), mime: 'audio/wav', seekSeconds: 2 }
    }
  })
  const result = await answered(f)
  let validations = 0
  const validate = f.cited.validate.bind(f.cited)
  f.cited.validate = async (...args) => {
    validations++
    return validate(...args)
  }
  const output = await f.briefs.play(
    'window-one',
    result.sessionId,
    result.result!.snapshot.prompt!.ranges[0]!.id,
    'opaque-token'
  )
  assert.deepEqual(output.bytes, new Uint8Array([1, 2]))
  assert.equal(calls, 1)
  assert.equal(validations, 2)
})

test('brief playback withholds bytes on source or sidecar edits during the audio await', async (t) => {
  for (const kind of ['source', 'context']) {
    const f = fixture(t, undefined, {
      play: async () => {
        if (kind === 'source') f.put('old', 'Orchid changed.')
        else {
          const path = join(f.root, 'calendar-context-v1.json')
          const data = JSON.parse(readFileSync(path, 'utf8'))
          data.extension = 'external edit at same revision'
          writeFileSync(path, JSON.stringify(data))
        }
        return { bytes: new Uint8Array([1]), mime: 'audio/wav', seekSeconds: 0 }
      }
    })
    const result = await answered(f)
    await assert.rejects(
      f.briefs.play(
        'window-one',
        result.sessionId,
        result.result!.snapshot.prompt!.ranges[0]!.id,
        'opaque-token'
      ),
      /unavailable/
    )
    assert.equal(f.views.at(-1)?.result, undefined)
  }
})

test('brief close and relocation wait for held audio; retired bytes never escape', async (t) => {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((r) => {
    entered = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const activity = new LibraryActivity()
  const f = fixture(t, undefined, {
    activity,
    play: async () => {
      entered()
      await held
      return { bytes: new Uint8Array([1]), mime: 'audio/wav', seekSeconds: 0 }
    }
  })
  const result = await answered(f)
  const playing = f.briefs.play(
    'window-one',
    result.sessionId,
    result.result!.snapshot.prompt!.ranges[0]!.id,
    'opaque-token'
  )
  const rejected = assert.rejects(playing, /unavailable/)
  await started
  let closed = false,
    moved = false
  const closing = f.briefs.close('window-one', result.sessionId).then(() => {
    closed = true
  })
  const moving = activity.exclusive(async () => {
    moved = true
  })
  await new Promise<void>((r) => setImmediate(r))
  assert.equal(closed, false)
  assert.equal(moved, false)
  release()
  await Promise.all([rejected, closing, moving])
  assert.equal(closed, true)
  assert.equal(moved, true)
})

for (const outcome of ['complete', 'no-history', 'insufficient-evidence'] as const) {
  test(`brief prompt policy passes through ${outcome} and rejects old-policy reuse without inference`, async (t) => {
    const f = fixture(t, undefined, {}, outcome === 'insufficient-evidence' ? outcome : 'answered')
    const opened = await f.briefs.open('window', f.event.id)
    if (outcome !== 'no-history')
      await f.briefs.link('window', opened.sessionId, opened.revision!, 'old', { kind: 'event' })
    const run = f.cited.run.bind(f.cited)
    let returned: CitedAnswerSnapshot | undefined
    let historical = false
    f.cited.run = async (...args) => {
      const result = await run(...args)
      if (result.status !== 'error') {
        returned = result.snapshot
        if (historical) returned.promptVersion = 1
      }
      return result
    }
    const answer = await f.briefs.generate('window', opened.sessionId, 'policy-current', {})
    assert.equal(answer.result?.status, outcome)
    assert.equal(answer.result?.snapshot.promptVersion, CITED_ASK_PROMPT_VERSION)
    assert.equal(CITED_ASK_PROMPT_VERSION, 2)
    assert.deepEqual(
      answer.result?.snapshot,
      returned,
      'consumer passes shared snapshots unchanged'
    )
    const generated = f.generated()
    const reused = await f.briefs.refresh('window', opened.sessionId)
    assert.deepEqual(reused.result?.snapshot, answer.result?.snapshot)
    assert.equal(f.generated(), generated, 'refresh validates without generating')

    // The shared service owns policy admission; simulate a historical cached producer result.
    returned!.promptVersion = 1
    const refusedCache = await f.briefs.refresh('window', opened.sessionId)
    assert.equal(refusedCache.result, undefined)
    assert.equal(refusedCache.state, 'unavailable')
    assert.equal(f.generated(), generated)
    historical = true
    const refusedFresh = await f.briefs.generate('window', opened.sessionId, 'policy-old', {})
    assert.equal(refusedFresh.result, undefined)
    assert.equal(refusedFresh.state, 'unavailable')
    historical = false
    const recovered = await f.briefs.generate('window', opened.sessionId, 'policy-new', {})
    assert.equal(recovered.result?.status, outcome)
    assert.equal(recovered.result?.snapshot.promptVersion, CITED_ASK_PROMPT_VERSION)
    if (outcome === 'no-history') assert.equal(f.generated(), 0)
  })
}
