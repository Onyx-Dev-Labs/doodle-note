import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { DEFAULT_DICTATION_SETTINGS, type DictationSettings } from '../shared/dictation-api'
import type {
  HelperDelivery,
  HelperStatus,
  HoldKey,
  InputState,
  MouseCaptureResult,
  MouseStartResult,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import type { EngineEvent } from '../shared/engine-events'
import { CaptureOwnership } from './capture-ownership'
import { DictationService, type CleanupRunner, type DictationDeps } from './dictation-service'
import type { OverlayView } from './dictation-overlay-view'
import type {
  InputDevice,
  PillMenuCommand,
  PillMenuItem,
  SoundKind
} from '../shared/dictation-pill'

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
    tapListener: (() => void) | null
    mouseCalls: Array<{ button: number | null; swallow: boolean }>
    mouseResult: MouseStartResult | null
    captureResult: MouseCaptureResult
    input: InputState | null
    fnKeyAction: number | null
    inputMonitoringAccess: 'granted' | 'denied' | 'not-determined' | null
    accessibilityGrantedAfterAsk: boolean | null
    inputMonitoringGrantedAfterAsk: boolean | null
    permissionAsks: string[]
    exitListener: (() => void) | null
    holdKeys: HoldKey[]
  }
  setEngineBusy: (busy: boolean) => void
  perms: { mic: 'granted' | 'denied' | 'not-determined'; micAnswer: boolean; micAsked: number }
  startOpts: Array<Record<string, unknown>>
  devices: { list: InputDevice[] }
  sounds: SoundKind[]
  menus: Array<{ items: PillMenuItem[]; pick: (command: PillMenuCommand) => void }>
  shortcuts: Map<string, () => void>
  settingsOpened: number[]
  settings: DictationSettings
  cleanupCalls: Array<{ mode: string; consent: unknown; signal: AbortSignal }>
}

function harness(
  options: {
    settings?: Partial<DictationSettings>
    cleanup?: CleanupRunner
    access?: 'granted' | 'denied' | 'not-determined'
    clipboardFails?: boolean
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
  const startOpts: Harness['startOpts'] = []
  const devices: Harness['devices'] = { list: [] }
  const sounds: SoundKind[] = []
  const menus: Harness['menus'] = []
  const shortcuts = new Map<string, () => void>()
  const settingsOpened: number[] = []
  const perms: Harness['perms'] = {
    mic: options.access ?? 'granted',
    micAnswer: true,
    micAsked: 0
  }
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
    tapListener: null,
    mouseCalls: [],
    mouseResult: null,
    captureResult: { ok: true, button: 3 },
    input: { muted: false, volume: 0.5 },
    fnKeyAction: null,
    inputMonitoringAccess: 'granted',
    accessibilityGrantedAfterAsk: false,
    inputMonitoringGrantedAfterAsk: false,
    permissionAsks: [],
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
      tryStartLive: (opts) => {
        startOpts.push({ ...opts })
        if (engineBusy) return { started: false, reason: 'busy' }
        engineCalls.push('start')
        engineBusy = true
        return { started: true }
      },
      stop: () => void engineCalls.push('stop'),
      get running() {
        return engineBusy
      },
      warm: true,
      listInputDevices: async () => devices.list
    },
    ownership,
    helper: {
      available: true,
      status: async (): Promise<HelperStatus> => ({
        accessibility: true,
        inputMonitoring: true,
        secureInput: false,
        conflicts: [],
        holdActive: false,
        mouseActive: false,
        inputMonitoringAccess: helper.inputMonitoringAccess,
        fnKeyAction: helper.fnKeyAction
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
      setMouseButton: async (button, swallow) => {
        helper.mouseCalls.push({ button, swallow })
        return button === null ? null : (helper.mouseResult ?? { ok: true, swallowing: swallow })
      },
      captureMouseButton: async () => helper.captureResult,
      requestAccessibility: async () => {
        helper.permissionAsks.push('accessibility')
        return helper.accessibilityGrantedAfterAsk
      },
      requestInputMonitoring: async () => {
        helper.permissionAsks.push('input-monitoring')
        return helper.inputMonitoringGrantedAfterAsk
      },
      onTap: (cb) => {
        helper.tapListener = cb
        return () => {}
      },
      inputState: async () => helper.input,
      onExit: (cb) => {
        helper.exitListener = cb
        return () => {}
      },
      dispose: async () => {}
    },
    shortcuts: {
      register: (accelerator, callback) => {
        shortcuts.set(accelerator, callback)
        return true
      },
      unregister: (accelerator) => void shortcuts.delete(accelerator)
    },
    overlay: {
      render: (view) => void overlay.push(view),
      dispose: () => {},
      playSound: (kind) => void sounds.push(kind),
      popupMenu: (items, pick) => void menus.push({ items, pick })
    },
    cleanup:
      options.cleanup ??
      (async (mode, _request, signal, consent) => {
        cleanupCalls.push({ mode, consent, signal })
        return 'Cleaned.'
      }),
    cleanupOptions: () => ({ localModelLabel: 'Test model', byok: null }),
    microphoneAccess: () => perms.mic,
    requestMicrophone: async () => {
      perms.micAsked += 1
      if (perms.micAnswer) perms.mic = 'granted'
      else if (perms.mic === 'not-determined') perms.mic = 'denied'
      return perms.micAnswer
    },
    writeClipboard: (text) => {
      if (options.clipboardFails) throw new Error('clipboard unavailable')
      clipboard.push(text)
    },
    broadcast: () => {},
    onMicHeld: (held) => void micHeld.push(held),
    openSettings: () => void settingsOpened.push(1),
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
    perms,
    startOpts,
    devices,
    sounds,
    menus,
    shortcuts,
    settingsOpened,
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

/* ---- the pill, hands-free, microphones, paste last ---- */

const builtin = { uid: 'builtin', name: 'MacBook Pro Microphone', isDefault: true }
const usb = { uid: 'usb-1', name: 'USB Mic', isDefault: false }
const tap = (h: Harness): void => h.helper.tapListener?.()
const lastView = (h: Harness): OverlayView => h.overlay.at(-1)!
const HOUR = 3_600_000

async function ready(h: Harness): Promise<void> {
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.emit({ event: 'status', stage: 'transcribing' })
}

test('with dictation on, the resting pill is shown; off or hidden-by-setting, it is not', async () => {
  const on = harness()
  await on.service.start()
  assert.equal(lastView(on).visible, true)
  assert.equal(lastView(on).mode, 'rest')

  const noPill = harness({ settings: { showPill: false } })
  await noPill.service.start()
  assert.equal(lastView(noPill).visible, false)

  const disabled = harness({ settings: { enabled: false } })
  await disabled.service.start()
  assert.equal(lastView(disabled).visible, false)
})

test('turning the pill setting off hides it and a session still shows its own overlay', async () => {
  const h = harness()
  await h.service.start()
  await h.service.setSettings({ showPill: false })
  assert.equal(lastView(h).visible, false)
  h.service.toggle()
  await tick()
  assert.equal(lastView(h).mode, 'session')
  assert.equal(lastView(h).visible, true)
})

test('clicking the pill starts a hands-free session; Finish stops it and it types once', async () => {
  const h = harness()
  await h.service.start()
  h.service.onOverlayAction('pill', null)
  assert.equal(h.service.phase, 'preparing')
  await ready(h)
  assert.equal(h.service.phase, 'recording')
  h.clock.now += 1_000
  h.service.onOverlayAction('stop', 1)
  assert.equal(h.service.phase, 'finalizing')
  h.emit({ event: 'final', channel: 'mic', text: 'from the pill' })
  await tick()
  assert.deepEqual(h.delivered, ['from the pill'])
})

test('a second click right after the first does not stop the session it just started', async () => {
  const h = harness()
  await h.service.start()
  h.service.onOverlayAction('pill', null)
  await ready(h)
  h.clock.now += 100
  h.service.onOverlayAction('stop', 1)
  assert.equal(h.service.phase, 'recording')
  h.clock.now += 500
  h.service.onOverlayAction('stop', 1)
  assert.equal(h.service.phase, 'finalizing')
})

test('start and stop tones follow the session, and the setting turns them off', async () => {
  const h = harness()
  await h.service.start()
  await speak(h, 'hello')
  assert.deepEqual(h.sounds, ['start', 'stop'])

  const quiet = harness({ settings: { startSound: false } })
  await quiet.service.start()
  await speak(quiet, 'hello')
  assert.deepEqual(quiet.sounds, [])

  const cancelled = harness()
  cancelled.service.toggle()
  await tick()
  cancelled.service.cancel()
  assert.deepEqual(cancelled.sounds, ['start'], 'cancel makes no stop tone')
})

test('two quick taps of the hold key latch hands-free; a third tap stops and types', async () => {
  const h = harness({ settings: { holdKey: 'rightOption' } })
  await h.service.start()
  tap(h)
  assert.equal(h.service.phase, 'idle', 'one tap alone starts nothing')
  h.clock.now += 200
  tap(h)
  assert.equal(h.service.phase, 'preparing')
  assert.equal(lastView(h).controls.cancel, true)
  await ready(h)
  h.clock.now += 5_000
  assert.equal(h.service.phase, 'recording', 'no key is held, yet it keeps recording')
  tap(h)
  assert.equal(h.service.phase, 'finalizing')
  h.emit({ event: 'final', channel: 'mic', text: 'hands free' })
  await tick()
  assert.deepEqual(h.delivered, ['hands free'])
})

test('taps too far apart, or with the double tap off, start nothing', async () => {
  const slow = harness()
  await slow.service.start()
  tap(slow)
  slow.clock.now += 2_000
  tap(slow)
  assert.equal(slow.service.phase, 'idle')

  const off = harness({ settings: { handsFreeDoubleTap: false } })
  await off.service.start()
  tap(off)
  off.clock.now += 100
  tap(off)
  assert.equal(off.service.phase, 'idle')
  assert.deepEqual(off.engineCalls, [])
})

test('a hold pressed right after a tap latches; plain hold-to-talk still works after a pause', async () => {
  const h = harness({ settings: { holdKey: 'rightOption' } })
  await h.service.start()
  tap(h)
  h.clock.now += 250
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await ready(h)
  h.clock.now += 3_000
  h.helper.holdListener?.({ phase: 'up', holdId: 1 })
  assert.equal(h.service.phase, 'recording', 'releasing the latching press does not stop it')
  h.clock.now += 2_000
  h.helper.holdListener?.({ phase: 'down', holdId: 2 })
  assert.equal(h.service.phase, 'finalizing', 'a later press ends it')
  h.emit({ event: 'final', channel: 'mic', text: 'latched' })
  await tick()
  finish(h)
  assert.deepEqual(h.delivered, ['latched'])

  // Well after the last tap, a hold is an ordinary hold-to-talk.
  h.clock.now += 10_000
  h.helper.holdListener?.({ phase: 'down', holdId: 3 })
  await ready(h)
  h.clock.now += 2_000
  h.helper.holdListener?.({ phase: 'up', holdId: 3 })
  assert.equal(h.service.phase, 'finalizing')
})

test('a tap while the previous brief hold is still draining waits for the engine, then starts', async () => {
  const h = harness({ settings: { holdKey: 'rightOption' } })
  await h.service.start()
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await ready(h)
  h.clock.now += 100
  h.helper.holdListener?.({ phase: 'up', holdId: 1 })
  assert.equal(h.service.phase, 'idle', 'a short hold is discarded')
  h.clock.now += 150
  tap(h)
  assert.equal(h.engineCalls.filter((c) => c === 'start').length, 1, 'engine still draining')
  assert.equal(h.service.phase, 'idle')
  h.setEngineBusy(false)
  h.emit({ event: 'exit', code: 0, signal: null })
  assert.equal(h.service.phase, 'preparing')
  assert.equal(h.engineCalls.filter((c) => c === 'start').length, 2)
})

test('hands-free stops itself at 20 minutes and warns at 19', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    const h = harness()
    await h.service.start()
    h.service.toggle()
    await ready(h)
    mock.timers.tick(18 * 60_000 + 59_000)
    assert.equal(lastView(h).warning, null)
    mock.timers.tick(1_000)
    assert.match(lastView(h).warning ?? '', /one minute/i)
    assert.equal(h.service.phase, 'recording')
    mock.timers.tick(59_000)
    assert.equal(h.service.phase, 'recording')
    mock.timers.tick(1_000)
    assert.equal(h.service.phase, 'finalizing', 'the limit finishes the dictation')
    h.emit({ event: 'final', channel: 'mic', text: 'a very long talk' })
    await tick()
    assert.deepEqual(h.delivered, ['a very long talk'])
  } finally {
    mock.timers.reset()
  }
})

test('hold-to-talk keeps its three-minute bound and never warns', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    const h = harness({ settings: { holdKey: 'rightOption' } })
    await h.service.start()
    h.helper.holdListener?.({ phase: 'down', holdId: 1 })
    await ready(h)
    mock.timers.tick(179_000)
    assert.equal(h.service.phase, 'recording')
    assert.equal(lastView(h).warning, null)
    mock.timers.tick(1_000)
    assert.equal(h.service.phase, 'finalizing')
  } finally {
    mock.timers.reset()
  }
})

test('hide for an hour: gone at once, back at the expiry, and persisted meanwhile', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness()
    await h.service.start()
    const start = h.clock.now
    await h.service.setSettings({ pillHiddenUntil: start + HOUR })
    assert.equal(lastView(h).visible, false)
    assert.equal(h.settings.pillHiddenUntil, start + HOUR)
    h.clock.now += HOUR - 1
    mock.timers.tick(HOUR - 1)
    assert.equal(lastView(h).visible, false)
    h.clock.now += 1
    mock.timers.tick(1)
    assert.equal(lastView(h).visible, true)
    assert.equal(h.settings.pillHiddenUntil, null)
  } finally {
    mock.timers.reset()
  }
})

test('the menu item hides the pill for exactly an hour', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness()
    await h.service.start()
    h.service.onOverlayAction('menu', null)
    await tick()
    h.menus[0]!.pick({ kind: 'hide-hour' })
    await tick()
    assert.equal(h.settings.pillHiddenUntil, h.clock.now + HOUR)
    assert.equal(lastView(h).visible, false)
  } finally {
    mock.timers.reset()
  }
})

test('a hidden pill returns when dictation starts from the hotkey', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness()
    await h.service.start()
    await h.service.setSettings({ pillHiddenUntil: h.clock.now + HOUR })
    h.service.toggle()
    await ready(h)
    assert.equal(h.settings.pillHiddenUntil, null)
    h.clock.now += 1_000
    h.service.toggle()
    h.emit({ event: 'final', channel: 'mic', text: 'back' })
    await tick()
    h.clock.now += 5_000
    mock.timers.tick(2_000)
    assert.equal(lastView(h).mode, 'rest')
    assert.equal(lastView(h).visible, true)
  } finally {
    mock.timers.reset()
  }
})

test('a saved hide survives a restart, and an expired one is dropped on launch', async () => {
  const stillHidden = harness({ settings: { pillHiddenUntil: 1_000_000 + 60_000 } })
  await stillHidden.service.start()
  assert.equal(lastView(stillHidden).visible, false)

  const expired = harness({ settings: { pillHiddenUntil: 1_000_000 - 1 } })
  await expired.service.start()
  assert.equal(lastView(expired).visible, true)
  assert.equal(expired.settings.pillHiddenUntil, null)
})

test('dropping the pill near an edge docks and remembers it', async () => {
  const h = harness()
  await h.service.start()
  h.service.onPillEdge('left')
  await tick()
  assert.equal(h.settings.pillEdge, 'left')
  assert.equal(lastView(h).edge, 'left')
  h.service.onPillEdge('left')
  await tick()
  assert.equal(h.settings.pillEdge, 'left')
})

test('the chosen microphone is passed to the recorder', async () => {
  const h = harness({ settings: { microphoneUid: 'usb-1' } })
  h.devices.list = [builtin, usb]
  await h.service.start()
  await tick()
  h.service.toggle()
  await ready(h)
  assert.equal(h.startOpts[0]?.inputDevice, 'usb-1')
  assert.equal(lastView(h).warning, null)
})

test('an unplugged microphone falls back to the default, says so, and keeps the choice', async () => {
  const h = harness({ settings: { microphoneUid: 'usb-1' } })
  h.devices.list = [builtin, usb]
  await h.service.start()
  await tick()
  h.devices.list = [builtin]
  h.clock.now += 10_000
  const status = await h.service.status()
  await tick()
  assert.equal(status.microphoneMissing, false, 'the first answer still has the old list')
  h.service.toggle()
  await ready(h)
  assert.equal('inputDevice' in (h.startOpts[0] ?? {}), false, 'recorded from the default')
  assert.match(lastView(h).warning ?? '', /not found/i)
  assert.equal(h.settings.microphoneUid, 'usb-1', 'the choice returns with the device')
  assert.equal((await h.service.status()).microphoneMissing, true)
})

test('when the engine itself cannot find the device, the pill says so', async () => {
  const h = harness({ settings: { microphoneUid: 'usb-1' } })
  await h.service.start()
  h.service.toggle()
  await ready(h)
  assert.equal(
    h.startOpts[0]?.inputDevice,
    'usb-1',
    'no device list yet, so the choice is passed on'
  )
  h.emit({ event: 'status', stage: 'input_default_fallback' })
  assert.match(lastView(h).warning ?? '', /default/i)
})

test('the menu offers the listed microphones and remembers the pick', async () => {
  const h = harness()
  h.devices.list = [builtin, usb]
  await h.service.start()
  h.service.onOverlayAction('menu', null)
  await tick()
  const mic = h.menus[0]!.items.find((item) => item.label === 'Microphone')!
  assert.deepEqual(
    mic.submenu!.map((item) => item.label),
    ['System default', 'MacBook Pro Microphone', 'USB Mic']
  )
  h.menus[0]!.pick({ kind: 'microphone', uid: 'usb-1' })
  await tick()
  assert.equal(h.settings.microphoneUid, 'usb-1')
  h.menus[0]!.pick({ kind: 'microphone', uid: null })
  await tick()
  assert.equal(h.settings.microphoneUid, null)
})

test('the menu toggles the pill and opens the settings page', async () => {
  const h = harness()
  await h.service.start()
  h.service.onOverlayAction('menu', null)
  await tick()
  h.menus[0]!.pick({ kind: 'toggle-always' })
  await tick()
  assert.equal(h.settings.showPill, false)
  assert.equal(lastView(h).visible, false)
  h.menus[0]!.pick({ kind: 'settings' })
  assert.equal(h.settingsOpened.length, 1)
})

test('paste last types the previous transcript again through the same delivery path', async () => {
  const h = harness()
  await h.service.start()
  await speak(h, 'first words')
  finish(h)
  h.clock.now += 5_000
  h.shortcuts.get(DEFAULT_DICTATION_SETTINGS.pasteLastShortcut)?.()
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['first words', 'first words'])
  assert.equal(lastView(h).title, 'Pasted.')
  assert.equal(h.engineCalls.filter((c) => c === 'start').length, 1, 'no recording involved')
})

test('paste last with nothing to paste, or into a secure field, types nothing', async () => {
  const empty = harness()
  await empty.service.start()
  await empty.service.pasteLast()
  assert.deepEqual(empty.delivered, [])
  assert.match(lastView(empty).title, /no transcript/i)

  const secure = harness()
  await secure.service.start()
  await speak(secure, 'secret words')
  finish(secure)
  secure.helper.target = { ...secure.helper.target!, secure: true }
  secure.clock.now += 5_000
  await secure.service.pasteLast()
  assert.deepEqual(secure.delivered, ['secret words'], 'only the original delivery')
  assert.match(lastView(secure).title, /secure field/i)
})

test('paste last waits while a dictation is running, and the text never reaches status', async () => {
  const h = harness()
  await h.service.start()
  await speak(h, 'remember me')
  finish(h)
  h.clock.now += 5_000
  h.service.toggle()
  await ready(h)
  await h.service.pasteLast()
  assert.deepEqual(h.delivered, ['remember me'])
  const status = await h.service.status()
  assert.equal(status.hasLastTranscript, true)
  assert.ok(!JSON.stringify(status).includes('remember me'))
})

test('the paste-last shortcut is registered, can be turned off, and cannot shadow the toggle', async () => {
  const h = harness()
  await h.service.start()
  assert.ok(h.shortcuts.has('Control+Alt+Shift+V'))
  assert.equal((await h.service.status()).pasteLastShortcut, 'registered')
  await h.service.setSettings({ pasteLastShortcut: '' })
  assert.ok(!h.shortcuts.has('Control+Alt+Shift+V'))
  assert.equal((await h.service.status()).pasteLastShortcut, 'off')

  const clash = harness({ settings: { pasteLastShortcut: 'control+alt+d' } })
  await clash.service.start()
  assert.equal((await clash.service.status()).pasteLastShortcut, 'conflict')
})

test('a muted microphone shows a notice while recording and clears when unmuted', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    const h = harness()
    await h.service.start()
    h.helper.input = { muted: true, volume: 0.4 }
    h.service.toggle()
    await ready(h)
    await tick()
    assert.match(lastView(h).warning ?? '', /muted/i)
    h.helper.input = { muted: false, volume: 0.4 }
    mock.timers.tick(2_000)
    await tick()
    assert.equal(lastView(h).warning, null)
    h.helper.input = { muted: false, volume: 0 }
    mock.timers.tick(2_000)
    await tick()
    assert.match(lastView(h).warning ?? '', /muted/i)
  } finally {
    mock.timers.reset()
  }
})

test('an unreadable input never raises a muted notice', async () => {
  const h = harness()
  await h.service.start()
  h.helper.input = null
  h.service.toggle()
  await ready(h)
  await tick()
  assert.equal(lastView(h).warning, null)
})

/* ---- copy last, and Fn ---- */

test('copy last puts the previous transcript on the clipboard and nothing else', async () => {
  const h = harness()
  await h.service.start()
  await speak(h, 'copy me please')
  finish(h)
  h.clock.now += 5_000
  h.shortcuts.get(DEFAULT_DICTATION_SETTINGS.copyLastShortcut)?.()
  await tick()
  assert.deepEqual(h.clipboard, ['copy me please'])
  assert.equal(lastView(h).title, 'Copied.')
  assert.deepEqual(h.delivered, ['copy me please'], 'only the original delivery typed anything')
  const status = await h.service.status()
  assert.ok(!JSON.stringify(status).includes('copy me please'), 'the text never reaches status')
})

test('copy last with nothing to copy, while recording, or when the clipboard fails', async () => {
  const empty = harness()
  await empty.service.start()
  await empty.service.copyLast()
  assert.deepEqual(empty.clipboard, [])
  assert.match(lastView(empty).title, /no transcript to copy/i)

  const busy = harness()
  await busy.service.start()
  await speak(busy, 'earlier')
  finish(busy)
  busy.clock.now += 5_000
  busy.service.toggle()
  await ready(busy)
  await busy.service.copyLast()
  assert.deepEqual(busy.clipboard, [])
})

test('the copy-last menu item copies; it is enabled only once there is a transcript', async () => {
  const h = harness()
  await h.service.start()
  h.service.onOverlayAction('menu', null)
  await tick()
  const item = (n: number): { enabled?: boolean; label?: string } => h.menus[n]!.items[3]!
  assert.equal(item(0).label, 'Copy the last transcript')
  assert.equal(item(0).enabled, false)
  await speak(h, 'menu copy')
  finish(h)
  h.clock.now += 5_000
  h.service.onOverlayAction('menu', null)
  await tick()
  assert.equal(item(1).enabled, true)
  h.menus[1]!.pick({ kind: 'copy-last' })
  await tick()
  assert.deepEqual(h.clipboard, ['menu copy'])
})

test('copy-last and paste-last shortcuts register, clear, and flag every collision', async () => {
  const h = harness()
  await h.service.start()
  assert.ok(h.shortcuts.has('Control+Alt+Shift+C'))
  assert.equal((await h.service.status()).copyLastShortcut, 'registered')
  await h.service.setSettings({ copyLastShortcut: '' })
  assert.ok(!h.shortcuts.has('Control+Alt+Shift+C'))
  assert.equal((await h.service.status()).copyLastShortcut, 'off')

  const sameAsToggle = harness({ settings: { copyLastShortcut: 'control+alt+d' } })
  await sameAsToggle.service.start()
  assert.equal((await sameAsToggle.service.status()).copyLastShortcut, 'conflict')

  // Both actions on one combination: neither registers, both say so.
  const both = harness({
    settings: { pasteLastShortcut: 'Control+Alt+Shift+K', copyLastShortcut: 'control+alt+shift+k' }
  })
  await both.service.start()
  const status = await both.service.status()
  assert.equal(status.pasteLastShortcut, 'conflict')
  assert.equal(status.copyLastShortcut, 'conflict')
  assert.ok(!both.shortcuts.has('Control+Alt+Shift+K'))

  // Changing one onto the other later releases the one that was registered.
  const later = harness()
  await later.service.start()
  await later.service.setSettings({ pasteLastShortcut: 'Control+Alt+Shift+C' })
  const after = await later.service.status()
  assert.equal(after.pasteLastShortcut, 'conflict')
  assert.equal(after.copyLastShortcut, 'conflict')
  assert.ok(!later.shortcuts.has('Control+Alt+Shift+C'))
})

test('double tap works with Fn as the hold key, and the status carries the macOS Fn setting', async () => {
  const h = harness({ settings: { holdKey: 'fn' } })
  h.helper.fnKeyAction = 2
  await h.service.start()
  assert.deepEqual(h.helper.holdKeys, ['fn'])
  tap(h)
  h.clock.now += 180
  tap(h)
  assert.equal(h.service.phase, 'preparing')
  await ready(h)
  h.clock.now += 4_000
  tap(h)
  assert.equal(h.service.phase, 'finalizing')
  assert.equal((await h.service.status()).fnKeyAction, 2)
})

test('a failing clipboard is reported, and the transcript is not lost', async () => {
  const h = harness({ clipboardFails: true })
  await h.service.start()
  await speak(h, 'still here')
  finish(h)
  h.clock.now += 5_000
  await h.service.copyLast()
  assert.match(lastView(h).title, /could not copy/i)
  assert.equal((await h.service.status()).hasLastTranscript, true)
})

test('the stop-to-text stages are measured and carry durations only', async () => {
  const h = harness()
  h.helper.delivery = {
    outcome: 'delivered',
    method: 'paste',
    verified: true,
    clipboard: 'restored',
    timings: { validateMs: 2, insertMs: 3, confirmMs: 30, settleMs: 0, skippedAx: true }
  }
  h.service.toggle()
  await ready(h)
  h.clock.now += 2_000
  h.service.toggle()
  h.clock.now += 90
  h.emit({ event: 'final', channel: 'mic', text: 'private words', drainMs: 12, finishMs: 41 })
  await tick()
  const stages = (await h.service.status()).lastLatency!.stages
  assert.equal(stages.stopToFinalMs, 90)
  assert.equal(stages.engineDrainMs, 12)
  assert.equal(stages.engineFinishMs, 41)
  assert.equal(stages.finalToDeliverMs, 0)
  assert.equal(stages.targetWaitMs, 0)
  assert.equal(stages.helperRoundTripMs, 0)
  assert.deepEqual(stages.helper, {
    validateMs: 2,
    insertMs: 3,
    confirmMs: 30,
    settleMs: 0,
    skippedAx: true
  })
  assert.equal(stages.stopToDoneMs, 90)
  const record = h.metrics.at(-1)!
  assert.equal(record.helperConfirmMs, 30)
  assert.equal(record.helperSkippedAx, true)
  assert.ok(!JSON.stringify(record).includes('private words'), 'metrics never contain text')
})

test('quiet settings change what the pill shows, from the menu or the settings page', async () => {
  const h = harness()
  await h.service.start()
  h.service.toggle()
  await ready(h)
  h.emit({ event: 'partial', channel: 'mic', text: 'spoken words' })
  assert.equal(lastView(h).detail, 'spoken words')
  h.service.cancel()
  finish(h)
  h.clock.now += 1_000

  h.service.onOverlayAction('menu', null)
  await tick()
  const items = h.menus[0]!.items
  assert.deepEqual(
    items.slice(-2).map((item) => [item.label, item.checked]),
    [
      ["Show what I'm saying", true],
      ['Show status messages', true]
    ]
  )
  h.menus[0]!.pick({ kind: 'toggle-live-text' })
  await tick()
  assert.equal(h.settings.showLiveText, false)
  assert.equal(h.settings.showStatusMessages, true)
  h.menus[0]!.pick({ kind: 'toggle-status' })
  await tick()
  assert.equal(h.settings.showStatusMessages, false)

  const quietFrom = h.overlay.length
  h.service.toggle()
  await ready(h)
  h.emit({ event: 'partial', channel: 'mic', text: 'spoken words' })
  assert.equal(lastView(h).detail, '')
  assert.equal(lastView(h).showStatus, false)
  assert.ok(
    !h.overlay.slice(quietFrom).some((view) => JSON.stringify(view).includes('spoken words')),
    'hidden words never reach the overlay'
  )
})

test('with everything quiet, a missing microphone permission is still shown', async () => {
  const h = harness({
    access: 'denied',
    settings: { showLiveText: false, showStatusMessages: false }
  })
  await h.service.start()
  h.service.toggle()
  await tick()
  assert.equal(lastView(h).visible, true)
  assert.match(lastView(h).title, /Microphone access is off/)
})

/* ---- mouse button trigger ---- */

test('the mouse button is armed next to the hold key, each on its own', async () => {
  const h = harness({
    settings: { holdKey: 'rightOption', holdMouseButton: 3, holdMouseSwallow: true }
  })
  await h.service.start()
  assert.deepEqual(h.helper.holdKeys, ['rightOption'])
  assert.deepEqual(h.helper.mouseCalls, [{ button: 3, swallow: true }])
  const status = await h.service.status()
  assert.equal(status.holdKey, 'active')
  assert.equal(status.mouseButton, 'active')
  assert.equal(status.mouseSwallowing, true)
})

test('the mouse button alone works with the hold key off, and clearing it disarms it', async () => {
  const h = harness({ settings: { holdKey: 'off', holdMouseButton: 4 } })
  await h.service.start()
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: 4, swallow: true })
  await h.service.setSettings({ holdMouseButton: null })
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: null, swallow: false })
  const status = await h.service.status()
  assert.equal(status.mouseButton, 'off')
  assert.equal(status.mouseSwallowing, false)
})

test('a listen-only mouse trigger is reported as not swallowing, a refusal as a problem', async () => {
  const listenOnly = harness({ settings: { holdMouseButton: 3 } })
  listenOnly.helper.mouseResult = { ok: true, swallowing: false }
  await listenOnly.service.start()
  const status = await listenOnly.service.status()
  assert.equal(status.mouseButton, 'active')
  assert.equal(status.mouseSwallowing, false)

  const denied = harness({ settings: { holdMouseButton: 3 } })
  denied.helper.mouseResult = { ok: false, failure: 'input-monitoring-denied' }
  await denied.service.start()
  assert.equal((await denied.service.status()).mouseButton, 'needs-permission')

  const gone = harness({ settings: { holdMouseButton: 3 } })
  gone.helper.mouseResult = { ok: false, failure: 'helper-unavailable' }
  await gone.service.start()
  assert.equal((await gone.service.status()).mouseButton, 'unavailable')
})

test('turning dictation off releases the mouse button too', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  await h.service.setSettings({ enabled: false })
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: null, swallow: false })
  assert.equal((await h.service.status()).mouseButton, 'off')
})

test('holding the mouse button dictates exactly like the hold key; a quick click is discarded', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await ready(h)
  h.clock.now += 2_000
  h.helper.holdListener?.({ phase: 'up', holdId: 1 })
  assert.equal(h.service.phase, 'finalizing')
  h.emit({ event: 'final', channel: 'mic', text: 'from the mouse' })
  await tick()
  assert.deepEqual(h.delivered, ['from the mouse'])
  finish(h)

  h.clock.now += 5_000
  h.helper.holdListener?.({ phase: 'down', holdId: 2 })
  await ready(h)
  h.clock.now += 100
  h.helper.holdListener?.({ phase: 'up', holdId: 2 })
  assert.equal(h.service.phase, 'idle', 'under the tap threshold: nothing is transcribed')
})

test('two quick clicks of the mouse button latch hands-free, with no hold key set', async () => {
  const h = harness({ settings: { holdKey: 'off', holdMouseButton: 3 } })
  await h.service.start()
  tap(h)
  h.clock.now += 200
  tap(h)
  assert.equal(h.service.phase, 'preparing')
  await ready(h)
  h.clock.now += 3_000
  tap(h)
  assert.equal(h.service.phase, 'finalizing')
})

test('capturing a mouse button reports the button, or a plain explanation', async () => {
  const h = harness()
  await h.service.start()
  h.helper.captureResult = { ok: true, button: 4 }
  assert.deepEqual(await h.service.captureMouseButton(), { ok: true, button: 4 })
  h.helper.captureResult = { ok: false, failure: 'primary-button' }
  const refused = await h.service.captureMouseButton()
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.message, /Left and right click cannot be used/)
  h.helper.captureResult = { ok: false, failure: 'timeout' }
  const timedOut = await h.service.captureMouseButton()
  assert.match(timedOut.ok ? '' : timedOut.message, /No button was pressed/)
})

/* ---- asking macOS for permissions ---- */

test('the microphone is asked for from the pill the first time, then the session starts', async () => {
  const h = harness({ access: 'not-determined' })
  await h.service.start()
  h.service.onOverlayAction('pill', null)
  assert.equal(h.perms.micAsked, 1, 'macOS is asked straight away')
  assert.match(lastView(h).title, /Choose Allow/)
  await tick()
  await tick()
  assert.equal(h.service.phase, 'preparing', 'allowed, so the session the user asked for begins')
  assert.deepEqual(h.engineCalls, ['start'])
})

test('a refused microphone prompt explains where to turn it on and starts nothing', async () => {
  const h = harness({ access: 'not-determined' })
  h.perms.micAnswer = false
  await h.service.start()
  h.service.toggle()
  await tick()
  await tick()
  assert.deepEqual(h.engineCalls, [])
  assert.match(lastView(h).title, /Microphone access is off/)
  // Answered once: later starts do not ask again.
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.equal(h.perms.micAsked, 1)
})

test('a hold key released during the first microphone prompt does not record', async () => {
  const h = harness({ access: 'not-determined', settings: { holdKey: 'rightOption' } })
  await h.service.start()
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await tick()
  await tick()
  assert.deepEqual(h.engineCalls, [])
  assert.match(lastView(h).title, /Hold the key again/)
})

test('requestPermission: microphone asks once, then points to System Settings', async () => {
  const h = harness({ access: 'not-determined' })
  await h.service.start()
  assert.equal(await h.service.requestPermission('microphone'), 'granted')
  assert.equal(h.perms.micAsked, 1)
  assert.equal(await h.service.requestPermission('microphone'), 'granted', 'already allowed')
  assert.equal(h.perms.micAsked, 1, 'no second prompt')

  const denied = harness({ access: 'denied' })
  await denied.service.start()
  assert.equal(await denied.service.requestPermission('microphone'), 'open-settings')
  assert.equal(denied.perms.micAsked, 0)

  const refused = harness({ access: 'not-determined' })
  refused.perms.micAnswer = false
  await refused.service.start()
  assert.equal(await refused.service.requestPermission('microphone'), 'denied')
})

test('requestPermission: Accessibility and Input Monitoring are asked for through the helper', async () => {
  const h = harness()
  await h.service.start()
  assert.equal(await h.service.requestPermission('accessibility'), 'prompted')
  h.helper.accessibilityGrantedAfterAsk = true
  assert.equal(await h.service.requestPermission('accessibility'), 'granted')

  h.helper.inputMonitoringAccess = 'not-determined'
  assert.equal(await h.service.requestPermission('input-monitoring'), 'prompted')
  h.helper.inputMonitoringGrantedAfterAsk = true
  assert.equal(await h.service.requestPermission('input-monitoring'), 'granted')
  assert.deepEqual(h.helper.permissionAsks, [
    'accessibility',
    'accessibility',
    'input-monitoring',
    'input-monitoring'
  ])
})

test('Input Monitoring that was already answered opens System Settings instead of asking again', async () => {
  const denied = harness()
  denied.helper.inputMonitoringAccess = 'denied'
  await denied.service.start()
  assert.equal(await denied.service.requestPermission('input-monitoring'), 'open-settings')
  const granted = harness()
  granted.helper.inputMonitoringAccess = 'granted'
  await granted.service.start()
  assert.equal(await granted.service.requestPermission('input-monitoring'), 'granted')
  assert.deepEqual([...denied.helper.permissionAsks, ...granted.helper.permissionAsks], [])
})

test('after a request the status is re-read and broadcast, and carries the helper answer', async () => {
  const h = harness()
  await h.service.start()
  h.helper.inputMonitoringAccess = 'not-determined'
  await h.service.requestPermission('input-monitoring')
  const status = await h.service.status()
  assert.equal(status.permissions.inputMonitoringAccess, 'not-determined')
  assert.equal(status.permissions.accessibility, true)
})

test('permissions cannot be requested once dictation is shut down', async () => {
  const h = harness()
  await h.service.dispose()
  assert.equal(await h.service.requestPermission('accessibility'), 'unavailable')
})
