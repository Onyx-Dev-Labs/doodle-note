import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_DICTATION_SETTINGS, type DictationSettings } from '../shared/dictation-api'
import type {
  HelperDelivery,
  HelperStatus,
  HoldKey,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import type { EngineEvent } from '../shared/engine-events'
import { CaptureOwnership } from './capture-ownership'
import { DictationService, type CleanupRunner, type DictationDeps } from './dictation-service'
import type { OverlayView } from './dictation-overlay-view'

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface Harness {
  service: DictationService
  ownership: CaptureOwnership
  clock: { now: number }
  emit: (event: EngineEvent) => void
  engineCalls: string[]
  delivered: string[]
  overlay: OverlayView[]
  clipboard: string[]
  micHeld: boolean[]
  metrics: Array<Record<string, unknown>>
  helper: {
    target: TargetDescription | null
    delivery: HelperDelivery
    holdListener: ((e: { phase: 'down' | 'up'; holdId: number }) => void) | null
    exitListener: (() => void) | null
    holdKeys: HoldKey[]
  }
  setEngineBusy: (busy: boolean) => void
  settings: DictationSettings
  cleanupCalls: Array<{ mode: string; consent: unknown; signal: AbortSignal }>
}

function harness(
  options: {
    settings?: Partial<DictationSettings>
    cleanup?: CleanupRunner
    access?: 'granted' | 'denied'
  } = {}
): Harness {
  const settings: DictationSettings = {
    ...DEFAULT_DICTATION_SETTINGS,
    enabled: true,
    ...options.settings
  }
  const clock = { now: 1_000_000 }
  const engineCalls: string[] = []
  const delivered: string[] = []
  const overlay: OverlayView[] = []
  const clipboard: string[] = []
  const micHeld: boolean[] = []
  const metrics: Array<Record<string, unknown>> = []
  const cleanupCalls: Harness['cleanupCalls'] = []
  let engineBusy = false
  const helper: Harness['helper'] = {
    target: {
      snapshotId: 'x',
      pid: 1,
      bundleId: 'com.apple.TextEdit',
      appName: 'TextEdit',
      hasElement: true,
      accessibility: true,
      role: 'AXTextArea',
      secure: false,
      editable: true
    },
    delivery: { outcome: 'delivered', method: 'ax', verified: true, clipboard: 'untouched' },
    holdListener: null,
    exitListener: null,
    holdKeys: []
  }
  const ownership = new CaptureOwnership()
  let listener: ((event: EngineEvent) => boolean) | null = null
  const deps: DictationDeps = {
    channel: 'dev',
    supported: true,
    settings: {
      get: () => settings,
      update: (patch) => Object.assign(settings, patch)
    },
    engine: {
      tryStartLive: () => {
        if (engineBusy) return { started: false, reason: 'busy' }
        engineCalls.push('start')
        engineBusy = true
        return { started: true }
      },
      stop: () => void engineCalls.push('stop'),
      get running() {
        return engineBusy
      },
      warm: true
    },
    ownership,
    helper: {
      available: true,
      status: async (): Promise<HelperStatus> => ({
        accessibility: true,
        inputMonitoring: true,
        secureInput: false,
        conflicts: [],
        holdActive: false
      }),
      snapshot: async () => helper.target,
      deliver: async (_id, text) => {
        delivered.push(text)
        return helper.delivery
      },
      release: () => {},
      setHoldKey: async (key) => {
        helper.holdKeys.push(key)
        return null
      },
      onHold: (cb) => {
        helper.holdListener = cb
        return () => {}
      },
      onExit: (cb) => {
        helper.exitListener = cb
        return () => {}
      },
      dispose: async () => {}
    },
    shortcuts: { register: () => true, unregister: () => {} },
    overlay: { render: (view) => void overlay.push(view), dispose: () => {} },
    cleanup:
      options.cleanup ??
      (async (mode, _request, signal, consent) => {
        cleanupCalls.push({ mode, consent, signal })
        return 'Cleaned.'
      }),
    cleanupOptions: () => ({ localModelLabel: 'Test model', byok: null }),
    microphoneAccess: () => options.access ?? 'granted',
    writeClipboard: (text) => void clipboard.push(text),
    broadcast: () => {},
    onMicHeld: (held) => void micHeld.push(held),
    now: () => clock.now,
    log: () => {},
    recordMetrics: (record) => void metrics.push(record)
  }
  // Wrap cleanup to record calls when the caller supplied their own runner too.
  if (options.cleanup) {
    const inner = options.cleanup
    deps.cleanup = async (mode, request, signal, consent) => {
      cleanupCalls.push({ mode, consent, signal })
      return inner(mode, request, signal, consent)
    }
  }
  const service = new DictationService(deps)
  listener = (event) => service.handleEngineEvent(event)
  return {
    service,
    ownership,
    clock,
    emit: (event) => {
      // Mirrors index.ts: events reach dictation first while it owns capture.
      if (service.ownsCapture) listener?.(event)
      if (event.event === 'exit' || event.event === 'spawn-error') engineBusy = false
    },
    engineCalls,
    delivered,
    overlay,
    clipboard,
    micHeld,
    metrics,
    helper,
    setEngineBusy: (busy) => {
      engineBusy = busy
    },
    settings,
    cleanupCalls
  }
}

/** Drive a normal session up to the point where the user stops. */
async function speak(h: Harness, text: string, via: 'toggle' = 'toggle'): Promise<void> {
  void via
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.emit({ event: 'status', stage: 'transcribing' })
  h.clock.now += 1_000
  h.service.toggle()
  h.emit({ event: 'final', channel: 'mic', text })
  await tick()
}
const finish = (h: Harness): void => {
  h.emit({ event: 'done' })
  h.emit({ event: 'exit', code: 0, signal: null })
}

test('raw dictation delivers once, releases the microphone, and records timings only', async () => {
  const h = harness()
  await speak(h, 'hello world')
  assert.deepEqual(h.delivered, ['hello world'])
  assert.equal(h.service.phase, 'notice')
  finish(h)
  assert.equal(h.ownership.owner, null)
  assert.deepEqual(h.micHeld, [true, false])
  assert.equal(h.metrics.length, 1)
  assert.ok(!JSON.stringify(h.metrics).includes('hello'), 'metrics never contain text')
})

test('a meeting holding the engine blocks dictation without touching it', async () => {
  const h = harness()
  h.setEngineBusy(true)
  h.service.toggle()
  await tick()
  assert.deepEqual(h.engineCalls, [], 'the engine is never started over a meeting')
  assert.equal(h.service.phase, 'notice')
  assert.match(h.overlay.at(-1)?.title ?? '', /meeting/i)
  assert.equal(h.ownership.owner, null)
})

test('cancel during transcription: nothing is inserted, the lease outlives the drain', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.clock.now += 1_000
  h.service.toggle() // stop → finalizing
  assert.equal(h.service.phase, 'finalizing')
  h.service.cancel()
  assert.equal(h.service.phase, 'idle')
  assert.equal(h.ownership.owner, 'dictation', 'the sidecar is still draining')
  h.emit({ event: 'final', channel: 'mic', text: 'too late' })
  await tick()
  assert.deepEqual(h.delivered, [])
  // A new start before the sidecar exits is refused politely, not crashed into.
  h.clock.now += 1_000
  h.service.toggle()
  assert.equal(h.engineCalls.filter((c) => c === 'start').length, 1)
  assert.match(h.overlay.at(-1)?.title ?? '', /Finishing the previous dictation/)
  finish(h)
  assert.equal(h.ownership.owner, null)
})

test('a late result from a cancelled session cannot reach the next one', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.service.cancel()
  finish(h)
  h.clock.now += 1_000
  await speak(h, 'second session')
  assert.deepEqual(h.delivered, ['second session'])
})

test('stop during startup drains once the microphone opens', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.clock.now += 400
  h.service.toggle() // stop before ready
  assert.equal(h.service.phase, 'preparing')
  assert.ok(!h.engineCalls.includes('stop'))
  h.emit({ event: 'ready', channels: ['mic'] })
  assert.equal(h.service.phase, 'finalizing')
  assert.ok(h.engineCalls.includes('stop'))
})

test('local cleanup replaces the text; the mode is the one chosen at start', async () => {
  const h = harness({ settings: { cleanupMode: 'local' } })
  h.service.toggle()
  await tick()
  h.settings.cleanupMode = 'raw' // changing settings mid-session applies next time
  h.emit({ event: 'ready', channels: ['mic'] })
  h.clock.now += 1_000
  h.service.toggle()
  h.emit({ event: 'final', channel: 'mic', text: 'um hello there' })
  await tick()
  await tick()
  assert.equal(h.cleanupCalls.length, 1)
  assert.equal(h.cleanupCalls[0]?.mode, 'local')
})

test('cleanup output that changes a number is rejected and the raw text is inserted', async () => {
  const h = harness({
    settings: { cleanupMode: 'local' },
    cleanup: async () => 'Send 250 dollars.'
  })
  await speak(h, 'send 2500 dollars')
  await tick()
  assert.deepEqual(h.delivered, ['send 2500 dollars'])
})

test('cleanup failure keeps the raw transcript and says why', async () => {
  const h = harness({
    settings: { cleanupMode: 'local' },
    cleanup: async () => {
      throw new Error('The notes model is busy with another task.')
    }
  })
  await speak(h, 'raw words here')
  await tick()
  assert.deepEqual(h.delivered, ['raw words here'])
  assert.ok(
    h.overlay.some((v) => /busy/.test(v.title)),
    'the outcome is shown, not silent'
  )
})

test('cancel during cleanup aborts the request and delivers nothing', async () => {
  const hold: { release?: () => void } = {}
  const h = harness({
    settings: { cleanupMode: 'local' },
    cleanup: (_mode, _request, signal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
        hold.release = () => resolve('Cleaned.')
      })
  })
  await speak(h, 'raw words here')
  assert.equal(h.service.phase, 'cleaning')
  h.service.cancel()
  assert.equal(h.cleanupCalls[0]?.signal.aborted, true)
  hold.release?.()
  await tick()
  assert.deepEqual(h.delivered, [])
  assert.equal(h.service.phase, 'idle')
})

test('a provider key alone never triggers cleanup; consent is passed through unaltered', async () => {
  const raw = harness({ settings: { cleanupMode: 'raw' } })
  await speak(raw, 'plain words')
  assert.equal(raw.cleanupCalls.length, 0, 'raw mode never calls any model or provider')

  const noConsent = harness({ settings: { cleanupMode: 'byok', byokConsent: null } })
  await speak(noConsent, 'plain words')
  await tick()
  assert.equal(noConsent.cleanupCalls[0]?.consent, null, 'absent consent is handed to the gate')

  const consent = { provider: 'openai', model: 'gpt-x' }
  const withConsent = harness({ settings: { cleanupMode: 'byok', byokConsent: consent } })
  await speak(withConsent, 'plain words')
  await tick()
  assert.deepEqual(withConsent.cleanupCalls[0]?.consent, consent)
})

test('uncertain delivery is kept for recovery and never retried', async () => {
  const h = harness()
  h.helper.delivery = {
    outcome: 'uncertain',
    reason: 'insertion-unverifiable',
    verified: false,
    clipboard: 'restored'
  }
  await speak(h, 'maybe typed')
  await tick()
  assert.equal(h.delivered.length, 1, 'exactly one delivery attempt')
  assert.equal(h.service.phase, 'recovery')
  const status = await h.service.status()
  assert.equal(status.recoveries[0]?.text, 'maybe typed')
  assert.equal(await h.service.copyRecovery(status.recoveries[0]!.gen), true)
  assert.deepEqual(h.clipboard, ['maybe typed'])
})

test('missing accessibility goes straight to recovery without calling the helper to type', async () => {
  const h = harness()
  h.helper.target = { ...h.helper.target!, accessibility: false, hasElement: false }
  await speak(h, 'no permission')
  await tick()
  assert.deepEqual(h.delivered, [])
  assert.equal(h.service.phase, 'recovery')
})

test('secure and unsupported targets are retained, not typed', async () => {
  const secure = harness()
  secure.helper.target = { ...secure.helper.target!, secure: true }
  await speak(secure, 'password field')
  await tick()
  assert.deepEqual(secure.delivered, [])
  assert.equal(secure.service.phase, 'recovery')

  const changed = harness()
  changed.helper.delivery = {
    outcome: 'refused',
    reason: 'focus-changed',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(changed, 'wrong place')
  await tick()
  assert.equal(changed.service.phase, 'recovery')
  assert.equal((await changed.service.status()).recoveries[0]?.reason, 'focus-changed')
})

test('helper unavailable: text is kept, nothing is lost', async () => {
  const h = harness()
  h.helper.target = null
  await speak(h, 'kept anyway')
  await tick()
  assert.equal(h.service.phase, 'recovery')
  assert.equal((await h.service.status()).recoveries[0]?.reason, 'helper-unavailable')
})

test('hold-to-talk pairs key-down with its own key-up and ignores strays', async () => {
  const h = harness({ settings: { holdKey: 'rightOption' } })
  h.helper.holdListener?.({ phase: 'down', holdId: 4 })
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.helper.holdListener?.({ phase: 'up', holdId: 3 }) // not ours
  assert.equal(h.service.phase, 'recording')
  h.clock.now += 1_500
  h.helper.holdListener?.({ phase: 'up', holdId: 4 })
  assert.equal(h.service.phase, 'finalizing')
  h.emit({ event: 'final', channel: 'mic', text: 'held words' })
  await tick()
  assert.deepEqual(h.delivered, ['held words'])
})

test('a brief accidental hold transcribes nothing', async () => {
  const h = harness()
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.clock.now += 100
  h.helper.holdListener?.({ phase: 'up', holdId: 1 })
  assert.equal(h.service.phase, 'idle')
  assert.ok(h.engineCalls.includes('stop'))
  h.emit({ event: 'final', channel: 'mic', text: 'noise' })
  await tick()
  assert.deepEqual(h.delivered, [])
})

test('losing the helper mid-hold finishes the utterance instead of hanging', async () => {
  const h = harness()
  h.helper.holdListener?.({ phase: 'down', holdId: 2 })
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.clock.now += 1_000
  h.helper.exitListener?.()
  assert.equal(h.service.phase, 'finalizing')
})

test('microphone failure with nothing heard ends cleanly and frees the lease', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.emit({ event: 'error', channel: 'mic', message: 'Microphone is not delivering audio' })
  assert.equal(h.service.phase, 'notice')
  assert.match(h.overlay.at(-1)?.title ?? '', /microphone/i)
  h.emit({ event: 'exit', code: 1, signal: null })
  assert.equal(h.ownership.owner, null)
  assert.deepEqual(h.delivered, [])
})

test('words already heard survive a microphone error', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.emit({ event: 'partial', channel: 'mic', text: 'half a sentence' })
  h.emit({ event: 'error', channel: 'mic', message: 'Microphone is not delivering audio' })
  assert.equal(h.service.phase, 'finalizing', 'drain instead of discard')
})

test('silence inserts nothing', async () => {
  const h = harness()
  await speak(h, '   ')
  assert.deepEqual(h.delivered, [])
  assert.match(h.overlay.at(-1)?.title ?? '', /No speech/)
})

test('disabled dictation ignores the shortcut and never starts the engine', async () => {
  const h = harness({ settings: { enabled: false } })
  h.service.toggle()
  await tick()
  assert.deepEqual(h.engineCalls, [])
  assert.deepEqual(h.micHeld, [])
})

test('denied microphone permission is explained, not attempted', async () => {
  const h = harness({ access: 'denied' })
  h.service.toggle()
  await tick()
  assert.deepEqual(h.engineCalls, [])
  assert.match(h.overlay.at(-1)?.title ?? '', /Microphone access is off/)
})

test('quitting mid-session cancels it and delivers nothing', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  await h.service.dispose()
  h.emit({ event: 'final', channel: 'mic', text: 'after quit' })
  await tick()
  assert.deepEqual(h.delivered, [])
})
