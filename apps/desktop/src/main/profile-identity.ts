import { posix } from 'node:path'
import { DEV_APP_NAME, type AppChannel } from '../shared/app-channel'
import type { AppIdentityName } from './app-identity'

// The development build is macOS-only, so these are always POSIX paths, whatever platform
// the tests happen to run on.
const { join } = posix

/** Directory names the shipping app and its historical dev runs write under appData. */
const PRODUCTION_PROFILE_NAMES = ['DoodleNote', 'desktop', 'DoodleNote Local']

export interface ProfileInputs {
  channel: AppChannel
  /** The build identity (src/main/app-identity.ts): production or QA. */
  identity: AppIdentityName
  isPackaged: boolean
  /** The per-user platform root, e.g. ~/Library/Application Support. */
  appData: string
  /** The user's home directory, for the logs location. */
  home: string
  env: { DOODLE_USER_DATA?: string }
}

export interface ProfilePlan {
  channel: AppChannel
  /** Electron app name to set before any path is resolved; null leaves it alone. */
  appName: string | null
  /** userData override; null leaves Electron's default for this build. */
  userData: string | null
  /** Log directory override; null leaves Electron's default. */
  logs: string | null
  /** Auto-update is a production capability. A dev build never contacts a feed. */
  updatesEnabled: boolean
  /**
   * Copying a prior profile's meetings/settings into this one is for the
   * production identity only: a QA build's sibling "desktop" profile is the
   * production profile (meetings, settings with the encrypted cloud API key,
   * chat), so a QA profile always starts empty.
   */
  adoptLegacyData: boolean
}

/**
 * Pure decision of where this build keeps its state. The dev lineage never
 * trusts DOODLE_USER_DATA, because that variable only isolates unpackaged runs
 * and a packaged app would silently fall back to a shared directory.
 */
export function planProfile(input: ProfileInputs): ProfilePlan {
  if (input.channel === 'dev') {
    const userData = join(input.appData, DEV_APP_NAME)
    assertIsolatedFromProduction(userData, input.appData)
    return {
      channel: 'dev',
      appName: DEV_APP_NAME,
      userData,
      logs: join(input.home, 'Library', 'Logs', DEV_APP_NAME),
      updatesEnabled: false,
      adoptLegacyData: false
    }
  }
  return {
    channel: 'release',
    appName: null,
    userData: input.env.DOODLE_USER_DATA && !input.isPackaged ? input.env.DOODLE_USER_DATA : null,
    logs: null,
    updatesEnabled: true,
    adoptLegacyData: input.identity === 'production'
  }
}

/** Throws if a profile directory could collide with a production or legacy-dev profile. */
export function assertIsolatedFromProduction(userData: string, appData: string): void {
  for (const name of PRODUCTION_PROFILE_NAMES) {
    const forbidden = join(appData, name)
    if (userData === forbidden || userData.startsWith(`${forbidden}/`)) {
      throw new Error(`Dev profile ${userData} overlaps the production profile ${forbidden}.`)
    }
  }
}
