/**
 * Theme preference: light / dark / follow macOS. Renderer-owned — persisted
 * in localStorage and applied as html[data-theme]; main.css defines both
 * palettes. 'system' tracks prefers-color-scheme live.
 */

export type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'doodle-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePref(): ThemePref {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(STORAGE_KEY, pref)
  apply()
  syncNative(pref)
}

/** Mirror into Electron's nativeTheme so the floating prompt panel matches. */
function syncNative(pref: ThemePref): void {
  try {
    window.themeNative?.setSource(pref)
  } catch {
    // preload absent (tests) — renderer theme still works alone
  }
}

function apply(): void {
  const pref = getThemePref()
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light'
}

/** Call once at startup; keeps 'system' in sync with macOS appearance. */
export function initTheme(): void {
  apply()
  syncNative(getThemePref())
  media.addEventListener('change', apply)
}
