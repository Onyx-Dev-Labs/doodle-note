import CoreAudio
import Foundation

/// Read-only look at an audio input: is it muted, or turned all the way down?
/// A recording from such an input is silent, so the pill can say so while the
/// user is still talking. Nothing here changes any audio setting.
enum Microphone {
    struct State {
        var muted: Bool?
        var volume: Float?
    }

    private static let system = AudioObjectID(kAudioObjectSystemObject)

    /// The device with this CoreAudio UID, or the system default input when the
    /// UID is nil or no longer attached (the engine falls back the same way).
    static func device(uid: String?) -> AudioDeviceID? {
        if let uid, let device = translate(uid: uid) { return device }
        return defaultInput()
    }

    static func state(of device: AudioDeviceID) -> State {
        State(muted: muted(device), volume: volume(device))
    }

    private static func defaultInput() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(system, &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    private static func translate(uid: String) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var cfUID = uid as CFString
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = withUnsafeMutablePointer(to: &cfUID) { qualifier in
            AudioObjectGetPropertyData(
                system, &address, UInt32(MemoryLayout<CFString>.size), qualifier, &size, &device)
        }
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    private static func address(_ selector: AudioObjectPropertySelector, element: UInt32)
        -> AudioObjectPropertyAddress
    {
        AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioDevicePropertyScopeInput, mElement: element)
    }

    /// The device's mute switch on the main element, or on its first channels.
    private static func muted(_ device: AudioDeviceID) -> Bool? {
        for element in [kAudioObjectPropertyElementMain, 1, 2] {
            var address = address(kAudioDevicePropertyMute, element: element)
            guard AudioObjectHasProperty(device, &address) else { continue }
            var value: UInt32 = 0
            var size = UInt32(MemoryLayout<UInt32>.size)
            if AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr {
                return value != 0
            }
        }
        return nil
    }

    /// Input volume 0...1; when only per-channel volumes exist, the loudest one.
    private static func volume(_ device: AudioDeviceID) -> Float? {
        var loudest: Float?
        for element in [kAudioObjectPropertyElementMain, 1, 2] {
            var address = address(kAudioDevicePropertyVolumeScalar, element: element)
            guard AudioObjectHasProperty(device, &address) else { continue }
            var value: Float32 = 0
            var size = UInt32(MemoryLayout<Float32>.size)
            if AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr {
                loudest = max(loudest ?? 0, value)
            }
        }
        return loudest
    }
}
