import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appDisplayName, fallbackAppName, visibleApps } from '../shared/dictation-app-names'
import { BUILTIN_STYLE_APPS } from '../shared/dictation-style'

test('every app in the built-in style lists has a friendly name', () => {
  for (const ids of Object.values(BUILTIN_STYLE_APPS)) {
    for (const id of ids) {
      const name = fallbackAppName(id)
      assert.ok(name && name !== id, `${id} needs a name`)
    }
  }
})

test('the shown name prefers the system, then the app, then ours, then the identifier', () => {
  assert.equal(appDisplayName('com.hnc.Discord', 'Discord Canary', 'x'), 'Discord Canary')
  assert.equal(appDisplayName('com.hnc.Discord', null, 'Discord (recent)'), 'Discord (recent)')
  assert.equal(appDisplayName('com.hnc.Discord', null, null), 'Discord')
  assert.equal(appDisplayName('com.example.Unknown', null, null), 'com.example.Unknown')
  assert.equal(fallbackAppName('COM.HNC.DISCORD'), 'Discord', 'identifiers match in any case')
})

test('built-in apps are listed only when installed; apps the person added always are', () => {
  const apps = [
    { bundleId: 'com.apple.MobileSMS', builtin: true },
    { bundleId: 'org.whispersystems.signal-desktop', builtin: true },
    { bundleId: 'com.example.Mine', builtin: false }
  ]
  const known = {
    'com.apple.MobileSMS': { name: 'Messages', icon: 'data:image/png;base64,AA' },
    'org.whispersystems.signal-desktop': { name: null, icon: null },
    'com.example.Mine': { name: null, icon: null }
  }
  const result = visibleApps(apps, known)
  assert.deepEqual(
    result.shown.map((a) => a.bundleId),
    ['com.apple.MobileSMS', 'com.example.Mine']
  )
  assert.equal(result.hidden, 1)
})

test('before the helper answers no built-in app counts as installed; with no helper everything is listed', () => {
  const apps = [
    { bundleId: 'com.apple.MobileSMS', builtin: true },
    { bundleId: 'com.example.Mine', builtin: false }
  ]
  assert.deepEqual(
    visibleApps(apps, {}).shown.map((a) => a.bundleId),
    ['com.example.Mine']
  )
  assert.deepEqual(visibleApps(apps, null).shown.length, 2)
  assert.equal(visibleApps(apps, null).hidden, 0)
  assert.equal(visibleApps([], {}).hidden, 0)
})

test('Windows executable names have friendly fallbacks', async () => {
  const { fallbackAppName } = await import('../shared/dictation-app-names')
  const { BUILTIN_STYLE_APPS_WINDOWS } = await import('../shared/dictation-style')
  for (const ids of Object.values(BUILTIN_STYLE_APPS_WINDOWS))
    for (const id of ids) assert.ok(fallbackAppName(id), id)
  assert.equal(fallbackAppName('notepad.exe'), 'Notepad')
})
