import CoreAudio
import Foundation

/// CoreAudio input-device enumeration and UID resolution. The mic channel
/// records from the system default input unless a session pins a device UID
/// (`--input-device` / the serve `start`/`set-input` commands).
enum AudioInputDevices {
    struct Device {
        let id: AudioDeviceID
        let uid: String
        let name: String
        let isDefault: Bool
    }

    static func list() -> [Device] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard
            AudioObjectGetPropertyDataSize(
                AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr,
            size > 0
        else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr
        else { return [] }

        let defaultID = defaultInputDeviceID()
        return ids.compactMap { id in
            guard inputChannelCount(id) > 0 else { return nil }
            guard let uid = stringProperty(id, selector: kAudioDevicePropertyDeviceUID) else { return nil }
            let name = stringProperty(id, selector: kAudioObjectPropertyName) ?? uid
            return Device(id: id, uid: uid, name: name, isDefault: id == defaultID)
        }
    }

    static func deviceID(forUID uid: String) -> AudioDeviceID? {
        list().first { $0.uid == uid }?.id
    }

    static func defaultInputDeviceID() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
        guard status == noErr, id != 0 else { return nil }
        return id
    }

    private static func inputChannelCount(_ id: AudioDeviceID) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else {
            return 0
        }
        let raw = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else { return 0 }
        let buffers = UnsafeMutableAudioBufferListPointer(
            raw.assumingMemoryBound(to: AudioBufferList.self))
        return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    private static func stringProperty(
        _ id: AudioDeviceID, selector: AudioObjectPropertySelector
    ) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(id, &address, 0, nil, &size, pointer)
        }
        guard status == noErr, let cf = value?.takeRetainedValue() else { return nil }
        return cf as String
    }
}

/// `engine devices` — list audio input devices as one NDJSON event and exit.
/// No models, no permissions, returns in milliseconds; hosts call it to
/// populate their input-device picker.
enum DevicesCommand {
    static func run() {
        let inputs = AudioInputDevices.list().map { device in
            ["uid": device.uid, "name": device.name, "default": device.isDefault] as [String: Any]
        }
        Events.emit(["event": "devices", "inputs": inputs])
    }
}

/// Live mic-switch bridge: the active session registers a handler; stdin
/// command loops (`live` and `serve`) invoke it when the host asks to move
/// the mic channel to a different input device mid-recording.
final class MicController: @unchecked Sendable {
    static let shared = MicController()

    private let lock = NSLock()
    private var handler: ((String?) -> Void)?

    /// Session start passes its switch closure; session end passes nil.
    func register(_ newHandler: ((String?) -> Void)?) {
        lock.lock()
        handler = newHandler
        lock.unlock()
    }

    /// nil / empty UID = system default input.
    func switchInput(toUID uid: String?) {
        lock.lock()
        let current = handler
        lock.unlock()
        guard let current else {
            Events.log("set-input ignored: no active session")
            return
        }
        let normalized = (uid?.isEmpty ?? true) ? nil : uid
        current(normalized)
    }
}

/// Thread-safe holder for the session's current MicCapture — the watchdog and
/// the mid-session switch handler both replace it.
final class MicCaptureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var capture: MicCapture?

    func swap(_ next: MicCapture?) -> MicCapture? {
        lock.lock()
        defer { lock.unlock() }
        let previous = capture
        capture = next
        return previous
    }

    func current() -> MicCapture? {
        lock.lock()
        defer { lock.unlock() }
        return capture
    }
}
