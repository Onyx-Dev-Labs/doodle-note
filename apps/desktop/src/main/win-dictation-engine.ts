import type { EngineStartOptions } from '../shared/engine-events'
import type { InputDevice } from '../shared/dictation-pill'
import type { EngineLike } from './dictation-service'

/** What Bark needs from the Windows engine host (WinEngineHost). */
export interface WinDictationEngineHost {
  tryStartLive(opts: EngineStartOptions): { started: true } | { started: false; reason: string }
  stop(): void
  readonly running: boolean
  readonly warm: boolean
  dictationModelState(): {
    ready: boolean
    downloadProgress: number | null
    usingFallback: boolean
    downloadFailed: boolean
  }
  retryDictationModel(): 'started' | 'in-progress' | 'unavailable'
}

export interface WinDictationDevices {
  listInputDevices(): Promise<InputDevice[]>
}

/**
 * Bark's engine on Windows: the shared sherpa-onnx Parakeet worker, started for the
 * microphone only and captured raw in the dictation window (captureProfile
 * 'dictation'). Everything the dictation service asks of the macOS engine is here.
 * The device list is remembered so the helper can find the same microphone by name.
 */
export function winDictationEngine(
  host: WinDictationEngineHost,
  devices: WinDictationDevices
): EngineLike & { deviceName(uid: string): string | null } {
  let known: InputDevice[] = []
  return {
    tryStartLive: (opts) => host.tryStartLive({ ...opts, captureProfile: 'dictation' }),
    stop: () => host.stop(),
    get running() {
      return host.running
    },
    get warm() {
      return host.warm
    },
    dictationModelState: () => host.dictationModelState(),
    retryDictationModel: () => host.retryDictationModel(),
    listInputDevices: async () => {
      known = await devices.listInputDevices()
      return known
    },
    deviceName: (uid) => known.find((device) => device.uid === uid)?.name ?? null
  }
}

/**
 * The helper reads a microphone's mute and volume through Windows' audio endpoints,
 * which do not know Chromium's per-app device ids. It is asked by name instead
 * ("name:Microphone (USB Audio)"); the default stays the default.
 */
export function windowsInputStateUid(
  uid: string | null,
  deviceName: (uid: string) => string | null
): string | null {
  if (!uid || uid === 'default' || uid === 'communications') return uid
  const name = deviceName(uid)
  return name ? `name:${name}` : null
}
