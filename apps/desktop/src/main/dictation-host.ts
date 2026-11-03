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
  /** The macOS sidecar host; dictation is unavailable without it. */
  engine: EngineLike | null
  notes: () => NotesService | null
  /** The meeting recorder, when it holds or is about to hold the microphone. */
  meetingBusy: () => boolean
  setMicHeld: (held: boolean) => void
  /** Bring the main window forward so the dictation settings page can show. */
  showMainWindow: () => void
  isTrustedSender: (sender: WebContents) => boolean
  broadcast: (channel: string, payload: unknown) => void
}

const PRIVACY_PANES = {
  microphone: 'Privacy_Microphone',
  accessibility: 'Privacy_Accessibility',
  'input-monitoring': 'Privacy_ListenEvent'
} as const

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

/** Builds the real service from Electron pieces and registers its IPC. */
export function createDictationHost(options: DictationHostOptions): {
  service: DictationService
  ownership: CaptureOwnership
} {
  const ownership = new CaptureOwnership()
  const settings = new DictationSettingsStore(options.userData)
  const helper = new DictationHelperClient({ command: options.helperPath })

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
    cleanupOptions: () =>
      options.notes()?.dictationCleanupOptions() ?? { localModelLabel: null, byok: null },
    microphoneAccess,
    requestMicrophone: async () => {
      try {
        return await systemPreferences.askForMediaAccess('microphone')
      } catch {
        return false
      }
    },
    writeClipboard: (text) => clipboard.writeText(text),
    broadcast: (status) => options.broadcast(DICTATION_STATUS_EVENT_CHANNEL, status),
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
  const trusted = (event: { sender: WebContents }): boolean => options.isTrustedSender(event.sender)
  ipcMain.handle(DICTATION_GET_STATUS_CHANNEL, (event) =>
    trusted(event) ? service.status() : null
  )
  ipcMain.handle(DICTATION_SET_SETTINGS_CHANNEL, (event, update: DictationSettingsUpdate) =>
    trusted(event) ? service.setSettings(update ?? {}) : null
  )
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
    if (trusted(event) && typeof pane === 'string' && pane in PRIVACY_PANES) {
      void shell.openExternal(
        `x-apple.systempreferences:com.apple.preference.security?${PRIVACY_PANES[pane as keyof typeof PRIVACY_PANES]}`
      )
    }
  })

  return { service, ownership }
}
