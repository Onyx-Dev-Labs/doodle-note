import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localSourceScope, resolveOriginalSource } from '@repo/meetings-store/sources'
import { retrieveOriginalEvidence, validateOriginalEvidence } from '@repo/meetings-store/evidence'
import { buildCitedAskPrompt } from '@repo/ai'
import { MainCitedAskService } from './cited-ask-service'
import { GlobalChatStore, CITED_CHAT_FALLBACK } from './global-chat-store'
import { HomeCitedController } from './home-cited-controller'
import { LibraryActivity } from './library-activity'

function fixture(t: test.TestContext): {
  root: string
  file: string
  original: Buffer
  put(text: string): void
  history: string
  store: GlobalChatStore
  activity: LibraryActivity
  cited: MainCitedAskService
  controller: HomeCitedController
  owner: import('./cited-ask-host').CitedOwnerLease
  request: import('../shared/home-cited-api').HomeCitedRequest
  generated(): number
  setHold(fn: () => Promise<void>): void
} {
  const root = mkdtempSync(join(tmpdir(), 'dev507-home-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'originals')
  mkdirSync(dir)
  const file = join(dir, 'one.json')
  const put = (text: string): void =>
    writeFileSync(file, JSON.stringify({ id: 'one', rawNotesMarkdown: text }))
  put('Orchid ships Friday.')
  const original = readFileSync(file)
  const context = { meetingsDir: dir, scope: localSourceScope(dir, true), authorized: true }
  const history = join(root, 'global-chat.json')
  writeFileSync(
    history,
    JSON.stringify([
      { question: 'Prior', answer: 'Legacy', askedAt: '2020-01-01', unknown: { retained: true } }
    ])
  )
  const store = new GlobalChatStore(
    () => history,
    () => {}
  )
  const activity = new LibraryActivity()
  let hold = async (): Promise<void> => {}
  let generated = 0
  const cited = new MainCitedAskService({
    activity,
    sources: {
      retrieveEvidence: async (s) => retrieveOriginalEvidence(context, s),
      validateEvidence: async (m) => validateOriginalEvidence(context, m),
      resolveAcknowledged: async (a) => resolveOriginalSource(context, a)
    },
    validateModel: async () => true,
    generate: async (input) => {
      generated++
      await hold()
      const p = buildCitedAskPrompt(input, {
        contextWindowTokens: 16384,
        outputReserveTokens: 4096,
        safetyMarginTokens: 256,
        accounting: 'model-tokenizer',
        countInputTokens: (s, u) => Buffer.byteLength(s + u)
      })
      return {
        rawJson: JSON.stringify({
          status: 'answered',
          claims: [
            {
              id: 'claim',
              kind: 'quotation',
              text: 'model text ignored',
              evidenceIds: [p.inclusion.ranges[0]!.id]
            }
          ]
        }),
        inclusion: p.inclusion,
        engineId: 'local:synthetic',
        modelArtifactRevision: 'synthetic'
      }
    }
  })
  const controller = new HomeCitedController({ store, cited, activity, enabled: () => true })
  const owner = {
    ownerId: 'home-owner',
    signal: new AbortController().signal,
    assertCurrent: () => {}
  }
  const request = { runId: 'run', question: 'Orchid', filters: {} }
  return {
    root,
    file,
    original,
    put,
    history,
    store,
    activity,
    cited,
    controller,
    owner,
    request,
    generated: () => generated,
    setHold: (fn: () => Promise<void>) => {
      hold = fn
    }
  }
}
test('Home saves a safe compatibility entry, preserves unknown fields, and hydrates only currently valid claims', async (t) => {
  const f = fixture(t)
  const result = await f.controller.ask(f.request, f.owner)
  assert.equal(result.status, 'complete')
  assert.equal(result.saved, true)
  const saved = JSON.parse(readFileSync(f.history, 'utf8'))
  assert.equal(saved[1].answer, CITED_CHAT_FALLBACK)
  assert.deepEqual(saved[0].unknown, { retained: true })
  assert.equal((await f.controller.ask(f.request, f.owner)).status, 'complete')
  assert.equal(f.generated(), 1)
  let history = await f.controller.history(f.owner)
  assert.equal(history.entries[0]!.status, 'legacy')
  assert.equal(history.entries[1]!.status, 'valid')
  const range = result.snapshot.prompt!.ranges[0]!
  const view = await f.controller.resolve('run', range.id, f.owner)
  assert.equal(view.status, 'resolved')
  assert.deepEqual(readFileSync(f.file), f.original, 'viewing never writes original')
  f.put('Orchid ships Tuesday.')
  history = await f.controller.history(f.owner)
  const stale = history.entries[1]!
  assert.equal(stale.status, 'stale')
  assert.equal('snapshot' in stale, false)
  assert.equal('answer' in stale, false)
  assert.notEqual((await f.controller.resolve('run', range.id, f.owner)).status, 'resolved')
})
test('clear during inference drains only Home ownership and prevents late persistence', async (t) => {
  const f = fixture(t)
  let begin!: () => void
  let release!: () => void
  const started = new Promise<void>((r) => {
    begin = r
  })
  const hold = new Promise<void>((r) => {
    release = r
  })
  f.setHold(async () => {
    begin()
    await hold
  })
  const running = f.controller.ask(f.request, f.owner)
  await started
  const clearing = f.controller.clear(f.owner)
  let cleared = false
  void clearing.then(() => {
    cleared = true
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(cleared, false)
  release()
  await clearing
  assert.equal((await running).status, 'error')
  assert.deepEqual(f.store.read(), [])
})
test('save failure is explicit and corruption blocks overwrite without exposing unvalidated history', async (t) => {
  const f = fixture(t)
  const before = readFileSync(f.history)
  const store = new GlobalChatStore(
    () => f.history,
    () => {},
    {
      rename: () => {
        throw new Error('synthetic failure')
      }
    }
  )
  const controller = new HomeCitedController({
    store,
    cited: f.cited,
    activity: f.activity,
    enabled: () => true
  })
  const result = await controller.ask(f.request, f.owner)
  assert.equal(result.status, 'complete')
  assert.equal(result.saved, false)
  assert.ok(result.saveError)
  assert.deepEqual(readFileSync(f.history), before)
  writeFileSync(f.history, '{')
  assert.ok((await controller.history(f.owner)).error)
  assert.equal((await controller.ask({ ...f.request, runId: 'other' }, f.owner)).status, 'error')
  assert.equal(readFileSync(f.history, 'utf8'), '{')
})

test('Home clear cannot cancel a calendar-owned shared producer or create calendar history', async (t) => {
  const f = fixture(t)
  let begin!: () => void
  let release!: () => void
  const started = new Promise<void>((r) => {
    begin = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  f.setHold(async () => {
    begin()
    await held
  })
  const calendar = f.cited.run(
    {
      purpose: 'calendar-brief',
      selection: { mode: 'linked-history', meetingIds: ['one'] },
      context: { templateVersion: 1, eventText: 'Synthetic event' },
      consumerRevision: 'current'
    },
    {
      ownerId: 'calendar-owner',
      runId: 'brief',
      signal: new AbortController().signal,
      assertCurrent: () => {}
    }
  )
  await started
  await f.controller.clear(f.owner)
  release()
  assert.equal((await calendar).status, 'complete')
  assert.deepEqual(f.store.read(), [])
})

test('actual Home IPC validates owner, frame and payload; returns immediate coverage with run-scoped phases', async (t) => {
  const { installHomeCitedIpc } = await import('./home-cited-ipc')
  const { CitedRendererOwners } = await import('./cited-ask-host')
  const channels = await import('../shared/home-cited-api')
  const f = fixture(t)
  type Handler = Parameters<import('electron').IpcMain['handle']>[1]
  const handlers = new Map<string, Handler>()
  const sent: Array<{ channel: string; value: unknown }> = []
  const renderer = {
    id: 10,
    mainFrame: {},
    isDestroyed: () => false,
    send: (channel: string, value: unknown) => {
      sent.push({ channel, value })
    }
  }
  const owners = new CitedRendererOwners(() => renderer)
  installHomeCitedIpc({
    ipc: {
      handle: (channel, handler) => {
        handlers.set(channel, handler)
      }
    },
    owners,
    controller: f.controller,
    enabled: () => true
  })
  const event = {
    sender: renderer,
    senderFrame: renderer.mainFrame
  } as unknown as import('electron').IpcMainInvokeEvent
  const call = (channel: string, ...args: unknown[]): unknown =>
    handlers.get(channel)!(event, ...args)
  assert.throws(
    () =>
      handlers.get(channels.HOME_CITED_HISTORY)!({
        ...event,
        senderFrame: {} as typeof event.senderFrame
      }),
    /frame/
  )
  assert.throws(() => call(channels.HOME_CITED_HISTORY, { scope: 'forged' }), /Invalid/)
  const rejected = (await call(channels.HOME_CITED_ASK, {
    ...f.request,
    scope: 'forged',
    manifest: {}
  })) as import('../shared/home-cited-api').HomeCitedResult
  assert.equal(rejected.status, 'error')
  assert.equal(f.generated(), 0)
  const result = (await call(
    channels.HOME_CITED_ASK,
    f.request
  )) as import('../shared/home-cited-api').HomeCitedResult
  assert.equal(result.status, 'complete')
  assert.equal(result.snapshot.evidence.coverage.scanComplete, true)
  assert.ok(sent.length > 0)
  assert.ok(
    sent.every(
      (m) =>
        m.channel === channels.HOME_CITED_PROGRESS && (m.value as { runId: string }).runId === 'run'
    )
  )
  assert.ok(sent.every((m) => !('token' in (m.value as object))))
})

for (const scenario of ['changed-source', 'relocation', 'owner-cancel', 'mapping-failure'] as const)
  test(`Home playback fences ${scenario} and retains library activity through cleanup`, async (t) => {
    const f = fixture(t)
    const result = await f.controller.ask(f.request, f.owner)
    assert.equal(result.status, 'complete')
    const evidenceId = result.snapshot.prompt!.ranges[0]!.id
    const abort = new AbortController()
    const owner = { ...f.owner, signal: abort.signal }
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const began = new Promise<void>((r) => {
      started = r
    })
    const controller = new HomeCitedController({
      store: f.store,
      cited: f.cited,
      activity: f.activity,
      enabled: () => true,
      audio: {
        play: async () => {
          started()
          await held
          if (scenario === 'mapping-failure') throw new Error('synthetic missing recording')
          return { bytes: new Uint8Array([1]), mime: 'audio/wav', seekSeconds: 0 }
        }
      }
    })
    const playing = controller.play('run', evidenceId, 'synthetic-token', owner)
    await began
    let entered = false
    const moving =
      scenario === 'relocation'
        ? f.activity.exclusive(async () => {
            entered = true
          })
        : null
    if (scenario === 'owner-cancel') abort.abort()
    await new Promise((r) => setImmediate(r))
    assert.equal(entered, false)
    if (scenario === 'changed-source') f.put('Orchid source changed while reading audio.')
    release()
    await assert.rejects(playing, /unavailable/)
    if (moving) {
      await moving
      assert.equal(entered, true)
    } else
      await f.activity.exclusive(async () => {
        entered = true
      })
    assert.equal(entered, true)
  })

test('Home real audio adapter roundtrip returns the cited recording and refuses post-save source changes', async (t) => {
  const { CitedSourceAudio } = await import('./cited-source-audio')
  const f = fixture(t)
  writeFileSync(
    f.file,
    JSON.stringify({
      id: 'one',
      segments: [
        {
          id: 's',
          channel: 'mic',
          text: 'Orchid ships Friday.',
          startMs: 500,
          endMs: 1500,
          absoluteStartMs: 1000500
        }
      ]
    })
  )
  const audioDir = join(f.root, 'audio')
  const part = join(audioDir, 'one', '1000000')
  mkdirSync(part, { recursive: true })
  writeFileSync(
    join(part, 'part.json'),
    JSON.stringify({ startEpochMs: 1000000, durationMs: 5000, channels: 'split' })
  )
  writeFileSync(join(part, 'audio.wav'), 'synthetic PCM stand-in')
  const audio = new CitedSourceAudio(
    () => ({ meetingsDir: join(f.root, 'originals'), audioDir }),
    () => {}
  )
  const controller = new HomeCitedController({
    store: f.store,
    cited: f.cited,
    activity: f.activity,
    enabled: () => true,
    audio
  })
  const result = await controller.ask(f.request, f.owner)
  assert.equal(result.status, 'complete')
  const id = result.snapshot.prompt!.ranges[0]!.id
  const available = await audio.available(result.snapshot, id)
  assert.equal(available.status, 'available')
  if (available.status !== 'available') return
  const playback = await controller.play('run', id, available.token, f.owner)
  assert.equal(Buffer.from(playback.bytes).toString(), 'synthetic PCM stand-in')
  assert.equal(playback.seekSeconds, 0.5)
  f.put('changed original')
  await assert.rejects(controller.play('run', id, available.token, f.owner), /unavailable/)
})

test('mixed prompt-policy history hydrates current answers only and denies old citation/play without changing bytes', async (t) => {
  const f = fixture(t)
  const result = await f.controller.ask(f.request, f.owner)
  assert.equal(result.status, 'complete')
  const saved = JSON.parse(readFileSync(f.history, 'utf8'))
  saved[1].citedAnswer.promptVersion = 1
  saved[1].unknownPolicyField = { preserved: true }
  writeFileSync(f.history, JSON.stringify(saved))
  const before = readFileSync(f.history)
  const range = result.snapshot.prompt!.ranges[0]!
  let audioCalls = 0
  const controller = new HomeCitedController({
    store: f.store,
    cited: f.cited,
    activity: f.activity,
    enabled: () => true,
    audio: {
      play: async () => {
        audioCalls++
        throw new Error('old policy must never reach audio')
      }
    }
  })
  const first = await controller.history(f.owner)
  assert.equal(first.entries[1]!.status, 'stale')
  assert.equal('snapshot' in first.entries[1]!, false)
  assert.equal('answer' in first.entries[1]!, false)
  assert.equal((await controller.resolve('run', range.id, f.owner)).status, 'stale')
  await assert.rejects(controller.play('run', range.id, 'old-token', f.owner), /unavailable/)
  assert.equal(audioCalls, 0)
  assert.equal((await controller.ask(f.request, f.owner)).status, 'error')
  assert.equal(f.generated(), 1)
  assert.deepEqual(
    readFileSync(f.history),
    before,
    'hydration and denied reuse preserve exact bytes'
  )
  const next = await controller.ask({ ...f.request, runId: 'current' }, f.owner)
  assert.equal(next.status, 'complete')
  assert.equal(next.snapshot.promptVersion, 2)
  const hydrated = await controller.history(f.owner)
  assert.deepEqual(
    hydrated.entries.map((e) => e.status),
    ['legacy', 'stale', 'valid']
  )
  assert.deepEqual(JSON.parse(readFileSync(f.history, 'utf8'))[1], saved[1])
  assert.deepEqual(readFileSync(f.file), f.original)
})
