import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { clipboard, globalShortcut, ipcMain, shell, systemPreferences } from 'electron'
import type { WebContents } from 'electron'
import type { AppChannel } from '../shared/app-channel'
import {
  DICTATION_CANCEL_CHANNEL,
  DICTATION_APP_INFO_CHANNEL,
  DICTATION_CAPTURE_MOUSE_BUTTON_CHANNEL,
  DICTATION_DICTIONARY_ADD_CHANNEL,
  DICTATION_DICTIONARY_CLEAR_LEARNED_CHANNEL,
  DICTATION_DICTIONARY_REMOVE_CHANNEL,
  DICTATION_COPY_LAST_CHANNEL,
  DICTATION_COPY_RECOVERY_CHANNEL,
  DICTATION_DISMISS_RECOVERY_CHANNEL,
  DICTATION_GET_STATUS_CHANNEL,
  DICTATION_OPEN_PRIVACY_CHANNEL,
  DICTATION_OPEN_SETTINGS_EVENT_CHANNEL,
  DICTATION_PASTE_LAST_CHANNEL,
  DICTATION_RUN_TRANSFORM_CHANNEL,
  DICTATION_UNDO_CHANGE_CHANNEL,
  DICTATION_VIEW_CHANGE_CHANNEL,
  DICTATION_REQUEST_PERMISSION_CHANNEL,
  DICTATION_SET_SETTINGS_CHANNEL,
  DICTATION_STATUS_EVENT_CHANNEL,
  DICTATION_TOGGLE_CHANNEL,
  type DictationSettingsUpdate,
  type MicrophoneAccess
} from '../shared/dictation-api'
import type { PermissionPane } from '../shared/dictation-permissions'
import { privacySettingsUrl } from '../shared/dictation-platform'
import { CaptureOwnership } from './capture-ownership'
import {
  DictationHelperClient,
  barkHelperIdentity,
  helperSpawnEnv
} from './dictation-helper-client'
import { HelperIntegrity, resolveHelperExpectation, type HelperHolder } from './helper-integrity'
import { qaHoldPauseMs } from './helper-hold-timing'
import { DictationOverlay } from './dictation-overlay'
import { DictationService, type EngineLike } from './dictation-service'
import { DictationSettingsStore } from './dictation-settings'
import type { NotesService } from './notes-service'

export interface DictationHostOptions {
  channel: AppChannel
  userData: string
  logsDir: string
  helperPath: string
  /** The app runs packaged (app.isPackaged): only the integrity values baked into the build count. */
  packaged?: boolean
  /**
   * Windows: the app identity the helper names its state after. Defaults from the channel
   * (barkHelperIdentity); a build-time identity module (a QA identity) passes its own here.
   */
  helperIdentity?: string | null
  /**
   * Windows: the speech worker's hold on the helper file (WinEngineHost.holdHelper), which also
   * verifies its signature; without it the helper is checked by digest alone (locked:false).
   */
  helperHolder?: HelperHolder | null
  /** The speech engine (macOS sidecar, or Bark's Windows engine); dictation is unavailable without it. */
  engine: EngineLike | null
  /** Defaults to the running platform. */
  platform?: NodeJS.Platform
  /**
   * Windows: the helper reads a microphone by endpoint name, not Chromium's device id.
   * Maps the id the session records from to what the helper's input-state expects.
   */
  inputStateUid?: (uid: string | null) => string | null
  /** Called with whether Bark is on (now, and whenever its status changes): keeps the engine warm. */
  onEnabled?: (enabled: boolean) => void
  notes: () => NotesService | null
  /** The meeting recorder, when it holds or is about to hold the microphone. */
  meetingBusy: () => boolean
  setMicHeld: (held: boolean) => void
  /** Bring the main window forward so the dictation settings page can show. */
  showMainWindow: () => void
  isTrustedSender: (sender: WebContents) => boolean
  broadcast: (channel: string, payload: unknown) => void
}

function isPermissionPane(value: unknown): value is PermissionPane {
  return value === 'microphone' || value === 'accessibility' || value === 'input-monitoring'
}

function microphoneAccess(): MicrophoneAccess {
  try {
    return systemPreferences.getMediaAccessStatus('microphone')
  } catch {
    return 'unknown'
  }
}

/**
 * The engine as the service sees it. Every member of EngineLike is forwarded, the optional Windows
 * ones included (the model-readiness gate and the download retry), so nothing is silently dropped
 * between the engine and the service. The meeting recorder's handshake counts as running.
 */
export function hostEngine(engine: EngineLike, meetingBusy: () => boolean): EngineLike {
  const wrapped: EngineLike = {
    tryStartLive: (opts) => engine.tryStartLive(opts),
    stop: () => engine.stop(),
    get running() {
      return engine.running || meetingBusy()
    },
    get warm() {
      return engine.warm
    },
    listInputDevices: () => engine.listInputDevices?.() ?? Promise.resolve([])
  }
  if (engine.dictationModelState) wrapped.dictationModelState = () => engine.dictationModelState!()
  if (engine.retryDictationModel) wrapped.retryDictationModel = () => engine.retryDictationModel!()
  return wrapped
}

/** Builds the real service from Electron pieces and registers its IPC. */
export function createDictationHost(options: DictationHostOptions): {
  service: DictationService
  ownership: CaptureOwnership
} {
  const ownership = new CaptureOwnership()
  const settings = new DictationSettingsStore(options.userData)
  const platform = options.platform ?? process.platform
  const packaged = options.packaged ?? false
  // Bark's test facilities: an unpackaged run with DOODLENOTE_BARK_TEST_HOOKS=1 only.
  const testHooks = !packaged && process.env.DOODLENOTE_BARK_TEST_HOOKS === '1'
  // Windows only: the helper's integrity is checked lazily, asynchronously and only right before
  // it is spawned, never on its own at startup; a damaged helper is never executed. The helper is
  // spawned when Bark is on, and also with Bark off when this identity has kept clipboard records
  // on disk (the clipboard offers; see DictationService.loadClipboardOffers), so that check (and the
  // speech worker it uses) can then run at app start too.
  const integrity =
    platform === 'win32'
      ? new HelperIntegrity({
          helperPath: options.helperPath,
          expectation: () => resolveHelperExpectation(options.helperPath, packaged),
          holder: options.helperHolder ?? null,
          cachePath: join(options.userData, 'helper-integrity.json'),
          log: (line) => console.error(`[dictation] ${line}`)
        })
      : null
  const client = new DictationHelperClient({
    command: options.helperPath,
    platform,
    ...(integrity
      ? {
          identity: barkHelperIdentity(options.channel, options.helperIdentity),
          verify: async () => {
            const lease = await integrity.acquire()
            // QA only (unpackaged with Bark's test hooks on): hold the lease a while before the spawn,
            // so a test can end the speech worker in the middle of the hold.
            // Capped (helper-hold-timing.ts) so the hold cannot expire inside the spawn path.
            const pause = testHooks
              ? qaHoldPauseMs(process.env.DOODLENOTE_BARK_TEST_HOLD_PAUSE_MS)
              : 0
            if (pause > 0 && lease.locked)
              await new Promise((resolve) => setTimeout(resolve, pause))
            return {
              ok: lease.verdict === 'ok',
              locked: lease.locked,
              confirm: lease.confirm,
              release: lease.release,
              launched: lease.launched
            }
          },
          // A user's environment must not reach the helper's test facilities; only an unpackaged
          // run with Bark's test hooks on passes DICTATION_HELPER_* through.
          env: helperSpawnEnv(process.env, testHooks)
        }
      : {})
  })
  const mapUid = options.inputStateUid
  // Windows only: the same client, with the microphone named the way the helper reads it.
  const helper = mapUid
    ? new Proxy(client, {
        get(target, property) {
          if (property === 'inputState')
            return (uid: string | null) => target.inputState(mapUid(uid))
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
    : client

  // The overlay callback fires only after construction, so the forward reference is safe.
  // The overlay is built before the service it reports to; actions arrive only after both exist.
  const route: { service: DictationService | null } = { service: null }
  const overlay = new DictationOverlay(
    (action, gen, record) => route.service?.onOverlayAction(action, gen, record),
    (edge) => route.service?.onPillEdge(edge)
  )

  const logFile = join(options.logsDir, 'dictation.log')
  const metricsFile = join(options.userData, 'dictation-metrics.jsonl')
  try {
    mkdirSync(options.logsDir, { recursive: true })
  } catch {
    // Logging is best-effort.
  }
  const engine: EngineLike =
    options.engine ??
    ({
      tryStartLive: () => ({
        started: false,
        reason: 'Dictation is not available on this platform.'
      }),
      stop: () => {},
      running: false,
      warm: false
    } as EngineLike)

  const service = new DictationService({
    channel: options.channel,
    supported: options.engine !== null,
    platform,
    ...(integrity
      ? {
          helperIntegrity: () => integrity.state(),
          helperLocked: () => integrity.lastLocked,
          checkHelperIntegrity: () => void integrity.ensure()
        }
      : {}),
    settings,
    // The meeting recorder holds the microphone before the sidecar session
    // exists; treat that handshake as busy too.
    engine: hostEngine(engine, options.meetingBusy),
    ownership,
    helper,
    shortcuts: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    overlay,
    cleanup: async (mode, request, signal, consent) => {
      const notes = options.notes()
      if (!notes) throw new Error('The notes model is not ready yet.')
      const result = await notes.runDictationCleanup(
        mode,
        request.system,
        request.prompt,
        signal,
        consent
      )
      return result.markdown
    },
    warmCleanupModel: () => options.notes()?.warmDictationModel(),
    cleanupOptions: () =>
      options.notes()?.dictationCleanupOptions() ?? { localModelLabel: null, byok: null },
    microphoneAccess,
    requestMicrophone: async () => {
      // Windows shows no per-app microphone prompt; the switch is in Windows Settings.
      if (platform === 'win32') return microphoneAccess() === 'granted'
      try {
        return await systemPreferences.askForMediaAccess('microphone')
      } catch {
        return false
      }
    },
    writeClipboard: (text) => clipboard.writeText(text),
    broadcast: (status) => {
      options.onEnabled?.(status.supported && status.settings.enabled)
      options.broadcast(DICTATION_STATUS_EVENT_CHANNEL, status)
    },
    onMicHeld: options.setMicHeld,
    openSettings: () => {
      options.showMainWindow()
      // A window that had to be recreated needs a moment before it can listen.
      const timer = setTimeout(
        () => options.broadcast(DICTATION_OPEN_SETTINGS_EVENT_CHANNEL, null),
        250
      )
      timer.unref?.()
    },
    now: () => Date.now(),
    // Event names and counts only. Transcript text never reaches a log.
    log: (line) => {
      try {
        appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
      } catch {
        // Best-effort.
      }
    },
    recordMetrics: (record) => {
      if (options.channel !== 'dev') return
      try {
        appendFileSync(metricsFile, `${JSON.stringify(record)}\n`)
      } catch {
        // Best-effort.
      }
    }
  })

  route.service = service
  integrity?.onChange(() => service.helperIntegrityChanged())
  options.onEnabled?.(options.engine !== null && settings.get().enabled)
  const trusted = (event: { sender: WebContents }): boolean => options.isTrustedSender(event.sender)
  ipcMain.handle(DICTATION_GET_STATUS_CHANNEL, (event) =>
    trusted(event) ? service.status() : null
  )
  ipcMain.handle(DICTATION_SET_SETTINGS_CHANNEL, async (event, update: DictationSettingsUpdate) => {
    if (!trusted(event)) return null
    const status = await service.setSettings(update ?? {})
    // Turning Bark on or off from the page does not broadcast; report it here too.
    options.onEnabled?.(status.supported && status.settings.enabled)
    return status
  })
  ipcMain.handle(DICTATION_APP_INFO_CHANNEL, (event, ids: unknown) =>
    trusted(event) ? service.appInfo(ids) : {}
  )
  ipcMain.handle(DICTATION_DICTIONARY_ADD_CHANNEL, (event, entry: unknown) => {
    const value = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    return trusted(event)
      ? service.addDictionaryEntry({ heard: value.heard, written: value.written })
      : { ok: false, reason: 'invalid' }
  })
  ipcMain.handle(DICTATION_DICTIONARY_REMOVE_CHANNEL, (event, id: unknown) => {
    if (trusted(event)) service.removeDictionaryEntry(id)
  })
  ipcMain.handle(DICTATION_DICTIONARY_CLEAR_LEARNED_CHANNEL, (event) => {
    if (trusted(event)) service.clearLearnedEntries()
  })
  ipcMain.handle(DICTATION_TOGGLE_CHANNEL, (event) => {
    if (trusted(event)) service.toggle()
  })
  ipcMain.handle(DICTATION_CANCEL_CHANNEL, (event) => {
    if (trusted(event)) service.cancel()
  })
  ipcMain.handle(DICTATION_PASTE_LAST_CHANNEL, async (event) => {
    if (trusted(event)) await service.pasteLast()
  })
  ipcMain.handle(DICTATION_RUN_TRANSFORM_CHANNEL, async (event, id: unknown) => {
    if (trusted(event) && typeof id === 'string') await service.runTransform(id)
  })
  ipcMain.handle(DICTATION_VIEW_CHANGE_CHANNEL, (event) => {
    if (trusted(event)) service.viewLastChange()
  })
  ipcMain.handle(DICTATION_UNDO_CHANGE_CHANNEL, async (event) => {
    if (trusted(event)) await service.undoLastChange()
  })
  ipcMain.handle(DICTATION_REQUEST_PERMISSION_CHANNEL, (event, pane: unknown) =>
    trusted(event) && isPermissionPane(pane) ? service.requestPermission(pane) : 'unavailable'
  )
  ipcMain.handle(DICTATION_CAPTURE_MOUSE_BUTTON_CHANNEL, (event) =>
    trusted(event)
      ? service.captureMouseButton()
      : { ok: false, message: 'Not available from here.' }
  )
  ipcMain.handle(DICTATION_COPY_LAST_CHANNEL, async (event) => {
    if (trusted(event)) await service.copyLast()
  })
  ipcMain.handle(DICTATION_COPY_RECOVERY_CHANNEL, (event, gen: unknown) =>
    trusted(event) && typeof gen === 'number' ? service.copyRecovery(gen) : false
  )
  ipcMain.handle(DICTATION_DISMISS_RECOVERY_CHANNEL, (event, gen: unknown) => {
    if (trusted(event) && typeof gen === 'number') service.dismissRecovery(gen)
  })
  ipcMain.handle(DICTATION_OPEN_PRIVACY_CHANNEL, (event, pane: unknown) => {
    if (trusted(event) && isPermissionPane(pane)) {
      const url = privacySettingsUrl(platform, pane)
      if (url) void shell.openExternal(url)
    }
  })

  return { service, ownership }
}
