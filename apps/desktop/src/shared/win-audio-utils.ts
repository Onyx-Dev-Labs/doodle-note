import type { EngineInputDevice } from './engine-events'

export interface MediaDeviceLike {
  deviceId: string
  groupId: string
  kind: string
  label: string
}

/** Normalize Chromium's Windows device list for the shared microphone picker. */
export function mapWindowsInputDevices(devices: MediaDeviceLike[]): EngineInputDevice[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  const defaultDevice = inputs.find((device) => device.deviceId === 'default')
  const physical = inputs.filter(
    (device) => device.deviceId !== 'default' && device.deviceId !== 'communications'
  )
  const seen = new Set<string>()
  const mapped = physical
    .filter((device) => {
      if (!device.deviceId || seen.has(device.deviceId)) return false
      seen.add(device.deviceId)
      return true
    })
    .map((device, index) => ({
      uid: device.deviceId,
      name: device.label.trim() || `Microphone ${index + 1}`,
      isDefault: Boolean(defaultDevice?.groupId && defaultDevice.groupId === device.groupId)
    }))

  if (mapped.length > 0) return mapped
  if (!defaultDevice) return []
  return [
    {
      uid: 'default',
      name: defaultDevice.label.trim() || 'System default microphone',
      isDefault: true
    }
  ]
}
