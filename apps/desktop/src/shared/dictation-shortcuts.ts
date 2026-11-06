import type { DictationSettings } from './dictation-api'

export const MODIFIER_KEYS = [
  'AltRight',
  'AltLeft',
  'ControlRight',
  'ControlLeft',
  'MetaRight',
  'MetaLeft',
  'ShiftRight',
  'ShiftLeft',
  'Fn'
] as const
export type ModifierKey = (typeof MODIFIER_KEYS)[number]
export type ShortcutSlot = 'toggle' | 'paste' | 'copy'
export const SHORTCUT_FIELDS = {
  toggle: 'toggleShortcut',
  paste: 'pasteLastShortcut',
  copy: 'copyLastShortcut'
} as const

export function modifierKey(shortcut: string): ModifierKey | null {
  if (!shortcut.startsWith('Modifier:')) return null
  const key = shortcut.slice(9)
  return MODIFIER_KEYS.includes(key as ModifierKey) ? (key as ModifierKey) : null
}

const aliases: Record<string, string> = {
  cmd: 'command',
  meta: 'command',
  commandorcontrol: 'command',
  cmdorctrl: 'command',
  option: 'alt',
  ctrl: 'control',
  esc: 'escape',
  return: 'enter'
}
export function shortcutIdentity(shortcut: string): string {
  if (modifierKey(shortcut)) return shortcut
  return shortcut
    .trim()
    .toLowerCase()
    .split('+')
    .map((p) => aliases[p] ?? p)
    .sort()
    .join('+')
}

export function validShortcut(shortcut: string, allowModifier: boolean): boolean {
  if (!shortcut) return true
  if (modifierKey(shortcut)) return allowModifier
  const parts = shortcut.split('+')
  const key = parts.pop() ?? ''
  if (
    !parts.every((p) =>
      /^(Command|Cmd|Control|Ctrl|Alt|Option|Shift|CommandOrControl|CmdOrCtrl)$/i.test(p)
    )
  )
    return false
  if (new Set(parts.map(shortcutIdentity)).size !== parts.length) return false
  if (!parts.length && /^(Escape|Esc)$/i.test(key)) return false // reserved for cancelling dictation
  return /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Backspace|Delete|Insert|Enter|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Capslock|Numlock|Scrolllock|Plus|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[;=,\-./`[\]\\'])$/i.test(
    key
  )
}

const holdModifiers: Record<string, ModifierKey> = {
  rightOption: 'AltRight',
  rightControl: 'ControlRight',
  rightCommand: 'MetaRight',
  fn: 'Fn'
}

/** Name only conflicts we can prove from DoodleNote's own configuration. */
export function shortcutConflict(settings: DictationSettings, slot: ShortcutSlot): string | null {
  const shortcut = settings[SHORTCUT_FIELDS[slot]]
  if (!shortcut) return null
  const identity = shortcutIdentity(shortcut)
  const entries = [
    { slot: 'toggle', key: settings.toggleShortcut, name: 'Bark keyboard shortcut' },
    { slot: 'paste', key: settings.pasteLastShortcut, name: 'Paste last transcript' },
    { slot: 'copy', key: settings.copyLastShortcut, name: 'Copy last transcript' },
    ...(settings.transforms.enabled
      ? settings.transforms.items.map((t) => ({
          slot: `transform:${t.id}`,
          key: t.hotkey,
          name: t.name
        }))
      : [])
  ]
  const other = entries.find(
    (e) => e.slot !== slot && e.key && shortcutIdentity(e.key) === identity
  )
  if (other) return `Already used by ${other.name}. Choose another shortcut.`
  if (
    slot === 'toggle' &&
    modifierKey(shortcut) &&
    holdModifiers[settings.holdKey] === modifierKey(shortcut)
  ) {
    return 'Already used by Hold to talk. Turn off Hold to talk or choose another key.'
  }
  return null
}
