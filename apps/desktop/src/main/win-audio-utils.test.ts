import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapWindowsInputDevices } from '../shared/win-audio-utils'

test('Windows microphone list marks the physical device behind the system default', () => {
  const devices = mapWindowsInputDevices([
    { kind: 'audioinput', deviceId: 'default', groupId: 'group-a', label: 'Default - Desk Mic' },
    { kind: 'audioinput', deviceId: 'communications', groupId: 'group-b', label: 'Comms' },
    { kind: 'audioinput', deviceId: 'desk', groupId: 'group-a', label: 'Desk Mic' },
    { kind: 'audioinput', deviceId: 'webcam', groupId: 'group-b', label: 'Webcam Mic' },
    { kind: 'audiooutput', deviceId: 'speakers', groupId: 'group-c', label: 'Speakers' }
  ])

  assert.deepEqual(devices, [
    { uid: 'desk', name: 'Desk Mic', isDefault: true },
    { uid: 'webcam', name: 'Webcam Mic', isDefault: false }
  ])
})

test('Windows microphone list stays usable before permission reveals labels', () => {
  const devices = mapWindowsInputDevices([
    { kind: 'audioinput', deviceId: 'default', groupId: '', label: '' },
    { kind: 'audioinput', deviceId: 'mic-1', groupId: '', label: '' },
    { kind: 'audioinput', deviceId: 'mic-1', groupId: '', label: '' }
  ])

  assert.deepEqual(devices, [{ uid: 'mic-1', name: 'Microphone 1', isDefault: false }])
})

test('Windows microphone list falls back to the system default device', () => {
  assert.deepEqual(
    mapWindowsInputDevices([{ kind: 'audioinput', deviceId: 'default', groupId: '', label: '' }]),
    [{ uid: 'default', name: 'System default microphone', isDefault: true }]
  )
})
