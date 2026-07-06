export const THEME_SET_SOURCE_CHANNEL = 'theme:set-source'

export type ThemeSource = 'system' | 'light' | 'dark'

export interface ThemeApi {
  /** Mirror the renderer's theme pref into Electron's nativeTheme, so the
   *  floating prompt panel and native chrome match the app. */
  setSource(source: ThemeSource): void
}
