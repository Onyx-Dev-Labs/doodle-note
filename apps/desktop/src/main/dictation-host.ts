import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
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
import { DictationHelperClient } from './dictation-helper-client'
import { DictationOverlay } from './dictation-overlay'
import { DictationService, type EngineLike } from './dictation-service'
import { DictationSettingsStore } from './dictation-settings'
import type { NotesService } from './notes-service'

export interface DictationHostOptions {
  channel: AppChannel
  userData: string
  logsDir: string
  helperPath: string
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
 * How the helper on disk compares with the manifest written beside it at build time:
 * 'absent' missing, 'damaged' a hash mismatch, 'ok' otherwise (including a dev build with no
 * manifest, which cannot be verified). Read once; the helper does not change under a running app.
 */
/**
 * Whether a PE file carries an Authenticode certificate table (security data directory, entry 4).
 * A signed build is trusted as-is: signing rewrites the file, so its bytes no longer match the
 * manifest hash, and Windows itself refuses to run a tampered signed exe (the blocked path). The
 * manifest hash is only a dev-build check for an unsigned, possibly corrupt, helper.
 */
export function peIsAuthenticodeSigned(buffer: Buffer): boolean {
  try {
    if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return false // 'MZ'
    const pe = buffer.readUInt32LE(0x3c)
    if (pe + 24 + 96 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return false // 'PE\0\0'
    const optional = pe + 24
    const magic = buffer.readUInt16LE(optional)
    const dataDir = optional + (magic === 0x20b ? 112 : 96) // PE32+ vs PE32
    const securityEntry = dataDir + 4 * 8 // data directory index 4
    if (securityEntry + 8 > buffer.length) return false
    const size = buffer.readUInt32LE(securityEntry + 4)
    return size > 0
  } catch {
    return false
  }
}

/** The integrity verdict from the three observable facts, for testing. */
export function classifyHelperIntegrity(
  exists: boolean,
  signed: boolean,
  hashMatches: boolean
): 'ok' | 'damaged' | 'absent' {
  if (!exists) return 'absent'
  if (signed) return 'ok' // trust the signature; Windows enforces it, a broken one lands on 'blocked'
  return hashMatches ? 'ok' : 'damaged'
}

function computeHelperIntegrity(helperPath: string): 'ok' | 'damaged' | 'absent' {
  if (!existsSync(helperPath)) return 'absent'
  let buffer: Buffer
  try {
    buffer = readFileSync(helperPath)
  } catch {
    return 'ok'
  }
  if (peIsAuthenticodeSigned(buffer)) return 'ok'
  const manifestPath = join(dirname(helperPath), 'dictation-helper.manifest.json')
  if (!existsSync(manifestPath)) return 'ok' // an unsigned dev build with no manifest cannot be checked
  try {
    const expected = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sha256?: unknown }
    if (typeof expected.sha256 !== 'string') return 'ok'
    const actual = createHash('sha256').update(buffer).digest('hex')
    return classifyHelperIntegrity(true, false, actual === expected.sha256)
  } catch {
    return 'ok'
  }
}

/** Builds the real service from Electron pieces and registers its IPC. */
export function createDictationHost(options: DictationHostOptions): {
  service: DictationService
  ownership: CaptureOwnership
} {
  const ownership = new CaptureOwnership()
  const settings = new DictationSettingsStore(options.userData)
  const platform = options.platform ?? process.platform
  const client = new DictationHelperClient({ command: options.helperPath, platform })
  // Windows only: a missing/damaged helper is told apart from a launch refusal.
  const helperIntegrity = platform === 'win32' ? computeHelperIntegrity(options.helperPath) : 'ok'
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
    (action, gen) => route.service?.onOverlayAction(action, gen),
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
    ...(platform === 'win32' ? { helperIntegrity: () => helperIntegrity } : {}),
    settings,
    // The meeting recorder holds the microphone before the sidecar session
    // exists; treat that handshake as busy too.
    engine: {
      tryStartLive: (opts) => engine.tryStartLive(opts),
      stop: () => engine.stop(),
      get running() {
        return engine.running || options.meetingBusy()
      },
      get warm() {
        return engine.warm
      },
      listInputDevices: () => engine.listInputDevices?.() ?? Promise.resolve([])
    },
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
