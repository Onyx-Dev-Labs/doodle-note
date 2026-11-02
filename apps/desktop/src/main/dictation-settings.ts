import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationSettings,
  type DictationSettingsUpdate
} from '../shared/dictation-api'
import { HOLD_KEYS, MOUSE_MODES, isAllowedMouseButton } from '../shared/dictation-helper-protocol'
import { TIDY_LEVELS } from '../shared/dictation-api'
import { coerceEdge } from '../shared/dictation-pill'
import {
  DEFAULT_STYLES,
  STYLE_CATEGORIES,
  STYLE_TONES,
  type StyleApps,
  type StyleChoices
} from '../shared/dictation-style'
import { normalizeTransformSettings } from '../shared/dictation-transforms'

const CLEANUP_MODES = ['raw', 'local', 'byok'] as const

function normalizeStyles(input: unknown): StyleChoices {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out = { ...DEFAULT_STYLES }
  for (const category of STYLE_CATEGORIES) {
    if ((STYLE_TONES as readonly unknown[]).includes(raw[category])) {
      out[category] = raw[category] as StyleChoices[typeof category]
    }
  }
  return out
}

function normalizeStyleApps(input: unknown): StyleApps {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: StyleApps = { personal: [], work: [], email: [], other: [] }
  const seen = new Set<string>()
  for (const category of STYLE_CATEGORIES) {
    const list = Array.isArray(raw[category]) ? (raw[category] as unknown[]) : []
    for (const id of list) {
      if (typeof id !== 'string') continue
      const trimmed = id.trim()
      const key = trimmed.toLowerCase()
      // One home per app, and no unbounded lists.
      if (!trimmed || trimmed.length > 200 || seen.has(key) || out[category].length >= 50) continue
      seen.add(key)
      out[category].push(trimmed)
    }
  }
  return out
}

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
    // Older files only knew the cleanup mode: a model choice there meant "use the model".
    tidyLevel: (TIDY_LEVELS as readonly unknown[]).includes(raw.tidyLevel)
      ? (raw.tidyLevel as DictationSettings['tidyLevel'])
      : raw.cleanupMode === 'local' || raw.cleanupMode === 'byok'
        ? 'full'
        : defaults.tidyLevel,
    styles: normalizeStyles(raw.styles),
    styleApps: normalizeStyleApps(raw.styleApps),
    transforms: normalizeTransformSettings(raw.transforms),
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
        : defaults.copyLastShortcut,
    showLiveText:
      raw.showLiveText === undefined ? defaults.showLiveText : raw.showLiveText === true,
    showStatusMessages:
      raw.showStatusMessages === undefined
        ? defaults.showStatusMessages
        : raw.showStatusMessages === true,
    // Left and right click, and anything that is not a button number, never stick.
    holdMouseButton: isAllowedMouseButton(raw.holdMouseButton) ? raw.holdMouseButton : null,
    holdMouseSwallow:
      raw.holdMouseSwallow === undefined
        ? defaults.holdMouseSwallow
        : raw.holdMouseSwallow === true,
    holdMouseMode: (MOUSE_MODES as readonly unknown[]).includes(raw.holdMouseMode)
      ? (raw.holdMouseMode as DictationSettings['holdMouseMode'])
      : defaults.holdMouseMode
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
