import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as api from '../shared/dictation-api'
import {
  accessibilityState,
  permissionAction,
  permissionButtonLabel,
  permissionLabel,
  relaunchHint,
  type PermissionPane,
  type PermissionState
} from '../shared/dictation-permissions'

test('microphone: Allow while macOS can still ask, System Settings once it has been answered', () => {
  assert.equal(permissionAction('microphone', 'not-determined'), 'allow')
  assert.equal(permissionAction('microphone', 'denied'), 'open-settings')
  assert.equal(permissionAction('microphone', 'restricted'), 'open-settings')
  assert.equal(permissionAction('microphone', 'unknown'), 'open-settings')
  assert.equal(permissionAction('microphone', 'granted'), 'none')
  assert.equal(permissionAction('microphone', null), 'none')
})

test('accessibility: a missing permission is always askable, since the prompt lists the app', () => {
  assert.equal(permissionAction('accessibility', accessibilityState(false)), 'allow')
  assert.equal(permissionAction('accessibility', accessibilityState(true)), 'none')
  assert.equal(permissionAction('accessibility', accessibilityState(null)), 'none')
  assert.equal(permissionAction('accessibility', 'restricted'), 'open-settings')
})

test('input monitoring: Allow only before it has been answered', () => {
  assert.equal(permissionAction('input-monitoring', 'not-determined'), 'allow')
  assert.equal(permissionAction('input-monitoring', 'denied'), 'open-settings')
  assert.equal(permissionAction('input-monitoring', 'granted'), 'none')
  assert.equal(permissionAction('input-monitoring', null), 'none')
})

test('button and state labels are plain words', () => {
  assert.equal(permissionButtonLabel('allow'), 'Allow…')
  assert.equal(permissionButtonLabel('open-settings'), 'Open System Settings')
  assert.equal(permissionButtonLabel('none'), null)
  const labels: Array<[PermissionState | null, string]> = [
    [null, 'Checking…'],
    ['granted', 'Allowed'],
    ['denied', 'Not allowed'],
    ['not-determined', 'Not asked yet'],
    ['restricted', 'Restricted by this Mac'],
    ['unknown', 'Unknown']
  ]
  for (const [state, label] of labels) assert.equal(permissionLabel(state), label)
  assert.equal(accessibilityState(true), 'granted')
  assert.equal(accessibilityState(false), 'denied')
  assert.equal(accessibilityState(null), null)
})

test('a relaunch is suggested for Accessibility and Input Monitoring, never for the microphone', () => {
  for (const pane of ['accessibility', 'input-monitoring'] as PermissionPane[]) {
    assert.match(relaunchHint(pane, 'prompted') ?? '', /quit and reopen DoodleNote Dev/)
    assert.match(relaunchHint(pane, 'open-settings') ?? '', /quit and reopen/)
    assert.equal(relaunchHint(pane, 'granted'), null, 'nothing to restart once granted')
    assert.equal(relaunchHint(pane, null), null, 'nothing asked yet')
  }
  assert.equal(relaunchHint('microphone', 'prompted'), null)
  assert.equal(relaunchHint('microphone', 'denied'), null)
})

test('the permission request is wired through IPC, preload and the host', () => {
  const channels = Object.entries(api)
    .filter(([name]) => name.startsWith('DICTATION_') && name.endsWith('_CHANNEL'))
    .map(([, value]) => String(value))
  assert.ok(channels.includes('dictation:request-permission'))
  assert.equal(new Set(channels).size, channels.length, 'channel names are unique')
  assert.ok(channels.every((channel) => channel.startsWith('dictation:')))
  const src = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8')
  assert.match(
    src('preload/index.ts'),
    /requestPermission:[\s\S]*DICTATION_REQUEST_PERMISSION_CHANNEL/
  )
  const host = src('main/dictation-host.ts')
  assert.match(host, /ipcMain\.handle\(DICTATION_REQUEST_PERMISSION_CHANNEL/)
  assert.match(host, /isPermissionPane\(pane\)/, 'the pane is validated in the main process')
  assert.match(host, /askForMediaAccess\('microphone'\)/)
})
