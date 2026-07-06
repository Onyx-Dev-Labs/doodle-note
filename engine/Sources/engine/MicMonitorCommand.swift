import CoreAudio
import Foundation

/// Emits `{"event":"micmon","running":<bool>,"bundles":[<bundle ids>]}`
/// whenever the set of processes capturing from the microphone changes.
/// On macOS 14.4+ the bundle ids identify WHO holds the mic, so the app can
/// prompt for Zoom/Teams/Meet but ignore dictation tools; on older systems
/// bundles is empty and the host stays conservative. Runs until stdin closes
/// (it only ever exists as a child of the app).
enum MicMonitorCommand {
    private static var deviceId = AudioObjectID(kAudioObjectUnknown)
    private static var lastRunning: Bool?
    private static var lastBundles: Set<String> = []
    private static let queue = DispatchQueue(label: "micmon")
    private static var timer: DispatchSourceTimer?

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

        // The capturing-process SET can change without the device-level
        // running flag flipping (a Zoom call joining mid-dictation) — a slow
        // poll catches those transitions; the listeners catch sharp edges.
        let poll = DispatchSource.makeTimerSource(queue: queue)
        poll.schedule(deadline: .now() + 5, repeating: 5)
        poll.setEventHandler { emitIfChanged() }
        poll.resume()
        timer = poll

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

    /// Bundle ids of every process currently capturing audio input.
    private static func capturingBundles() -> Set<String> {
        guard #available(macOS 14.4, *) else { return [] }
        var listAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &listAddress, 0, nil, &size) == noErr,
            size > 0
        else { return [] }
        var processes = [AudioObjectID](
            repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &listAddress, 0, nil, &size, &processes) == noErr
        else { return [] }

        var bundles: Set<String> = []
        for process in processes {
            var inputAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyIsRunningInput,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var running: UInt32 = 0
            var runningSize = UInt32(MemoryLayout<UInt32>.size)
            guard
                AudioObjectGetPropertyData(
                    process, &inputAddress, 0, nil, &runningSize, &running) == noErr,
                running != 0
            else { continue }

            var bundleAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyBundleID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var bundle: CFString? = nil
            var bundleSize = UInt32(MemoryLayout<CFString?>.size)
            let status = withUnsafeMutablePointer(to: &bundle) { pointer in
                AudioObjectGetPropertyData(process, &bundleAddress, 0, nil, &bundleSize, pointer)
            }
            if status == noErr, let bundle = bundle as String?, !bundle.isEmpty {
                bundles.insert(bundle)
            }
        }
        return bundles
    }

    private static func emitCurrent() {
        lastRunning = isRunningSomewhere()
        lastBundles = capturingBundles()
        emit()
    }

    private static func emitIfChanged() {
        let running = isRunningSomewhere()
        let bundles = capturingBundles()
        guard running != lastRunning || bundles != lastBundles else { return }
        lastRunning = running
        lastBundles = bundles
        emit()
    }

    private static func emit() {
        Events.emit([
            "event": "micmon",
            "running": lastRunning ?? false,
            "bundles": lastBundles.sorted()
        ])
    }
}
