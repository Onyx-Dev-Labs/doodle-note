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

final class HoldWatcher {
    static let shared = HoldWatcher()

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var spec: HoldKeySpec?
    private var minHold: TimeInterval = 0.15
    private var pending: DispatchWorkItem?
    private var keyIsDown = false
    private var tainted = false
    private var announced = false
    private var holdId = 0

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
        self.spec = spec
        self.minHold = TimeInterval(max(60, min(minHoldMs, 1000))) / 1000
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return nil
    }

    func stop() {
        endHoldIfNeeded(reason: "stopped")
        pending?.cancel()
        pending = nil
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        source = nil
        tap = nil
        spec = nil
        keyIsDown = false
        tainted = false
    }

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        guard let spec else { return }
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            // The OS paused the tap; a release may have been missed.
            endHoldIfNeeded(reason: "tap-disabled")
            keyIsDown = false
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .keyDown:
            // Any other key means the modifier is part of a shortcut, not a hold.
            if keyIsDown && !announced { tainted = true }
        case .flagsChanged:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            if keyCode == spec.keyCode {
                let pressed = event.flags.rawValue & spec.deviceMask != 0
                if pressed && !keyIsDown {
                    keyIsDown = true
                    tainted = false
                    scheduleAnnounce()
                } else if !pressed && keyIsDown {
                    keyIsDown = false
                    pending?.cancel()
                    endHoldIfNeeded(reason: "released")
                }
            } else if keyIsDown && !announced {
                tainted = true  // another modifier joined: this is a chord
            }
        default:
            break
        }
    }

    private func scheduleAnnounce() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.keyIsDown, !self.tainted, !self.announced else { return }
            self.announced = true
            self.holdId += 1
            Wire.send(["event": "hold", "phase": "down", "holdId": self.holdId])
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + minHold, execute: work)
    }

    private func endHoldIfNeeded(reason: String) {
        guard announced else { return }
        announced = false
        Wire.send(["event": "hold", "phase": "up", "holdId": holdId, "reason": reason])
    }
}
