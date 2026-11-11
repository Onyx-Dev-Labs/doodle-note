import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyUpdatePolicy,
  publicUpdateErrorMessage,
  updateAvailability,
  WINDOWS_UPDATES_ACTIVATED,
  type UpdatePolicyTarget
} from './update-policy'

function updaterPolicy(): UpdatePolicyTarget {
  return {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: true
  }
}

test('Windows checks the beta feed without allowing a downgrade', () => {
  const updater = updaterPolicy()

  applyUpdatePolicy(updater, 'win32')

  assert.deepEqual(updater, {
    channel: 'beta',
    allowPrerelease: true,
    allowDowngrade: false
  })
})

test('other platforms retain their configured update policy', () => {
  const updater = updaterPolicy()

  applyUpdatePolicy(updater, 'darwin')

  assert.deepEqual(updater, {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: true
  })
})

test('updater failures do not expose internal HTTP or filesystem details', () => {
  const message = publicUpdateErrorMessage()

  assert.equal(message, 'Could not check for updates. Please try again.')
  assert.doesNotMatch(message, /HttpError|AppData|app\.asar/)
})

const packaged = { isPackaged: true, profileUpdatesEnabled: true }

test('Windows contacts no update feed until updates are activated at build time', () => {
  assert.deepEqual(
    updateAvailability({ ...packaged, platform: 'win32', windowsUpdatesActivated: false }),
    { enabled: false, reason: 'windows-not-activated' }
  )
  assert.deepEqual(
    updateAvailability({ ...packaged, platform: 'win32', windowsUpdatesActivated: true }),
    { enabled: true }
  )
})

test('the Windows gate does not change macOS updates', () => {
  for (const windowsUpdatesActivated of [false, true]) {
    assert.deepEqual(
      updateAvailability({ ...packaged, platform: 'darwin', windowsUpdatesActivated }),
      { enabled: true }
    )
  }
})

test('development and unpackaged builds never check, on any platform', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    for (const input of [
      { isPackaged: false, profileUpdatesEnabled: true },
      { isPackaged: true, profileUpdatesEnabled: false }
    ]) {
      assert.deepEqual(updateAvailability({ ...input, platform, windowsUpdatesActivated: true }), {
        enabled: false,
        reason: 'dev-build'
      })
    }
  }
})

test('Windows updates default to off in every build this repository runs', () => {
  // Unbaked (tests, tsx) means off.
  assert.equal(WINDOWS_UPDATES_ACTIVATED, false)
  const viteConfig = readFileSync(new URL('../../electron.vite.config.ts', import.meta.url), 'utf8')
  assert.match(
    viteConfig,
    /__DOODLENOTE_WINDOWS_UPDATES__: JSON\.stringify\(\s*process\.env\.DOODLENOTE_WINDOWS_UPDATES === 'on' \? 'on' : 'off'\s*\)/
  )
  const ci = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const desktopPackage = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  assert.doesNotMatch(ci, /DOODLENOTE_WINDOWS_UPDATES/)
  assert.doesNotMatch(desktopPackage, /DOODLENOTE_WINDOWS_UPDATES/)
  const updater = readFileSync(new URL('./updater.ts', import.meta.url), 'utf8')
  // The gate decides before the first (launch) check and the 6-hour timer.
  assert.ok(
    updater.indexOf('if (!availability.enabled)') < updater.indexOf('void coordinator.check()')
  )
})
