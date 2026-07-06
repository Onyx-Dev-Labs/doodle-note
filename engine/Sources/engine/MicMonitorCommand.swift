import CoreAudio
import Foundation

/// Emits `{"event":"micmon","running":<bool>}` whenever any process starts or
/// stops capturing from the default input device (CoreAudio's
/// DeviceIsRunningSomewhere). The app uses this to detect "you're in a
/// meeting" moments — Zoom/Teams/Meet hold the mic open for the whole call.
/// Runs until stdin closes (it only ever exists as a child of the app).
enum MicMonitorCommand {
    private static var deviceId = AudioObjectID(kAudioObjectUnknown)
    private static var lastRunning: Bool?
    private static let queue = DispatchQueue(label: "micmon")

    private static var runningAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    private static var defaultDeviceAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    static func run() {
        // Parent-death watchdog: the host spawns us with a live stdin pipe;
        // EOF means it is gone and we must not linger.
        Thread {
            while true {
                let data = FileHandle.standardInput.availableData
                if data.isEmpty { break }
            }
            exit(0)
        }.start()

        // Re-arm when the default input device changes (AirPods in/out etc.).
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject), &defaultDeviceAddress, queue
        ) { _, _ in
            armDeviceListener()
            emitIfChanged()
        }

        armDeviceListener()
        emitCurrent()
        RunLoop.main.run()
    }

    private static func armDeviceListener() {
        let next = currentDefaultInputDevice()
        guard next != deviceId else { return }
        if deviceId != AudioObjectID(kAudioObjectUnknown) {
            AudioObjectRemovePropertyListenerBlock(deviceId, &runningAddress, queue, runningChanged)
        }
        deviceId = next
        guard deviceId != AudioObjectID(kAudioObjectUnknown) else { return }
        AudioObjectAddPropertyListenerBlock(deviceId, &runningAddress, queue, runningChanged)
    }

    private static let runningChanged: AudioObjectPropertyListenerBlock = { _, _ in
        emitIfChanged()
    }

    private static func currentDefaultInputDevice() -> AudioObjectID {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &defaultDeviceAddress, 0, nil, &size, &id
        )
        return status == noErr ? id : AudioObjectID(kAudioObjectUnknown)
    }

    private static func isRunningSomewhere() -> Bool {
        guard deviceId != AudioObjectID(kAudioObjectUnknown) else { return false }
        var running: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(deviceId, &runningAddress, 0, nil, &size, &running)
        return status == noErr && running != 0
    }

    private static func emitCurrent() {
        lastRunning = isRunningSomewhere()
        Events.emit(["event": "micmon", "running": lastRunning ?? false])
    }

    private static func emitIfChanged() {
        let running = isRunningSomewhere()
        guard running != lastRunning else { return }
        lastRunning = running
        Events.emit(["event": "micmon", "running": running])
    }
}
