import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationSettings,
  type DictationSettingsUpdate
} from '../shared/dictation-api'
import { HOLD_KEYS } from '../shared/dictation-helper-protocol'
import { coerceEdge } from '../shared/dictation-pill'

const CLEANUP_MODES = ['raw', 'local', 'byok'] as const

/** Coerce arbitrary JSON into valid settings; anything unrecognized falls back to the default. */
export function normalizeDictationSettings(input: unknown): DictationSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const defaults = DEFAULT_DICTATION_SETTINGS
  const consent = raw.byokConsent as Record<string, unknown> | null | undefined
  return {
    enabled: raw.enabled === true,
    toggleShortcut:
      typeof raw.toggleShortcut === 'string' && raw.toggleShortcut.length <= 64
        ? raw.toggleShortcut.trim()
        : defaults.toggleShortcut,
    holdKey: (HOLD_KEYS as readonly unknown[]).includes(raw.holdKey)
      ? (raw.holdKey as DictationSettings['holdKey'])
      : defaults.holdKey,
    cleanupMode: (CLEANUP_MODES as readonly unknown[]).includes(raw.cleanupMode)
      ? (raw.cleanupMode as DictationSettings['cleanupMode'])
      : defaults.cleanupMode,
    byokConsent:
      consent && typeof consent.provider === 'string' && typeof consent.model === 'string'
        ? { provider: consent.provider, model: consent.model }
        : null,
    showPill: raw.showPill === undefined ? defaults.showPill : raw.showPill === true,
    pillEdge: coerceEdge(raw.pillEdge),
    pillHiddenUntil:
      typeof raw.pillHiddenUntil === 'number' && Number.isFinite(raw.pillHiddenUntil)
        ? raw.pillHiddenUntil
        : null,
    microphoneUid:
      typeof raw.microphoneUid === 'string' &&
      raw.microphoneUid.length > 0 &&
      raw.microphoneUid.length <= 256
        ? raw.microphoneUid
        : null,
    startSound: raw.startSound === undefined ? defaults.startSound : raw.startSound === true,
    handsFreeDoubleTap:
      raw.handsFreeDoubleTap === undefined
        ? defaults.handsFreeDoubleTap
        : raw.handsFreeDoubleTap === true,
    pasteLastShortcut:
      typeof raw.pasteLastShortcut === 'string' && raw.pasteLastShortcut.length <= 64
        ? raw.pasteLastShortcut.trim()
        : defaults.pasteLastShortcut,
    copyLastShortcut:
      typeof raw.copyLastShortcut === 'string' && raw.copyLastShortcut.length <= 64
        ? raw.copyLastShortcut.trim()
        : defaults.copyLastShortcut
  }
}

/** userData/dictation.json: preferences only. No audio, text, keys or history. */
export class DictationSettingsStore {
  private readonly path: string
  private current: DictationSettings

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'dictation.json')
    this.current = this.load()
  }

  get(): DictationSettings {
    return this.current
  }

  update(patch: DictationSettingsUpdate): DictationSettings {
    this.current = normalizeDictationSettings({ ...this.current, ...patch })
    this.save()
    return this.current
  }

  private load(): DictationSettings {
    try {
      if (existsSync(this.path))
        return normalizeDictationSettings(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      // A damaged file must not stop the app; defaults keep dictation off.
    }
    return { ...DEFAULT_DICTATION_SETTINGS }
  }

  private save(): void {
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(this.current, null, 2), { mode: 0o600 })
    renameSync(temp, this.path)
  }
}
