import CoreAudio
import Foundation

/// The two things that can silence an output device.
enum OutputSilence: Equatable {
    /// The device's own mute switch.
    case mute
    /// Per-channel volumes (element, previous value) that were turned down to zero.
    case volume([(UInt32, Float)])

    static func == (lhs: OutputSilence, rhs: OutputSilence) -> Bool {
        switch (lhs, rhs) {
        case (.mute, .mute): return true
        case (.volume(let a), .volume(let b)):
            return a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: return false
        }
    }
}

/// What the muter needs from an output device, so the logic can be tested without
/// touching the real volume.
protocol OutputDeviceControl {
    /// The device sound is going to right now; nil when there is none.
    func defaultDevice() -> UInt32?
    func exists(_ device: UInt32) -> Bool
    /// The mute switch, when the device has one that can be set.
    func muteSwitch(_ device: UInt32) -> Bool?
    func setMuteSwitch(_ device: UInt32, _ muted: Bool) -> Bool
    /// Settable channel volumes as (element, 0...1).
    func volumes(_ device: UInt32) -> [(UInt32, Float)]
    func setVolume(_ device: UInt32, element: UInt32, _ value: Float) -> Bool
}

/// Silences whatever is playing while the user dictates, then puts it back.
///
/// It remembers exactly what it changed. It restores only if the device is still
/// in the state this code left it in, so a volume the user turned up (or a mute
/// they switched on themselves) in the meantime is never overwritten, and a
/// device that was already silent is left alone. It changes no setting for any
/// other purpose and records nothing about what was playing.
final class OutputMuter {
    enum Outcome: String {
        /// This call silenced the output.
        case muted
        /// Silence was already in place from an earlier call.
        case alreadyHeld = "already-held"
        /// The output was already silent, so there is nothing to give back.
        case alreadySilent = "already-silent"
        /// The device has no switch or volume that can be set.
        case unsupported
        case noDevice = "no-device"
    }

    enum Restored: String {
        case restored
        /// Nothing was held.
        case nothing
        /// The user changed the sound meanwhile, so it was left as they set it.
        case userChanged = "user-changed"
        /// The device is gone.
        case gone
    }

    private let control: OutputDeviceControl
    private let lock = NSLock()
    private var held: (device: UInt32, silence: OutputSilence)?

    init(control: OutputDeviceControl) {
        self.control = control
    }

    var isHolding: Bool {
        lock.lock()
        defer { lock.unlock() }
        return held != nil
    }

    func mute() -> Outcome {
        lock.lock()
        defer { lock.unlock() }
        if held != nil { return .alreadyHeld }
        guard let device = control.defaultDevice() else { return .noDevice }

        if let muted = control.muteSwitch(device) {
            if muted { return .alreadySilent }
            guard control.setMuteSwitch(device, true) else { return .unsupported }
            held = (device, .mute)
            return .muted
        }

        let channels = control.volumes(device)
        guard !channels.isEmpty else { return .unsupported }
        if channels.allSatisfy({ $0.1 <= 0 }) { return .alreadySilent }
        let loud = channels.filter { $0.1 > 0 }
        var changed: [(UInt32, Float)] = []
        for (element, value) in loud {
            if control.setVolume(device, element: element, 0) {
                changed.append((element, value))
            }
        }
        guard !changed.isEmpty else { return .unsupported }
        held = (device, .volume(changed))
        return .muted
    }

    @discardableResult
    func restore() -> Restored {
        lock.lock()
        defer { lock.unlock() }
        guard let (device, silence) = held else { return .nothing }
        held = nil
        guard control.exists(device) else { return .gone }
        switch silence {
        case .mute:
            // Still the mute this code set? Then give it back; otherwise the user took over.
            guard control.muteSwitch(device) == true else { return .userChanged }
            return control.setMuteSwitch(device, false) ? .restored : .userChanged
        case .volume(let previous):
            let now = Dictionary(uniqueKeysWithValues: control.volumes(device).map { ($0.0, $0.1) })
            var any = false
            for (element, value) in previous {
                guard let current = now[element], current <= 0 else { continue }
                if control.setVolume(device, element: element, value) { any = true }
            }
            return any ? .restored : .userChanged
        }
    }
}

/// The real default output device.
struct SystemOutputControl: OutputDeviceControl {
    private static let system = AudioObjectID(kAudioObjectSystemObject)
    private static let elements: [UInt32] = [kAudioObjectPropertyElementMain, 1, 2]

    private func address(_ selector: AudioObjectPropertySelector, element: UInt32)
        -> AudioObjectPropertyAddress
    {
        AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioDevicePropertyScopeOutput, mElement: element)
    }

    func defaultDevice() -> UInt32? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(Self.system, &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    func exists(_ device: UInt32) -> Bool {
        var address = address(kAudioDevicePropertyDeviceIsAlive, element: kAudioObjectPropertyElementMain)
        var alive: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(device, &address, 0, nil, &size, &alive) == noErr
            && alive != 0
    }

    private func settable(_ device: UInt32, _ address: inout AudioObjectPropertyAddress) -> Bool {
        guard AudioObjectHasProperty(device, &address) else { return false }
        var settable: DarwinBoolean = false
        return AudioObjectIsPropertySettable(device, &address, &settable) == noErr && settable.boolValue
    }

    func muteSwitch(_ device: UInt32) -> Bool? {
        for element in Self.elements {
            var address = address(kAudioDevicePropertyMute, element: element)
            guard settable(device, &address) else { continue }
            var value: UInt32 = 0
            var size = UInt32(MemoryLayout<UInt32>.size)
            if AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr {
                return value != 0
            }
        }
        return nil
    }

    func setMuteSwitch(_ device: UInt32, _ muted: Bool) -> Bool {
        for element in Self.elements {
            var address = address(kAudioDevicePropertyMute, element: element)
            guard settable(device, &address) else { continue }
            var value: UInt32 = muted ? 1 : 0
            return AudioObjectSetPropertyData(
                device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value) == noErr
        }
        return false
    }

    func volumes(_ device: UInt32) -> [(UInt32, Float)] {
        // The main element controls every channel; per-channel is the fallback.
        for group in [[Self.elements[0]], Array(Self.elements.dropFirst())] {
            var found: [(UInt32, Float)] = []
            for element in group {
                var address = address(kAudioDevicePropertyVolumeScalar, element: element)
                guard settable(device, &address) else { continue }
                var value: Float32 = 0
                var size = UInt32(MemoryLayout<Float32>.size)
                if AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr {
                    found.append((element, value))
                }
            }
            if !found.isEmpty { return found }
        }
        return []
    }

    func setVolume(_ device: UInt32, element: UInt32, _ value: Float) -> Bool {
        var address = address(kAudioDevicePropertyVolumeScalar, element: element)
        var scalar = Float32(value)
        return AudioObjectSetPropertyData(
            device, &address, 0, nil, UInt32(MemoryLayout<Float32>.size), &scalar) == noErr
    }
}

enum OutputAudio {
    static let shared = OutputMuter(control: SystemOutputControl())
    /// If the app never asks for the sound back (it hung, or was killed), give it back anyway.
    static let watchdogSeconds = 15 * 60
    private static var watchdog: DispatchWorkItem?

    static func mute(on queue: DispatchQueue) -> OutputMuter.Outcome {
        let outcome = shared.mute()
        if outcome == .muted {
            watchdog?.cancel()
            let item = DispatchWorkItem { _ = shared.restore() }
            watchdog = item
            queue.asyncAfter(deadline: .now() + .seconds(watchdogSeconds), execute: item)
        }
        return outcome
    }

    static func restore() -> OutputMuter.Restored {
        watchdog?.cancel()
        watchdog = nil
        return shared.restore()
    }
}
