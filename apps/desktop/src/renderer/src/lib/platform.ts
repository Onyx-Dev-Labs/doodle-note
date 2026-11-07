/**
 * Presentation-only platform helpers: window chrome hooks and keyboard
 * shortcut labels. The platform comes from the preload (process.platform);
 * anything unknown keeps the macOS presentation the app was designed with.
 */

/** The host platform as exposed by the preload, or undefined outside Electron. */
export function hostPlatform(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.appPlatform
}

/** Marks <html data-platform> before first paint so CSS can scope Windows chrome. */
export function applyPlatformAttribute(
  root: { dataset: Record<string, string | undefined> },
  platform: string | undefined
): void {
  if (platform) root.dataset['platform'] = platform
}

export type ShortcutModifier = 'mod' | 'ctrl' | 'alt' | 'shift'

/** macOS order and glyphs (Apple HIG): Control, Option, Shift, Command. */
const MAC_ORDER: ShortcutModifier[] = ['ctrl', 'alt', 'shift', 'mod']
const MAC_GLYPH: Record<ShortcutModifier, string> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  mod: '⌘'
}
/** Windows / Linux order and names: Ctrl, Alt, Shift ("mod" is Ctrl there). */
const PC_ORDER: ShortcutModifier[] = ['mod', 'ctrl', 'alt', 'shift']
const PC_NAME: Record<ShortcutModifier, string> = {
  mod: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift'
}

/**
 * One label for a keyboard shortcut, e.g. shortcutLabel('K', ['mod']):
 * macOS "⌘K", Windows "Ctrl+K". "mod" is the platform's primary modifier
 * (Command on macOS, Ctrl elsewhere), matching the app's key handlers.
 */
export function shortcutLabel(
  key: string,
  modifiers: readonly ShortcutModifier[] = [],
  platform: string | undefined = hostPlatform()
): string {
  if (platform === 'win32' || platform === 'linux') {
    const names = PC_ORDER.filter((m) => modifiers.includes(m)).map((m) => PC_NAME[m])
    return [...new Set(names), key].join('+')
  }
  return (
    MAC_ORDER.filter((m) => modifiers.includes(m))
      .map((m) => MAC_GLYPH[m])
      .join('') + key
  )
}
