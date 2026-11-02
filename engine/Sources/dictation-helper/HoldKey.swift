import ApplicationServices
import Carbon.HIToolbox
import Foundation

/// Hold-to-talk: reports a modifier key held on its own, with a matching "up"
/// for every "down". The tap is listen-only, so it can never change, swallow
/// or delay anyone's keystrokes. It needs the Input Monitoring permission.
struct HoldKeySpec {
    let keyCode: Int64
    /// Device-dependent bit that distinguishes this physical key from its twin.
    let deviceMask: UInt64

    static func named(_ name: String) -> HoldKeySpec? {
        switch name {
        case "rightOption": return HoldKeySpec(keyCode: 61, deviceMask: 0x40)
        case "rightControl": return HoldKeySpec(keyCode: 62, deviceMask: 0x2000)
        case "rightCommand": return HoldKeySpec(keyCode: 54, deviceMask: 0x10)
        case "fn": return HoldKeySpec(keyCode: 63, deviceMask: CGEventFlags.maskSecondaryFn.rawValue)
        default: return nil
        }
    }
}

extension HoldKeySpec {
    /// What macOS itself does when the Fn/Globe key is pressed (System Settings,
    /// Keyboard, "Press 🌐 key to"): 0 nothing, 1 change input source, 2 emoji and
    /// symbols, 3 start dictation. nil when the setting is unreadable or unset.
    /// The helper only listens, so it cannot stop the system acting on the key.
    static var fnKeyAction: Int? {
        let value = CFPreferencesCopyAppValue(
            "AppleFnUsageType" as CFString, "com.apple.HIToolbox" as CFString)
        return (value as? NSNumber)?.intValue
    }
}

final class HoldWatcher {
    static let shared = HoldWatcher()

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var machine: HoldMachine?
    private var minHold: TimeInterval = 0.15
    private var pending: DispatchWorkItem?
    /// Hold ids keep counting across restarts, so a late "up" never pairs with a newer hold.
    private var lastHoldId = 0

    var active: Bool { tap != nil }

    /// Must be called on the main thread (the tap is serviced by its run loop).
    func start(key: String, minHoldMs: Int) -> String? {
        stop()
        guard let spec = HoldKeySpec.named(key) else { return "unknown-key" }
        guard CGPreflightListenEventAccess() else { return "input-monitoring-denied" }
        let mask: CGEventMask =
            (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, _ in
            HoldWatcher.shared.handle(type: type, event: event)
            return Unmanaged.passUnretained(event)
        }
        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: callback, userInfo: nil)
        else { return "input-monitoring-denied" }
        self.tap = tap
        self.machine = HoldMachine(
            keyCode: spec.keyCode, deviceMask: spec.deviceMask, holdId: lastHoldId)
        self.minHold = TimeInterval(max(60, min(minHoldMs, 1000))) / 1000
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return nil
    }

    func stop() {
        apply(.reset)
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        source = nil
        tap = nil
        machine = nil
    }

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            apply(.tapDisabled)
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .keyDown:
            apply(.keyDown)
        case .flagsChanged:
            apply(
                .flagsChanged(
                    keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                    flags: event.flags.rawValue))
        default:
            break
        }
    }

    /// Feed the machine and carry out what it asks for.
    private func apply(_ input: HoldMachine.Input) {
        guard var machine else { return }
        let outputs = machine.handle(input)
        lastHoldId = machine.holdId
        self.machine = machine
        for output in outputs {
            switch output {
            case .scheduleAnnounce:
                let work = DispatchWorkItem { [weak self] in self?.apply(.announceTimer) }
                pending = work
                DispatchQueue.main.asyncAfter(deadline: .now() + minHold, execute: work)
            case .cancelAnnounce:
                pending?.cancel()
                pending = nil
            case .holdDown(let id):
                Wire.send(["event": "hold", "phase": "down", "holdId": id])
            case .holdUp(let id, let reason):
                Wire.send(["event": "hold", "phase": "up", "holdId": id, "reason": reason])
            case .tap:
                Wire.send(["event": "tap"])
            }
        }
    }
}
