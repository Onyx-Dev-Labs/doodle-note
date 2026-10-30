/**
 * Which build lineage this binary belongs to. Baked in at build time by
 * electron-vite (`DOODLENOTE_CHANNEL=dev`) so a packaged development app can
 * never be mistaken for production by environment variables or by files on
 * disk. Anything not explicitly built as `dev` is the production lineage.
 */
declare const __DOODLENOTE_CHANNEL__: string | undefined

export type AppChannel = 'release' | 'dev'

export const APP_CHANNEL: AppChannel =
  typeof __DOODLENOTE_CHANNEL__ === 'string' && __DOODLENOTE_CHANNEL__ === 'dev' ? 'dev' : 'release'

export const DEV_APP_NAME = 'DoodleNote Dev'
export const DEV_BUNDLE_ID = 'com.doodlenote.desktop.dev'
