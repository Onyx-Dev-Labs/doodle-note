export interface AcceleratorEvent {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  code: string
}

const KEYS: Record<string, string> = {
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
  MediaPlayPause: 'MediaPlayPause',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadEnter: 'Return',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/'
}

/** Physical key names keep Option/Shift-produced characters out of accelerators. */
export function acceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return KEYS[code] ?? null
}

/** Existing transform capture still requires a modifier unless explicitly opted in. */
export function acceleratorFrom(event: AcceleratorEvent, allowBare = false): string | null {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Command')
  const key = acceleratorKey(event.code)
  if (!key || (!allowBare && modifiers.length === 0)) return null
  return [...modifiers, key].join('+')
}

const MODIFIER_NAMES: Record<string, string> = {
  AltRight: 'Right Option (⌥)',
  AltLeft: 'Left Option (⌥)',
  ControlRight: 'Right Control (⌃)',
  ControlLeft: 'Left Control (⌃)',
  MetaRight: 'Right Command (⌘)',
  MetaLeft: 'Left Command (⌘)',
  ShiftRight: 'Right Shift (⇧)',
  ShiftLeft: 'Left Shift (⇧)',
  Fn: 'Fn / Globe'
}

export function shortcutLabel(shortcut: string): string {
  if (!shortcut) return 'None'
  if (shortcut.startsWith('Modifier:')) return MODIFIER_NAMES[shortcut.slice(9)] ?? shortcut
  const names: Record<string, string> = {
    Control: 'Control (⌃)',
    Ctrl: 'Control (⌃)',
    Alt: 'Option (⌥)',
    Option: 'Option (⌥)',
    Command: 'Command (⌘)',
    Cmd: 'Command (⌘)',
    Meta: 'Command (⌘)',
    CommandOrControl: 'Command (⌘)',
    CmdOrCtrl: 'Command (⌘)',
    Shift: 'Shift (⇧)',
    Return: 'Return (↩)',
    Tab: 'Tab (⇥)',
    Backspace: 'Backspace (⌫)',
    Delete: 'Delete (⌦)',
    Up: 'Up arrow',
    Down: 'Down arrow',
    Left: 'Left arrow',
    Right: 'Right arrow',
    PageUp: 'Page up',
    PageDown: 'Page down'
  }
  return shortcut
    .split('+')
    .map((part) => names[part] ?? part)
    .join(' + ')
}

export function isStandaloneModifier(code: string): boolean {
  return Object.hasOwn(MODIFIER_NAMES, code)
}

export function shortcutWarning(shortcut: string): string | null {
  if (
    !shortcut ||
    shortcut.startsWith('Modifier:') ||
    shortcut.includes('+') ||
    /^F\d+$/.test(shortcut)
  )
    return null
  return 'This key will trigger this action in other apps, including while typing or navigating. A modifier combination is less likely to interrupt your work.'
}
