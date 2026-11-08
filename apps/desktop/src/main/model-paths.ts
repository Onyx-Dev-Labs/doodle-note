import { join } from 'node:path'
import { APP_IDENTITY, type AppIdentityName } from './app-identity'

/** appData (not the parent of an overridden userData) identifies the real
 * per-user platform root on macOS and Windows. Keep profile data separate.
 *
 * Only the production identity also looks in the other DoodleNote profiles and
 * the shared cache. A QA build (Windows only) reads models from its own profile
 * alone, so a QA pass never reads the production profile (%APPDATA%\desktop):
 * QA downloads its models, or they are copied into %APPDATA%\desktop-qa\models. */
export function modelSearchDirectories(
  userData: string,
  appData: string,
  fallback: string,
  identity: AppIdentityName = APP_IDENTITY.name
): string[] {
  if (identity !== 'production') return [join(userData, 'models')]
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
