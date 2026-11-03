import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appDisplayName, fallbackAppName } from '../shared/dictation-app-names'
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
