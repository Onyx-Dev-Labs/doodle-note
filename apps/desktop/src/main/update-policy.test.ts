import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyUpdatePolicy,
  publicUpdateErrorMessage,
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
