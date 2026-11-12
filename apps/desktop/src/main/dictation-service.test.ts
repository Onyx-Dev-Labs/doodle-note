import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationSettings,
  type DictationStatus,
  type VoiceEnrollOutcome
} from '../shared/dictation-api'
import { BUILTIN_TRANSFORMS } from '../shared/dictation-transforms'
import type {
  HelperDelivery,
  FieldReading,
  HelperStatus,
  HoldKey,
  DeliveryGuards,
  InputState,
  SelectionResult,
  MouseCaptureResult,
  MouseStartResult,
  TargetDescription
} from '../shared/dictation-helper-protocol'
import type { EngineEvent } from '../shared/engine-events'
import { CaptureOwnership } from './capture-ownership'
import {
  DictationService,
  type CleanupRunner,
  type DictationDeps,
  type VoiceLike
} from './dictation-service'
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
    deliverGuards: DeliveryGuards[]
    deliveryFor: ((text: string, guards: DeliveryGuards) => HelperDelivery) | null
    selection: SelectionResult
    mouseCalls: Array<{ button: number | null; swallow: boolean; mode: string }>
    clickListener: (() => void) | null
    restarts: number[]
    mouseResult: MouseStartResult | null
    captureResult: MouseCaptureResult
    input: InputState | null
    /** The order the sound output was silenced and given back, as the helper saw it. */
    audio: string[]
    /** When set, a mute does not finish until this resolves (a helper that is still starting). */
    muteGate: Promise<void> | null
    fnKeyAction: number | null
    inputMonitoring: boolean
    inputMonitoringAccess: 'granted' | 'denied' | 'not-determined' | null
    accessibilityGrantedAfterAsk: boolean | null
    inputMonitoringGrantedAfterAsk: boolean | null
    permissionAsks: string[]
    appInfoCalls: string[][]
    exitListener: (() => void) | null
    holdKeys: HoldKey[]
    toggleKeys: string[]
    toggleListener: (() => void) | null
  }
  setEngineBusy: (busy: boolean) => void
  perms: { mic: 'granted' | 'denied' | 'not-determined'; micAnswer: boolean; micAsked: number }
  startOpts: Array<Record<string, unknown>>
  devices: { list: InputDevice[] }
  sounds: SoundKind[]
  menus: Array<{ items: PillMenuItem[]; pick: (command: PillMenuCommand) => void }>
  shortcuts: Map<string, () => void>
  settingsOpened: number[]
  icons: { calls: string[]; value: string | null; fails: boolean }
  /** What the helper says a watched field holds; the learner polls it. */
  field: { reading: FieldReading; reads: number; stopped: string[]; tick: (() => void) | null }
  settings: DictationSettings
  cleanupCalls: Array<{ mode: string; consent: unknown; signal: AbortSignal }>
  logs: string[]
  /** Every status pushed to the settings page, oldest first. */
  broadcasts: DictationStatus[]
}

function harness(
  options: {
    settings?: Partial<DictationSettings>
    cleanup?: CleanupRunner
    access?: 'granted' | 'denied' | 'not-determined'
    clipboardFails?: boolean
    warm?: () => void
    voice?: VoiceLike
    blockedShortcut?: string
    modelOptions?: {
      localModelLabel: string | null
      byok: { provider: string; model: string; hasKey: boolean } | null
    }
  } = {}
): Harness {
  const settings: DictationSettings = {
    ...DEFAULT_DICTATION_SETTINGS,
    enabled: true,
    // The older tests are about raw words moving through; tidy-up has its own tests.
    tidyLevel: 'off',
    // And those that use the model use short phrases: the short-phrase rule has its own tests.
    fullTidyMinWords: 0,
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
  const logs: string[] = []
  const broadcasts: DictationStatus[] = []
  const startOpts: Harness['startOpts'] = []
  const devices: Harness['devices'] = { list: [] }
  const sounds: SoundKind[] = []
  const menus: Harness['menus'] = []
  const shortcuts = new Map<string, () => void>()
  const settingsOpened: number[] = []
  const icons: Harness['icons'] = { calls: [], value: 'data:image/png;base64,AAAA', fails: false }
  const field: Harness['field'] = {
    reading: { state: 'gone' },
    reads: 0,
    stopped: [],
    tick: null
  }
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
      appPath: '/System/Applications/TextEdit.app',
      hasElement: true,
      accessibility: true,
      role: 'AXTextArea',
      secure: false,
      editable: true
    },
    delivery: { outcome: 'delivered', method: 'ax', verified: true, clipboard: 'untouched' },
    holdListener: null,
    tapListener: null,
    deliverGuards: [],
    deliveryFor: null,
    selection: { ok: true, text: '' },
    mouseCalls: [],
    clickListener: null,
    restarts: [],
    mouseResult: null,
    captureResult: { ok: true, button: 3 },
    input: { muted: false, volume: 0.5 },
    audio: [],
    muteGate: null,
    fnKeyAction: null,
    inputMonitoring: true,
    inputMonitoringAccess: 'granted',
    accessibilityGrantedAfterAsk: false,
    inputMonitoringGrantedAfterAsk: false,
    permissionAsks: [],
    appInfoCalls: [],
    exitListener: null,
    holdKeys: [],
    toggleKeys: [],
    toggleListener: null
  }
  const ownership = new CaptureOwnership()
  let listener: ((event: EngineEvent) => boolean) | null = null
  const deps: DictationDeps = {
    channel: 'dev',
    supported: true,
    settings: {
      get: () => settings,
      update: (patch) => Object.assign(settings, patch),
      setDictionary: (entries) => Object.assign(settings, { dictionary: entries })
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
      listInputDevices: async () => devices.list,
      warmVoice: () => void engineCalls.push('warm-voice')
    },
    ...(options.voice ? { voice: options.voice } : {}),
    ownership,
    helper: {
      available: true,
      status: async (): Promise<HelperStatus> => ({
        accessibility: true,
        inputMonitoring: helper.inputMonitoring,
        secureInput: false,
        conflicts: [],
        holdActive: false,
        mouseActive: false,
        inputMonitoringAccess: helper.inputMonitoringAccess,
        fnKeyAction: helper.fnKeyAction
      }),
      snapshot: async () => helper.target,
      appInfo: async (ids) => {
        helper.appInfoCalls.push(ids)
        return ids
          .filter((id) => id === 'com.tinyspeck.slackmacgap')
          .map((bundleId) => ({ bundleId, name: 'Slack', icon: 'data:image/png;base64,SLACK' }))
      },
      appIcon: async (appPath) => {
        icons.calls.push(appPath)
        if (icons.fails) throw new Error('no icon')
        return icons.value
      },
      deliver: async (_id, text, guards) => {
        delivered.push(text)
        helper.deliverGuards.push(guards ?? {})
        return helper.deliveryFor?.(text, guards ?? {}) ?? helper.delivery
      },
      selection: async () => helper.selection,
      watchRead: async () => {
        field.reads += 1
        return field.reading
      },
      watchStop: (id) => void field.stopped.push(id),
      release: () => {},
      setToggleKey: async (key) => {
        helper.toggleKeys.push(key)
        return key === 'off' || helper.inputMonitoring ? null : 'input-monitoring-denied'
      },
      onKeyToggle: (cb) => {
        helper.toggleListener = cb
        return () => {}
      },
      setHoldKey: async (key) => {
        helper.holdKeys.push(key)
        return null
      },
      onHold: (cb) => {
        helper.holdListener = cb
        return () => {}
      },
      onClick: (cb) => {
        helper.clickListener = cb
        return () => {}
      },
      restart: () => void helper.restarts.push(1),
      setMouseButton: async (button, swallow, mode) => {
        helper.mouseCalls.push({ button, swallow, mode })
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
      muteOutput: async () => {
        await helper.muteGate
        helper.audio.push('mute')
        return true
      },
      restoreOutput: async () => void helper.audio.push('restore'),
      onExit: (cb) => {
        helper.exitListener = cb
        return () => {}
      },
      dispose: async () => {}
    },
    shortcuts: {
      register: (accelerator, callback) => {
        if (accelerator === options.blockedShortcut) return false
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
    ...(options.warm ? { warmCleanupModel: options.warm } : {}),
    cleanupOptions: () => options.modelOptions ?? { localModelLabel: 'Test model', byok: null },
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
    broadcast: (status) => void broadcasts.push(status),
    onMicHeld: (held) => void micHeld.push(held),
    openSettings: () => void settingsOpened.push(1),
    now: () => clock.now,
    every: (_ms, tick) => {
      field.tick = tick
      return () => {
        field.tick = null
      }
    },
    log: (line) => void logs.push(line),
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
    icons,
    field,
    settings,
    cleanupCalls,
    logs,
    broadcasts
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
  const h = harness({ settings: { cleanupMode: 'local', tidyLevel: 'full' } })
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
    settings: { cleanupMode: 'local', tidyLevel: 'full' },
    cleanup: async () => 'Send 250 dollars.'
  })
  await speak(h, 'send 2500 dollars')
  await tick()
  assert.deepEqual(
    h.delivered,
    ['Send 2500 dollars.'],
    'the raw words, with only the style applied'
  )
})

test('cleanup failure keeps the raw transcript and says why', async () => {
  const h = harness({
    settings: { cleanupMode: 'local', tidyLevel: 'full' },
    cleanup: async () => {
      throw new Error('The notes model is busy with another task.')
    }
  })
  await speak(h, 'raw words here')
  await tick()
  assert.deepEqual(h.delivered, ['Raw words here.'])
  assert.ok(
    h.overlay.some((v) => /busy/.test(v.title)),
    'the outcome is shown, not silent'
  )
})

test('cancel during cleanup aborts the request and delivers nothing', async () => {
  const hold: { release?: () => void } = {}
  const h = harness({
    settings: { cleanupMode: 'local', tidyLevel: 'full' },
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

  const noConsent = harness({
    settings: { cleanupMode: 'byok', tidyLevel: 'full', byokConsent: null }
  })
  await speak(noConsent, 'plain words')
  await tick()
  assert.equal(noConsent.cleanupCalls[0]?.consent, null, 'absent consent is handed to the gate')

  const consent = { provider: 'openai', model: 'gpt-x' }
  const withConsent = harness({
    settings: { cleanupMode: 'byok', tidyLevel: 'full', byokConsent: consent }
  })
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

test('delivery reports the helper’s current Accessibility denial and keeps the words', async () => {
  const h = harness()
  h.helper.target = { ...h.helper.target!, accessibility: false, hasElement: false }
  h.helper.delivery = {
    outcome: 'refused',
    reason: 'accessibility-denied',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(h, 'no permission')
  await tick()
  assert.equal(h.helper.deliverGuards[0]?.useCurrentFocus, true)
  assert.equal((await h.service.status()).recoveries[0]?.reason, 'accessibility-denied')
  assert.equal(h.service.phase, 'recovery')
})

test('secure and unsupported targets are retained, not typed', async () => {
  const secure = harness()
  secure.helper.target = { ...secure.helper.target!, secure: true }
  secure.helper.delivery = {
    outcome: 'refused',
    reason: 'secure-field',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(secure, 'password field')
  await tick()
  assert.equal((await secure.service.status()).recoveries[0]?.reason, 'secure-field')
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

test('plain dictation follows current focus even when its starting field was unavailable or secure', async () => {
  for (const initial of [
    { secure: true },
    { hasElement: false },
    { accessibility: false, hasElement: false },
    { editable: false, role: 'AXButton' }
  ]) {
    const h = harness()
    h.helper.target = { ...h.helper.target!, ...initial }
    h.helper.deliveryFor = (_text, guards) =>
      guards.useCurrentFocus
        ? { outcome: 'delivered', method: 'paste', verified: true, clipboard: 'restored' }
        : { outcome: 'refused', reason: 'focus-changed', verified: false, clipboard: 'untouched' }
    await speak(h, 'the newly selected chat box')
    assert.equal(h.delivered.length, 1)
    assert.equal(h.helper.deliverGuards[0]?.useCurrentFocus, true)
    assert.equal(h.service.phase, 'notice')
    assert.deepEqual((await h.service.status()).recoveries, [])
    h.service.dispose()
  }
})

test('secure keyboard input is reported separately from a password field', async () => {
  const h = harness()
  h.helper.delivery = {
    outcome: 'refused',
    reason: 'secure-input',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(h, 'keep these words')
  assert.equal((await h.service.status()).recoveries[0]?.reason, 'secure-input')
  assert.match(lastView(h).title, /secure keyboard input/i)
  assert.doesNotMatch(lastView(h).title, /secure field/i)
  h.service.dispose()
})

test('popup copy reports clipboard success and dismissal keeps the transcript available', async () => {
  const h = harness()
  h.helper.delivery = {
    outcome: 'refused',
    reason: 'no-target',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(h, 'words to keep')
  const gen = lastView(h).gen!
  assert.equal(await h.service.onOverlayAction('copy', gen), true)
  assert.deepEqual(h.clipboard, ['words to keep'])
  h.service.onOverlayAction('dismiss', gen)
  assert.equal(h.service.phase, 'idle')
  assert.equal((await h.service.status()).recoveries[0]?.text, 'words to keep')
  assert.equal(await h.service.copyRecovery(gen), true)
  finish(h)
  await h.service.pasteLast()
  assert.equal(h.delivered.at(-1), 'words to keep')
  h.service.dispose()
})

test('popup copy reports failed and missing clipboard requests truthfully', async () => {
  const h = harness({ clipboardFails: true })
  h.helper.delivery = {
    outcome: 'refused',
    reason: 'no-target',
    verified: false,
    clipboard: 'untouched'
  }
  await speak(h, 'retry these words')
  assert.equal(await h.service.onOverlayAction('copy', lastView(h).gen), false)
  assert.equal(await h.service.onOverlayAction('copy', null), false)
  assert.equal(await h.service.onOverlayAction('copy', -1), false)
  assert.equal((await h.service.status()).recoveries[0]?.text, 'retry these words')
  h.service.dispose()
})

test('notice dismissal waits for the overlay countdown instead of a competing timer', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const h = harness()
  try {
    await speak(h, 'a completed message')
    assert.equal(h.service.phase, 'notice')
    mock.timers.tick(30_000)
    assert.equal(h.service.phase, 'notice', 'hover can keep the popup open beyond ten seconds')
    h.service.onOverlayAction('dismiss', lastView(h).gen)
    assert.equal(h.service.phase, 'idle')
  } finally {
    h.service.dispose()
    mock.timers.reset()
  }
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
    h.clock.now += 10_000
    // The real overlay emits this when its hover-aware countdown expires.
    h.service.onOverlayAction('dismiss', lastView(h).gen)
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

  // A new collision is rejected while both previous registrations stay active.
  const later = harness()
  await later.service.start()
  await later.service.setSettings({ pasteLastShortcut: 'Control+Alt+Shift+C' })
  const after = await later.service.status()
  assert.equal(after.pasteLastShortcut, 'registered')
  assert.equal(after.copyLastShortcut, 'registered')
  assert.match(after.shortcutIssues?.paste ?? '', /Copy last transcript/)
  assert.notEqual(after.settings.pasteLastShortcut, 'Control+Alt+Shift+C')
  assert.ok(later.shortcuts.has('Control+Alt+Shift+C'))
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
    settings: {
      holdKey: 'rightOption',
      holdMouseButton: 3,
      holdMouseSwallow: true,
      holdMouseMode: 'hold'
    }
  })
  await h.service.start()
  assert.deepEqual(h.helper.holdKeys, ['rightOption'])
  assert.deepEqual(h.helper.mouseCalls, [{ button: 3, swallow: true, mode: 'hold' }])
  const status = await h.service.status()
  assert.equal(status.holdKey, 'active')
  assert.equal(status.mouseButton, 'active')
  assert.equal(status.mouseSwallowing, true)
})

test('the mouse button alone works with the hold key off, and clearing it disarms it', async () => {
  const h = harness({ settings: { holdKey: 'off', holdMouseButton: 4 } })
  await h.service.start()
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: 4, swallow: true, mode: 'click' })
  await h.service.setSettings({ holdMouseButton: null })
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: null, swallow: false, mode: 'hold' })
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
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: null, swallow: false, mode: 'hold' })
  assert.equal((await h.service.status()).mouseButton, 'off')
})

test('holding the mouse button dictates exactly like the hold key; a quick click is discarded', async () => {
  const h = harness({ settings: { holdMouseButton: 3, holdMouseMode: 'hold' } })
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
  const h = harness({ settings: { holdKey: 'off', holdMouseButton: 3, holdMouseMode: 'hold' } })
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

/* ---- mouse button, click to start and click to stop ---- */

const click = (h: Harness): void => h.helper.clickListener?.()

test('click mode is the default and is what the helper is armed with', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  assert.deepEqual(h.helper.mouseCalls.at(-1), { button: 3, swallow: true, mode: 'click' })
})

test('one click starts at once; the next click stops, inserts, and nothing is held', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  click(h)
  assert.equal(h.service.phase, 'preparing', 'no waiting for a second tap')
  await ready(h)
  h.clock.now += 5_000
  assert.equal(h.service.phase, 'recording', 'no release is needed or expected')
  click(h)
  assert.equal(h.service.phase, 'finalizing')
  h.emit({ event: 'final', channel: 'mic', text: 'clicked twice' })
  await tick()
  assert.deepEqual(h.delivered, ['clicked twice'])
})

test('a double click does not start a session and stop it in the same breath', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  click(h)
  h.clock.now += 120
  click(h)
  assert.equal(h.service.phase, 'preparing')
  await ready(h)
  h.clock.now += 200
  click(h)
  assert.equal(h.service.phase, 'recording', 'still inside the stray-click guard')
  h.clock.now += 400
  click(h)
  assert.equal(h.service.phase, 'finalizing')
})

test('a click stops a session started from the pill or the shortcut, and Esc still cancels', async () => {
  for (const start of ['pill', 'toggle'] as const) {
    const h = harness({ settings: { holdMouseButton: 3 } })
    await h.service.start()
    if (start === 'pill') h.service.onOverlayAction('pill', null)
    else h.service.toggle()
    await ready(h)
    h.clock.now += 2_000
    click(h)
    assert.equal(h.service.phase, 'finalizing', `${start}: the click ends it`)
  }
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  click(h)
  await ready(h)
  h.service.cancel()
  assert.equal(h.service.phase, 'idle')
  assert.deepEqual(h.delivered, [])
})

test('a mouse click never ends a key hold, and a key hold is not started by a click', async () => {
  const h = harness({
    settings: { holdKey: 'rightOption', holdMouseButton: 3 }
  })
  await h.service.start()
  h.helper.holdListener?.({ phase: 'down', holdId: 1 })
  await ready(h)
  h.clock.now += 2_000
  click(h)
  assert.equal(h.service.phase, 'recording', 'the key owns that session')
  h.helper.holdListener?.({ phase: 'up', holdId: 1 })
  assert.equal(h.service.phase, 'finalizing')
})

test('a click while a session is finishing or a kept-text card is up does not disturb it', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  await h.service.start()
  click(h)
  await ready(h)
  h.clock.now += 2_000
  click(h)
  assert.equal(h.service.phase, 'finalizing')
  h.clock.now += 1_000
  click(h)
  assert.equal(h.service.phase, 'finalizing', 'a third click is not a new session')
})

test('click-started sessions have the hands-free limit and warning', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    const h = harness({ settings: { holdMouseButton: 3 } })
    await h.service.start()
    click(h)
    await ready(h)
    mock.timers.tick(19 * 60_000)
    assert.match(lastView(h).warning ?? '', /one minute/i)
    mock.timers.tick(60_000)
    assert.equal(h.service.phase, 'finalizing')
  } finally {
    mock.timers.reset()
  }
})

test('with no permission yet the mouse trigger is retried once it is granted, then the helper is replaced once', async () => {
  const h = harness({ settings: { holdMouseButton: 3 } })
  h.helper.inputMonitoring = false
  h.helper.mouseResult = { ok: false, failure: 'input-monitoring-denied' }
  await h.service.start()
  assert.equal((await h.service.status()).mouseButton, 'needs-permission')
  // Granted: the next status read re-arms without anyone touching a setting.
  h.helper.inputMonitoring = true
  h.helper.mouseResult = null
  await h.service.status()
  await tick()
  await tick()
  assert.equal((await h.service.status()).mouseButton, 'active')
  assert.equal(h.helper.restarts.length, 0, 'no restart needed when the retry worked')

  const stubborn = harness({ settings: { holdMouseButton: 3 } })
  stubborn.helper.mouseResult = { ok: false, failure: 'input-monitoring-denied' }
  await stubborn.service.start()
  await stubborn.service.status()
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(stubborn.helper.restarts.length, 1, 'replaced once, never in a loop')
  await stubborn.service.status()
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(stubborn.helper.restarts.length, 1)
})

/* ---- tidy-up, styles and transforms ---- */

const allTransforms = (
  autoApplyId: string | null,
  overrides: Partial<DictationSettings['transforms']> = {}
): DictationSettings['transforms'] => ({
  enabled: true,
  autoApply: autoApplyId !== null,
  autoApplyId,
  items: BUILTIN_TRANSFORMS.map((item) => ({ ...item })),
  ...overrides
})

test('Light tidy-up is the default: a brain dump is typed clean, instantly, with no model', async () => {
  const h = harness({ settings: { tidyLevel: 'light' } })
  await speak(h, 'um so i think we should uh go on tuesday')
  assert.deepEqual(h.delivered, ['So I think we should go on tuesday.'])
  assert.equal(h.cleanupCalls.length, 0, 'nothing leaves the process')
  assert.equal(h.service.phase, 'notice')
})

test('Off types exactly what was recognised', async () => {
  const h = harness({ settings: { tidyLevel: 'off' } })
  await speak(h, 'um so i think')
  assert.deepEqual(h.delivered, ['um so i think'])
})

test('the style follows the focused app: relaxed in a chat app, proper elsewhere', async () => {
  const chat = harness({ settings: { tidyLevel: 'light' } })
  chat.helper.target = { ...chat.helper.target!, bundleId: 'com.hnc.Discord', appName: 'Discord' }
  await speak(chat, 'sounds good see you there')
  assert.deepEqual(
    chat.delivered,
    ['Sounds good see you there'],
    'personal messages: no closing full stop'
  )

  const mail = harness({ settings: { tidyLevel: 'light' } })
  mail.helper.target = { ...mail.helper.target!, bundleId: 'com.apple.mail' }
  await speak(mail, 'sounds good see you there')
  assert.deepEqual(mail.delivered, ['Sounds good see you there.'])

  const lower = harness({
    settings: {
      tidyLevel: 'light',
      styles: { personal: 'lowercase', work: 'proper', email: 'proper', other: 'proper' }
    }
  })
  lower.helper.target = { ...lower.helper.target!, bundleId: 'com.apple.MobileSMS' }
  await speak(lower, 'Sounds Good, see you there')
  assert.deepEqual(lower.delivered, ['sounds good, see you there'])
})

test('an app the user moved gets its new category, and recent apps are offered for placing', async () => {
  const h = harness({
    settings: {
      tidyLevel: 'light',
      styleApps: { personal: ['com.apple.TextEdit'], work: [], email: [], other: [] }
    }
  })
  await speak(h, 'see you soon')
  assert.deepEqual(h.delivered, ['See you soon'])
  const status = await h.service.status()
  assert.deepEqual(status.recentApps, [{ bundleId: 'com.apple.TextEdit', name: 'TextEdit' }])
})

test('Full tidy-up uses the model, then the style; the model call is bounded and counted', async () => {
  const h = harness({
    settings: { tidyLevel: 'full' },
    cleanup: async () => 'we should go on Tuesday'
  })
  await speak(h, 'um we should uh go on Tuesday')
  await tick()
  assert.deepEqual(h.delivered, ['We should go on Tuesday.'])
  assert.equal(h.cleanupCalls.length, 1)
  assert.equal(h.cleanupCalls[0]?.mode, 'local')
  const stages = (await h.service.status()).lastLatency!.stages
  assert.equal(typeof stages.tidyMs, 'number')
  assert.equal(stages.transformMs, null)
})

test('Full tidy-up with no model available quietly uses Light and never calls anything', async () => {
  const h = harness({
    settings: { tidyLevel: 'full' },
    modelOptions: { localModelLabel: null, byok: null }
  })
  await speak(h, 'um so i think so')
  assert.deepEqual(h.delivered, ['So I think so.'])
  assert.equal(h.cleanupCalls.length, 0)
  assert.equal((await h.service.status()).model.path, 'none')
})

test('a provider without consent is not used; with consent it is, and the consent is passed on', async () => {
  const provider = { provider: 'openai', model: 'gpt-x', hasKey: true }
  const without = harness({
    settings: { tidyLevel: 'full' },
    modelOptions: { localModelLabel: null, byok: provider }
  })
  await speak(without, 'plain words here')
  assert.equal(without.cleanupCalls.length, 0)
  assert.equal((await without.service.status()).model.path, 'needs-consent')
  const consent = { provider: 'openai', model: 'gpt-x' }
  const withConsent = harness({
    settings: { tidyLevel: 'full', byokConsent: consent },
    modelOptions: { localModelLabel: null, byok: provider },
    cleanup: async () => 'Plain words here.'
  })
  await speak(withConsent, 'plain words here')
  await tick()
  assert.equal(withConsent.cleanupCalls[0]?.mode, 'byok')
  assert.deepEqual(withConsent.cleanupCalls[0]?.consent, consent)
  assert.deepEqual(withConsent.delivered, ['Plain words here.'])
})

test('auto-apply runs a transform after tidy-up and style, and offers View and Undo', async () => {
  const h = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(h, 'um we should really go there soon')
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['We should go.'])
  assert.match(h.cleanupCalls[0]?.mode ?? '', /local/)
  assert.equal(lastView(h).title, 'Changed by Make it shorter.')
  assert.equal(lastView(h).controls.view, true)
  assert.equal(lastView(h).controls.undo, true)
  assert.equal((await h.service.status()).hasLastChange, true)
  const stages = (await h.service.status()).lastLatency!.stages
  assert.equal(typeof stages.transformMs, 'number', 'counted in the timing metrics')
  assert.ok(h.metrics.some((record) => typeof record.transformMs === 'number'))
})

test('a failing auto-applied transform inserts the text before it and says so', async () => {
  const h = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('polish') },
    cleanup: async () => {
      throw new Error('The notes model is busy with another task.')
    }
  })
  await speak(h, 'send it on friday')
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['Send it on friday.'])
  assert.equal((await h.service.status()).hasLastChange, false)
  assert.ok(h.overlay.some((v) => /Polish: The notes model is busy/.test(v.title)))
})

test('View shows the words that changed; Dismiss and starting to dictate clear the panel', async () => {
  const h = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(h, 'we should really go there soon')
  await tick()
  await tick()
  h.service.onOverlayAction('view', null)
  const view = lastView(h)
  assert.equal(view.title, 'Make it shorter: before and after')
  assert.ok(view.diff && view.diff.some((part) => part.op === 'del'))
  assert.ok(view.diff?.some((part) => part.op === 'same'))
  h.service.onOverlayAction('dismiss', null)
  assert.notEqual(lastView(h).title, 'Make it shorter: before and after')
  h.service.onOverlayAction('view', null)
  finish(h)
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.equal(lastView(h).mode, 'session', 'a new dictation takes the pill back')
})

test('Undo puts the old text back through the verified insertion, and keeps it when the field changed', async () => {
  const h = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(h, 'we should really go there soon')
  await tick()
  await tick()
  finish(h)
  h.helper.deliverGuards.length = 0
  h.delivered.length = 0
  await h.service.undoLastChange()
  assert.deepEqual(h.delivered, ['We should really go there soon.'])
  assert.deepEqual(
    h.helper.deliverGuards,
    [{ replace: 'We should go.' }],
    'it replaces the one copy of the new text'
  )
  assert.equal(lastView(h).title, 'Put back.')
  assert.equal((await h.service.status()).hasLastChange, false)

  const changed = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(changed, 'we should really go there soon')
  await tick()
  await tick()
  finish(changed)
  changed.helper.deliveryFor = () => ({
    outcome: 'refused',
    reason: 'text-changed',
    verified: false,
    clipboard: 'untouched'
  })
  await changed.service.undoLastChange()
  assert.equal(changed.service.phase, 'recovery', 'never forced in, never lost')
  const kept = (await changed.service.status()).recoveries[0]
  assert.equal(kept?.text, 'We should really go there soon.')
  assert.equal(kept?.reason, 'text-changed')
})

test('a transform hotkey rewrites the selection and replaces exactly that selection', async () => {
  const items = BUILTIN_TRANSFORMS.map((item) =>
    item.id === 'polish' ? { ...item, hotkey: 'Control+Alt+1' } : { ...item }
  )
  const h = harness({
    settings: { transforms: allTransforms(null, { items }) },
    cleanup: async () => 'This text is clearer now.'
  })
  h.helper.selection = { ok: true, text: 'this text is kinda unclear' }
  await h.service.start()
  assert.ok(h.shortcuts.has('Control+Alt+1'))
  assert.equal((await h.service.status()).transformShortcuts.polish, 'registered')
  h.shortcuts.get('Control+Alt+1')?.()
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['This text is clearer now.'])
  assert.deepEqual(h.helper.deliverGuards.at(-1), { expectSelection: 'this text is kinda unclear' })
  assert.equal(lastView(h).title, 'Changed by Polish.')
  assert.match(h.cleanupCalls[0]?.mode ?? '', /local/)
})

test('with no selection a transform works on the last dictation and types the result', async () => {
  const h = harness({
    settings: { transforms: allTransforms(null) },
    cleanup: async () => 'Clearer words.'
  })
  await h.service.start()
  await speak(h, 'some rough words')
  finish(h)
  h.clock.now += 5_000
  await h.service.runTransform('polish')
  assert.deepEqual(h.delivered.at(-1), 'Clearer words.')
  assert.deepEqual(h.helper.deliverGuards.at(-1), {})
  assert.equal(h.cleanupCalls.length, 1)
  h.shortcuts.get(DEFAULT_DICTATION_SETTINGS.pasteLastShortcut)?.()
  await tick()
  await tick()
  assert.equal(h.delivered.at(-1), 'Clearer words.', 'paste last now holds the rewrite')
})

test('a transform with nothing to work on says so and calls no model', async () => {
  const h = harness({ settings: { transforms: allTransforms(null) } })
  await h.service.start()
  await h.service.runTransform('polish')
  assert.match(lastView(h).title, /Select some text first/)
  assert.equal(h.cleanupCalls.length, 0)
})

test('a selection in a secure field is never read', async () => {
  const h = harness({
    settings: { transforms: allTransforms(null) },
    cleanup: async () => 'Safe.'
  })
  h.helper.target = { ...h.helper.target!, secure: true }
  h.helper.selection = { ok: true, text: 'a password' }
  await h.service.start()
  await h.service.runTransform('polish')
  assert.equal(h.cleanupCalls.length, 0, 'the secret never goes to a model')
})

test('if the selection changed while the model worked, the result is kept, not typed over something else', async () => {
  const h = harness({
    settings: { transforms: allTransforms(null) },
    cleanup: async () => 'Rewritten text.'
  })
  h.helper.selection = { ok: true, text: 'original words' }
  h.helper.deliveryFor = () => ({
    outcome: 'refused',
    reason: 'selection-changed',
    verified: false,
    clipboard: 'untouched'
  })
  await h.service.start()
  await h.service.runTransform('polish')
  assert.equal(h.service.phase, 'recovery')
  assert.equal((await h.service.status()).recoveries[0]?.text, 'Rewritten text.')
  assert.equal((await h.service.status()).hasLastChange, false)
})

test('a doubtful rewrite changes nothing and says why', async () => {
  const h = harness({
    settings: { transforms: allTransforms(null) },
    cleanup: async () => 'We meet at 6 pm.'
  })
  h.helper.selection = { ok: true, text: 'we meet at 5 pm' }
  await h.service.start()
  await h.service.runTransform('polish')
  assert.deepEqual(h.delivered, [])
  assert.match(lastView(h).title, /Polish: The rewrite changed a number\. Nothing was changed\./)
})

test('transforms need a model, and say which step is missing', async () => {
  const none = harness({
    settings: { transforms: allTransforms(null) },
    modelOptions: { localModelLabel: null, byok: null }
  })
  await none.service.start()
  await none.service.runTransform('polish')
  assert.match(lastView(none).title, /notes model on this Mac or your own provider/)
  const provider = harness({
    settings: { transforms: allTransforms(null) },
    modelOptions: {
      localModelLabel: null,
      byok: { provider: 'openai', model: 'gpt-x', hasKey: true }
    }
  })
  await provider.service.start()
  await provider.service.runTransform('polish')
  assert.match(lastView(provider).title, /Allow sending text to openai/)
  assert.equal(provider.cleanupCalls.length, 0)
})

test('transforms are opt-in: off means no hotkeys and no runs', async () => {
  const items = BUILTIN_TRANSFORMS.map((item) => ({ ...item, hotkey: 'Control+Alt+2' }))
  const h = harness({ settings: { transforms: allTransforms(null, { enabled: false, items }) } })
  h.helper.selection = { ok: true, text: 'something' }
  await h.service.start()
  assert.ok(!h.shortcuts.has('Control+Alt+2'))
  await h.service.runTransform('polish')
  assert.equal(h.cleanupCalls.length, 0)
  await h.service.setSettings({ transforms: allTransforms(null, { items: items.slice(0, 1) }) })
  assert.ok(h.shortcuts.has('Control+Alt+2'), 'turning it on registers the hotkeys')
  await h.service.setSettings({ transforms: allTransforms(null, { enabled: false, items }) })
  assert.ok(!h.shortcuts.has('Control+Alt+2'), 'and turning it off releases them')
})

test('transform hotkeys cannot shadow the other shortcuts or each other', async () => {
  const items = [
    { ...BUILTIN_TRANSFORMS[0]!, hotkey: 'Control+Alt+D' },
    { ...BUILTIN_TRANSFORMS[1]!, hotkey: 'Control+Alt+Shift+V' },
    { ...BUILTIN_TRANSFORMS[2]!, hotkey: 'Control+Alt+3' },
    { ...BUILTIN_TRANSFORMS[3]!, hotkey: 'control+alt+3' },
    { ...BUILTIN_TRANSFORMS[4]!, hotkey: 'Control+Alt+4' }
  ]
  const h = harness({ settings: { transforms: allTransforms(null, { items }) } })
  await h.service.start()
  const status = await h.service.status()
  assert.equal(
    status.transformShortcuts.polish,
    'conflict',
    'the toggle shortcut keeps its combination'
  )
  assert.equal(status.transformShortcuts.shorter, 'conflict')
  assert.equal(
    status.pasteLastShortcut,
    'conflict',
    'a clash blocks every member of it, paste last included'
  )
  assert.equal(status.transformShortcuts['friendly-email'], 'conflict')
  assert.equal(status.transformShortcuts.bullets, 'conflict')
  assert.equal(status.transformShortcuts['ai-prompt'], 'registered')
  assert.ok(!h.shortcuts.has('Control+Alt+3'))
  assert.ok(h.shortcuts.has('Control+Alt+4'))
})

test('the pill menu lists the transforms and the last change; picking one runs it', async () => {
  const h = harness({
    settings: { transforms: allTransforms(null) },
    cleanup: async () => 'Better words.'
  })
  h.helper.selection = { ok: true, text: 'some words' }
  await h.service.start()
  h.service.onOverlayAction('menu', null)
  await tick()
  const labels = h.menus[0]!.items.map((item) => item.label)
  assert.ok(labels.includes('Rewrite the selection or the last thing you said'))
  assert.ok(!labels.includes('Undo the last change'), 'nothing to undo yet')
  const rewrite = h.menus[0]!.items.find((item) => item.label?.startsWith('Rewrite'))!
  assert.deepEqual(
    rewrite.submenu!.map((item) => item.label),
    BUILTIN_TRANSFORMS.map((item) => item.name)
  )
  h.menus[0]!.pick({ kind: 'transform', id: 'polish' })
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['Better words.'])
  h.service.onOverlayAction('dismiss', null)
  h.service.onOverlayAction('menu', null)
  await tick()
  const later = h.menus[1]!.items.map((item) => item.label)
  assert.ok(later.includes('View the last change'))
  assert.ok(later.includes('Undo the last change'))
})

test('quiet mode hides the "Changed" offer but never an error, and Undo stays in the menu', async () => {
  const quietSettings = { showStatusMessages: false, tidyLevel: 'light' as const }
  const h = harness({
    settings: { ...quietSettings, transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(h, 'we should really go there soon')
  await tick()
  await tick()
  assert.deepEqual(h.delivered, ['We should go.'])
  assert.ok(!h.overlay.some((view) => view.title.startsWith('Changed by')), 'no offer on the pill')
  assert.equal((await h.service.status()).hasLastChange, true, 'but Undo is still there')

  const failing = harness({
    settings: { ...quietSettings, transforms: allTransforms(null) },
    cleanup: async () => 'We meet at 6 pm.'
  })
  failing.helper.selection = { ok: true, text: 'we meet at 5 pm' }
  await failing.service.start()
  await failing.service.runTransform('polish')
  assert.match(lastView(failing).title, /Nothing was changed/, 'errors are always shown')
})

test('what a transform held is forgotten when dictation shuts down', async () => {
  const h = harness({
    settings: { tidyLevel: 'light', transforms: allTransforms('shorter') },
    cleanup: async () => 'We should go.'
  })
  await speak(h, 'we should really go there soon')
  await tick()
  await tick()
  assert.equal((await h.service.status()).hasLastChange, true)
  await h.service.dispose()
  assert.ok(!JSON.stringify(await h.service.status()).includes('We should go'), 'no text in status')
})

/** Start a session and let the target snapshot and its icon arrive. */
async function startListening(h: Harness): Promise<void> {
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  await tick()
}
const lastLive = (h: Harness): OverlayView | undefined =>
  [...h.overlay].reverse().find((view) => view.mode === 'session')

test('the live pill shows the icon of the app the text will go into', async () => {
  const h = harness()
  await startListening(h)
  assert.deepEqual(h.icons.calls, ['/System/Applications/TextEdit.app'])
  assert.deepEqual(lastLive(h)?.target, {
    name: 'TextEdit',
    icon: 'data:image/png;base64,AAAA'
  })
  assert.ok(
    h.overlay.every((view) => view.mode === 'session' || view.target === null),
    'the resting pill and cards never carry the app'
  )
  h.service.toggle()
  await tick()
  h.emit({ event: 'final', channel: 'mic', text: 'hello' })
  await tick()
  finish(h)
})

test('the pill does not wait on the icon: it appears with the app only once the icon is known', async () => {
  const h = harness()
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  // Before the icon has loaded nothing is drawn, so the pill never flashes a placeholder.
  assert.ok(
    h.overlay
      .filter((view) => view.mode === 'session')
      .every((view) => view.target === null || view.target.icon !== null)
  )
  await tick()
  assert.equal(lastLive(h)?.target?.name, 'TextEdit')
})

test('turning the setting off shows no app and never reads an icon', async () => {
  const h = harness({ settings: { showTargetApp: false } })
  await startListening(h)
  assert.equal(lastLive(h)?.target, null)
  assert.deepEqual(h.icons.calls, [])
})

test('a missing icon still names the app, and the miss is not retried every session', async () => {
  const h = harness()
  h.icons.fails = true
  await startListening(h)
  assert.deepEqual(lastLive(h)?.target, { name: 'TextEdit', icon: null })
  h.service.toggle()
  await tick()
  h.emit({ event: 'final', channel: 'mic', text: 'one' })
  await tick()
  finish(h)
  await startListening(h)
  assert.equal(h.icons.calls.length, 1, 'read once per app')
})

test('an app the helper cannot place on disk is named without an icon read', async () => {
  const h = harness()
  delete h.helper.target!.appPath
  await startListening(h)
  assert.deepEqual(lastLive(h)?.target, { name: 'TextEdit', icon: null })
  assert.deepEqual(h.icons.calls, [])
})

/** Run a whole dictation that types `text`, then let the learner poll the field. */
async function dictateAndWatch(h: Harness, text: string): Promise<void> {
  await speak(h, text)
  finish(h)
  await tick()
}
const poll = async (h: Harness): Promise<void> => {
  h.field.tick?.()
  await tick()
}

test('a corrected word is added to the dictionary once the message is gone', async () => {
  const h = harness()
  await dictateAndWatch(h, 'tell Alec the report is ready')
  assert.equal(h.helper.deliverGuards.at(-1)?.watch, true, 'the helper is asked to keep the field')
  assert.ok(h.field.tick, 'a watch is running')
  // The person fixes the name, then sends: the field is cleared.
  h.field.reading = { state: 'ok', value: 'tell Alex the report is ready', focused: true }
  await poll(h)
  assert.equal(h.settings.dictionary.length, 0, 'nothing is learned until the message is gone')
  h.field.reading = { state: 'ok', value: '', focused: true }
  await poll(h)
  assert.deepEqual(
    h.settings.dictionary.map((e) => [e.from, e.to, e.source]),
    [['Alec', 'Alex', 'learned']]
  )
  assert.equal(h.field.tick, null, 'the watch ended')
  assert.equal(h.overlay.at(-1)?.title, 'Added to your dictionary: Alec → Alex')
  assert.ok(!JSON.stringify(h.metrics).includes('Alec'), 'no words in the metrics')
})

test('the next dictation applies what was learned', async () => {
  const h = harness({
    settings: {
      dictionary: [{ id: 'a', from: 'Alec', to: 'Alex', source: 'learned', count: 1, at: 1 }]
    }
  })
  await speak(h, 'tell alec hello')
  assert.deepEqual(h.delivered, ['tell Alex hello'])
})

test('an untouched message and a change of mind teach nothing', async () => {
  const h = harness()
  await dictateAndWatch(h, 'lets meet on Thursday at noon')
  h.field.reading = { state: 'ok', value: 'lets meet on Friday at noon', focused: true }
  await poll(h)
  h.field.reading = { state: 'gone' }
  await poll(h)
  assert.equal(h.settings.dictionary.length, 0)
  assert.equal(h.overlay.at(-1)?.title?.startsWith('Added'), false)
})

test('with learning off the helper is not asked to keep the field and nothing is watched', async () => {
  const h = harness({ settings: { learnFromEdits: false } })
  await dictateAndWatch(h, 'tell Alec hello')
  assert.equal(h.helper.deliverGuards.at(-1)?.watch, undefined)
  assert.equal(h.field.tick, null)
})

test('a secure field is dropped without learning, and switching learning off ends a watch', async () => {
  const h = harness()
  await dictateAndWatch(h, 'tell Alec hello')
  h.field.reading = { state: 'secure' }
  await poll(h)
  assert.equal(h.field.tick, null)
  assert.equal(h.settings.dictionary.length, 0)
  const g = harness()
  await dictateAndWatch(g, 'tell Alec hello')
  assert.ok(g.field.tick)
  await g.service.setSettings({ learnFromEdits: false })
  assert.equal(g.field.tick, null)
})

test('a failed delivery watches nothing', async () => {
  const h = harness()
  h.helper.delivery = {
    outcome: 'refused',
    reason: 'focus-changed',
    verified: false,
    clipboard: 'untouched'
  }
  await dictateAndWatch(h, 'tell Alec hello')
  assert.equal(h.field.tick, null)
})

test('hand-made entries: add, replace, remove, and the page cannot overwrite them', async () => {
  const h = harness()
  assert.deepEqual(await h.service.addDictionaryEntry({ heard: 'alec', written: 'Alex' }), {
    ok: true
  })
  assert.deepEqual(await h.service.addDictionaryEntry({ heard: 'alec', written: 'Alex' }), {
    ok: false,
    reason: 'unchanged'
  })
  assert.deepEqual(await h.service.addDictionaryEntry({ heard: '', written: 'DoodleNote' }), {
    ok: true
  })
  assert.deepEqual(await h.service.addDictionaryEntry({ heard: 'a\nb', written: 'x' }), {
    ok: false,
    reason: 'invalid'
  })
  assert.deepEqual(await h.service.addDictionaryEntry({ heard: 'alec', written: 'Alexa' }), {
    ok: true
  })
  assert.deepEqual(
    h.settings.dictionary.map((e) => [e.from, e.to]),
    [
      ['', 'DoodleNote'],
      ['alec', 'Alexa']
    ]
  )
  const entry = h.settings.dictionary[0]!
  h.service.removeDictionaryEntry(entry.id)
  assert.equal(h.settings.dictionary.length, 1)
  h.service.clearLearnedEntries()
  assert.equal(h.settings.dictionary.length, 1, 'hand-made entries survive')
})

test('app names and icons for the style lists come from the helper once, then from memory', async () => {
  const h = harness()
  const first = await h.service.appInfo(['com.tinyspeck.slackmacgap', 'com.example.missing', 7])
  assert.deepEqual(first, {
    'com.tinyspeck.slackmacgap': { name: 'Slack', icon: 'data:image/png;base64,SLACK' },
    'com.example.missing': { name: null, icon: null }
  })
  await h.service.appInfo(['com.tinyspeck.slackmacgap', 'com.example.missing', 'com.new.app'])
  assert.deepEqual(h.helper.appInfoCalls, [
    ['com.tinyspeck.slackmacgap', 'com.example.missing'],
    ['com.new.app']
  ])
  h.clock.now += 11 * 60_000
  await h.service.appInfo(['com.tinyspeck.slackmacgap'])
  assert.equal(h.helper.appInfoCalls.length, 3, 'asked again after ten minutes')
  assert.deepEqual(await h.service.appInfo('nope'), {})
})

test('a short phrase skips the model and is typed at once, even when the session expected one', async () => {
  const h = harness({ settings: { tidyLevel: 'full', fullTidyMinWords: 12 } })
  await speak(h, 'sounds good see you at three')
  assert.equal(h.cleanupCalls.length, 0, 'no model call')
  assert.equal(h.delivered.length, 1)
  assert.equal(h.delivered[0], 'Sounds good see you at three.')
  assert.equal(h.service.phase, 'notice')
})

test('a long phrase still goes through the model', async () => {
  const h = harness({ settings: { tidyLevel: 'full', fullTidyMinWords: 12 } })
  await speak(
    h,
    'um so I was thinking that we should probably move the meeting to Thursday afternoon'
  )
  assert.equal(h.cleanupCalls.length, 1)
})

test('the local model starts loading as the dictation starts, and only when a model will be used', async () => {
  const warmed: number[] = []
  const withModel = harness({ settings: { tidyLevel: 'full' }, warm: () => void warmed.push(1) })
  withModel.service.toggle()
  await tick()
  assert.equal(warmed.length, 1)
  const light = harness({ settings: { tidyLevel: 'light' }, warm: () => void warmed.push(1) })
  light.service.toggle()
  await tick()
  assert.equal(warmed.length, 1, 'Light never needs the model')
  const provider = harness({
    settings: {
      tidyLevel: 'full',
      cleanupMode: 'byok',
      byokConsent: { provider: 'openai', model: 'gpt-x' }
    },
    modelOptions: {
      localModelLabel: null,
      byok: { provider: 'openai', model: 'gpt-x', hasKey: true }
    },
    warm: () => void warmed.push(1)
  })
  provider.service.toggle()
  await tick()
  assert.equal(warmed.length, 1, 'a hosted provider is not warmed')
})

test('the sound is silenced while recording and comes back when it ends', async () => {
  const h = harness({ settings: { startSound: false } })
  await startListening(h)
  assert.deepEqual(h.helper.audio, ['mute'])
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.deepEqual(h.helper.audio, ['mute', 'restore'], 'back before the words are typed')
  h.emit({ event: 'final', channel: 'mic', text: 'one' })
  await tick()
  finish(h)
  assert.deepEqual(h.helper.audio, ['mute', 'restore'], 'once per recording')
})

test('with the setting off the sound is never touched', async () => {
  const h = harness({ settings: { startSound: false, muteAudioWhileDictating: false } })
  await startListening(h)
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.deepEqual(h.helper.audio, [])
})

test('cancelling a recording gives the sound back', async () => {
  const h = harness({ settings: { startSound: false } })
  await startListening(h)
  h.service.cancel()
  await tick()
  assert.deepEqual(h.helper.audio, ['mute', 'restore'])
})

test('shutting down mid-recording gives the sound back', async () => {
  const h = harness({ settings: { startSound: false } })
  await startListening(h)
  await h.service.dispose()
  await tick()
  assert.deepEqual(h.helper.audio, ['mute', 'restore'])
})

test('a restore never overtakes a mute that is still on its way', async () => {
  const h = harness({ settings: { startSound: false } })
  let open!: () => void
  h.helper.muteGate = new Promise<void>((resolve) => (open = resolve))
  await startListening(h)
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.deepEqual(h.helper.audio, [], 'the helper has not answered the mute yet')
  open()
  await tick()
  assert.deepEqual(h.helper.audio, ['mute', 'restore'])
})

test('the start tone is allowed to finish before the sound is silenced', async () => {
  const h = harness({ settings: { startSound: true } })
  await startListening(h)
  assert.deepEqual(h.helper.audio, [], 'not yet: the tone is playing')
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.deepEqual(h.helper.audio, ['mute'])
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  assert.deepEqual(h.helper.audio, ['mute', 'restore'])
})

test('a recording that ends inside the tone never mutes at all', async () => {
  const h = harness({ settings: { startSound: true } })
  await startListening(h)
  h.clock.now += 1_000
  h.service.toggle()
  await tick()
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.deepEqual(h.helper.audio, ['restore'], 'nothing was muted, so nothing is left muted')
})

/* ---- "Only my voice" ---- */

/** A recorded voice (or none) and a recording that ends however the test says. */
function fakeVoice(initial: { enrolled: boolean }): VoiceLike & {
  state: { enrolled: boolean; enrolling: boolean; devices: Array<string | null> }
  settle: (outcome: VoiceEnrollOutcome) => void
} {
  const state = {
    enrolled: initial.enrolled,
    enrolling: false,
    devices: [] as Array<string | null>
  }
  let resolve: ((outcome: VoiceEnrollOutcome) => void) | null = null
  return {
    state,
    profile: () => (state.enrolled ? { createdAt: 1, deviceName: 'USB Mic' } : null),
    voiceprintPath: () => (state.enrolled ? '/profile/dictation-voiceprint.json' : null),
    get enrolling() {
      return state.enrolling
    },
    enroll: (inputDevice, onEvent) => {
      state.devices.push(inputDevice)
      state.enrolling = true
      onEvent({ type: 'preparing' })
      return new Promise<VoiceEnrollOutcome>((done) => {
        resolve = done
      })
    },
    settle: (outcome) => {
      state.enrolling = false
      if (outcome.ok) state.enrolled = true
      resolve?.(outcome)
    },
    finish: () => {},
    cancel: () => {},
    remove: async () => {
      state.enrolled = false
    }
  }
}

test('only my voice: the recorded voice is handed to the recorder, and only when it is on', async () => {
  const on = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: true }) })
  on.service.toggle()
  await ready(on)
  assert.equal(on.startOpts[0]?.voiceprint, '/profile/dictation-voiceprint.json')

  const off = harness({ settings: { onlyMyVoice: false }, voice: fakeVoice({ enrolled: true }) })
  off.service.toggle()
  await ready(off)
  assert.equal('voiceprint' in off.startOpts[0]!, false)

  const none = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: false }) })
  none.service.toggle()
  await ready(none)
  assert.equal('voiceprint' in none.startOpts[0]!, false, 'on without a voice filters nothing')
})

test('only my voice: the speaker models are warmed when it is on with a voice', async () => {
  const h = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: true }) })
  await h.service.start()
  assert.ok(h.engineCalls.includes('warm-voice'))
  const off = harness({ voice: fakeVoice({ enrolled: true }) })
  await off.service.start()
  assert.ok(!off.engineCalls.includes('warm-voice'))
})

test('only my voice: an empty result after silenced speech says whose voices were heard', async () => {
  const h = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: true }) })
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.emit({ event: 'status', stage: 'transcribing' })
  h.clock.now += 1_000
  h.service.toggle()
  h.emit({
    event: 'final',
    channel: 'mic',
    text: '',
    voiceGate: { keptMs: 0, droppedMs: 2_400, failures: 0, minDistance: 0.88, maxDistance: 0.93 }
  })
  await tick()
  assert.deepEqual(h.delivered, [])
  assert.match(lastView(h).title ?? '', /Only other voices were heard/)
  assert.ok(
    h.logs.some((line) => /voice filter kept=0ms dropped=2400ms.*0\.88\.\.0\.93/.test(line))
  )
})

test('only my voice: silence with nothing filtered is still just silence', async () => {
  const h = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: true }) })
  h.service.toggle()
  await tick()
  h.emit({ event: 'ready', channels: ['mic'] })
  h.clock.now += 1_000
  h.service.toggle()
  h.emit({
    event: 'final',
    channel: 'mic',
    text: '',
    voiceGate: { keptMs: 0, droppedMs: 0, failures: 0 }
  })
  await tick()
  assert.match(lastView(h).title ?? '', /No speech/)
})

test('recording a voice uses the dictation microphone, quiets meeting detection, and turns the filter on', async () => {
  const voice = fakeVoice({ enrolled: false })
  const h = harness({ settings: { microphoneUid: 'usb-1' }, voice })
  h.devices.list = [builtin, usb]
  await h.service.start()
  const events: string[] = []
  const pending = h.service.enrollVoice((event) => void events.push(event.type))
  await tick()
  await tick()
  assert.deepEqual(voice.state.devices, ['usb-1'])
  assert.deepEqual(h.micHeld, [true])
  assert.equal((await h.service.status()).voiceEnrolling, true)

  // Dictation waits for the recording instead of fighting it for the microphone.
  h.service.toggle()
  await tick()
  assert.deepEqual(h.engineCalls, [])
  assert.match(lastView(h).title ?? '', /voice is being recorded/)

  voice.settle({ ok: true })
  assert.deepEqual(await pending, { ok: true })
  // The settings page is told at once: it does not ask again after a recording.
  assert.equal(h.broadcasts.at(-1)?.settings.onlyMyVoice, true)
  assert.equal(h.broadcasts.at(-1)?.voice?.deviceName, 'USB Mic')
  assert.equal(h.broadcasts.at(-1)?.voiceEnrolling, false)
  assert.deepEqual(h.micHeld, [true, false])
  assert.equal(h.settings.onlyMyVoice, true)
  assert.deepEqual(events, ['preparing'])
  const status = await h.service.status()
  assert.equal(status.voiceEnrolling, false)
  assert.equal(status.voice?.deviceName, 'USB Mic')
})

test('a voice recording that fails changes nothing; one is refused while dictating', async () => {
  const voice = fakeVoice({ enrolled: false })
  const h = harness({ voice })
  const pending = h.service.enrollVoice(() => {})
  await tick()
  await tick()
  voice.settle({ ok: false, reason: 'not-enough-speech' })
  assert.deepEqual(await pending, { ok: false, reason: 'not-enough-speech' })
  assert.equal(h.settings.onlyMyVoice, false)
  assert.equal((await h.service.status()).voice, null)

  h.service.toggle()
  await ready(h)
  assert.deepEqual(await h.service.enrollVoice(() => {}), { ok: false, reason: 'busy' })

  const denied = harness({ voice: fakeVoice({ enrolled: false }), access: 'denied' })
  assert.deepEqual(await denied.service.enrollVoice(() => {}), { ok: false, reason: 'microphone' })
})

test('removing the voice turns the filter off', async () => {
  const voice = fakeVoice({ enrolled: true })
  const h = harness({ settings: { onlyMyVoice: true }, voice })
  const before = h.broadcasts.length
  const status = await h.service.removeVoice()
  assert.equal(status.voice, null)
  assert.equal(status.settings.onlyMyVoice, false)
  assert.ok(h.broadcasts.length > before, 'the settings page is told the voice is gone')
  assert.equal(h.broadcasts.at(-1)?.voice, null)
  assert.equal(h.broadcasts.at(-1)?.settings.onlyMyVoice, false)
  h.service.toggle()
  await ready(h)
  assert.equal('voiceprint' in h.startOpts[0]!, false)
})

test('Right Option toggle uses native release listener and suspends while recording a shortcut', async () => {
  const h = harness({ settings: { toggleShortcut: 'Modifier:AltRight', holdKey: 'off' } })
  await h.service.start()
  assert.equal((await h.service.status()).toggleShortcut, 'registered')
  assert.equal(h.helper.toggleKeys.at(-1), 'AltRight')
  assert.equal(h.shortcuts.has('Modifier:AltRight'), false)
  await h.service.setShortcutRecording(true)
  assert.equal(h.helper.toggleKeys.at(-1), 'off')
  assert.equal(h.shortcuts.size, 0)
  h.helper.toggleListener?.()
  assert.equal(h.engineCalls.length, 0)
  await h.service.setShortcutRecording(false)
  assert.equal(h.helper.toggleKeys.at(-1), 'AltRight')
  h.helper.toggleListener?.()
  await tick()
  assert.equal(h.engineCalls[0], 'start')
  await h.service.dispose()
})

test('unavailable replacement preserves the active shortcut and reports no invented owner', async () => {
  const h = harness({ blockedShortcut: 'F8' })
  await h.service.start()
  const before = h.settings.toggleShortcut
  const status = await h.service.setSettings({ toggleShortcut: 'F8' })
  assert.equal(h.settings.toggleShortcut, before)
  assert.equal(status.toggleShortcut, 'registered')
  assert.match(status.shortcutIssues?.toggle ?? '', /previous shortcut was kept/)
  assert.ok(h.shortcuts.has(before))
  await h.service.dispose()
})

test('single ordinary key saves and internal duplicate does not replace it', async () => {
  const h = harness()
  await h.service.start()
  await h.service.setSettings({ toggleShortcut: 'B' })
  assert.ok(h.shortcuts.has('B'))
  const status = await h.service.setSettings({ toggleShortcut: h.settings.copyLastShortcut })
  assert.equal(status.settings.toggleShortcut, 'B')
  assert.match(status.shortcutIssues?.toggle ?? '', /Copy last transcript/)
  await h.service.dispose()
})

test('standalone modifier cannot share the hold-to-talk key', async () => {
  const h = harness({ settings: { holdKey: 'rightOption' } })
  await h.service.start()
  const before = h.settings.toggleShortcut
  const status = await h.service.setSettings({ toggleShortcut: 'Modifier:AltRight' })
  assert.equal(status.settings.toggleShortcut, before)
  assert.match(status.shortcutIssues?.toggle ?? '', /Hold to talk/)
  await h.service.dispose()
})

test('modifier trigger reports Input Monitoring requirement and re-arms after grant', async () => {
  const h = harness({ settings: { toggleShortcut: 'Modifier:AltRight', holdKey: 'off' } })
  h.helper.inputMonitoring = false
  await h.service.start()
  assert.equal((await h.service.status()).toggleShortcut, 'needs-permission')
  h.helper.inputMonitoring = true
  await h.service.status()
  await tick()
  assert.equal((await h.service.status()).toggleShortcut, 'registered')
  await h.service.dispose()
})

test('immediate recorder cancellation restores shortcuts after queued disarming', async () => {
  const h = harness({ settings: { toggleShortcut: 'Modifier:AltRight', holdKey: 'off' } })
  await h.service.start()
  await Promise.all([h.service.setShortcutRecording(true), h.service.setShortcutRecording(false)])
  assert.equal(h.helper.toggleKeys.at(-1), 'AltRight')
  assert.equal((await h.service.status()).toggleShortcut, 'registered')
  await h.service.dispose()
})

test('revoking and restoring Input Monitoring re-arms a formerly active modifier', async () => {
  const h = harness({ settings: { toggleShortcut: 'Modifier:AltRight', holdKey: 'off' } })
  await h.service.start()
  assert.equal((await h.service.status()).toggleShortcut, 'registered')
  h.helper.inputMonitoring = false
  assert.equal((await h.service.status()).toggleShortcut, 'needs-permission')
  const prior = h.helper.toggleKeys.length
  h.helper.inputMonitoring = true
  await h.service.status()
  await tick()
  assert.equal((await h.service.status()).toggleShortcut, 'registered')
  assert.ok(h.helper.toggleKeys.length > prior)
  await h.service.dispose()
})

test('copy and paste callbacks are inert immediately while shortcut suspension is pending', async () => {
  const h = harness()
  await h.service.start()
  await speak(h, 'keep this transcript')
  finish(h)
  h.clock.now += 5000
  const copy = h.shortcuts.get(h.settings.copyLastShortcut)
  const paste = h.shortcuts.get(h.settings.pasteLastShortcut)
  const pending = h.service.setShortcutRecording(true)
  copy?.()
  paste?.()
  await pending
  await tick()
  assert.deepEqual(h.clipboard, [])
  assert.deepEqual(h.delivered, ['keep this transcript'])
  await h.service.setShortcutRecording(false)
  await h.service.copyLast()
  assert.deepEqual(h.clipboard, ['keep this transcript'])
  await h.service.dispose()
})

test('only my voice: a filter that cannot start is said on the pill, not hidden in a log', async () => {
  const h = harness({ settings: { onlyMyVoice: true }, voice: fakeVoice({ enrolled: true }) })
  h.service.toggle()
  await ready(h)
  assert.equal(lastView(h).warning, null)
  h.emit({ event: 'status', stage: 'voice_gate_unavailable', channel: 'mic' })
  assert.match(lastView(h).warning ?? '', /Only my voice could not start/)
  assert.ok(h.logs.includes('engine voice_gate_unavailable'))
  await h.service.dispose()
})
