import { join } from 'node:path'

/** appData (not the parent of an overridden userData) identifies the real
 * per-user platform root on macOS and Windows. Keep profile data separate. */
export function modelSearchDirectories(
  userData: string,
  appData: string,
  fallback: string
): string[] {
  return [
    ...new Set([
      join(userData, 'models'),
      join(appData, 'DoodleNote', 'models'),
      join(appData, 'desktop', 'models'),
      join(appData, 'DoodleNote Local', 'models'),
      fallback
    ])
  ]
}
