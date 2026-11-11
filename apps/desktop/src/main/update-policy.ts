import type { UpdateUnavailableReason } from '../shared/update-api'

/**
 * Windows automatic updates ship OFF. Baked in at build time by electron-vite
 * (`DOODLENOTE_WINDOWS_UPDATES=on`), so neither a setting, an environment
 * variable nor a file on an installed PC can turn checks on. Activation is a
 * release decision; see docs/WINDOWS-RELEASE-QA.md "Automatic updates".
 */
declare const __DOODLENOTE_WINDOWS_UPDATES__: string | undefined

export const WINDOWS_UPDATES_ACTIVATED: boolean =
  typeof __DOODLENOTE_WINDOWS_UPDATES__ === 'string' && __DOODLENOTE_WINDOWS_UPDATES__ === 'on'

export interface UpdateAvailabilityInput {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** False for the development lineage (no feed). */
  profileUpdatesEnabled: boolean
  windowsUpdatesActivated: boolean
}

export type UpdateAvailability =
  { enabled: true } | { enabled: false; reason: UpdateUnavailableReason }

/** Whether this build may contact the update feed at all (launch, 6-hourly and manual checks). */
export function updateAvailability(input: UpdateAvailabilityInput): UpdateAvailability {
  if (!input.isPackaged || !input.profileUpdatesEnabled)
    return { enabled: false, reason: 'dev-build' }
  if (input.platform === 'win32' && !input.windowsUpdatesActivated)
    return { enabled: false, reason: 'windows-not-activated' }
  return { enabled: true }
}

export interface UpdatePolicyTarget {
  channel: string | null
  allowPrerelease: boolean
  allowDowngrade: boolean
}

export function publicUpdateErrorMessage(): string {
  return 'Could not check for updates. Please try again.'
}

/**
 * Windows is currently distributed through the public beta channel
 * (`beta.yml`). Other platforms retain electron-updater's configured default
 * channel.
 */
export function applyUpdatePolicy(
  updater: UpdatePolicyTarget,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return

  // Setting the channel opts electron-updater into downgrade support. Reset it
  // immediately so a stale beta manifest can never replace a newer install.
  updater.channel = 'beta'
  updater.allowPrerelease = true
  updater.allowDowngrade = false
}
