import AppKit
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

/// Hold-to-talk and its double tap, from a modifier key and, optionally, a
/// mouse button. The two sources are independent (each has its own event tap
/// and its own `HoldMachine`), but they share one hold counter and one owner:
/// whichever is announced first owns the session, and the other is ignored
/// until it is released.
final class HoldWatcher {
    static let shared = HoldWatcher()

    private typealias Source = HoldArbiter.Source

    private var keyTap: CFMachPort?
    private var keyRunLoopSource: CFRunLoopSource?
    private var keyMachine: HoldMachine?
    private var keyPending: DispatchWorkItem?

    private var mouseTap: CFMachPort?
    private var mouseRunLoopSource: CFRunLoopSource?
    private var mouseMachine: HoldMachine?
    private var mousePending: DispatchWorkItem?
    private var mouseButton: Int64 = -1
    /// The mouse tap is an active one that can consume the button's events.
    private(set) var mouseSwallowing = false
    /// The press that began swallowed must have its release swallowed too.
    private var swallowedDown = false
    private var mousePoll: DispatchSourceTimer?

    private var minHold: TimeInterval = 0.15
    private var arbiter = HoldArbiter()
    /// Hold ids keep counting across restarts, so a late "up" never pairs with a newer hold.
    private var lastHoldId = 0

    var active: Bool { keyTap != nil }
    var mouseActive: Bool { mouseTap != nil }

    /// Must be called on the main thread (the tap is serviced by its run loop).
    func start(key: String, minHoldMs: Int) -> String? {
        stop()
        guard let spec = HoldKeySpec.named(key) else { return "unknown-key" }
        guard CGPreflightListenEventAccess() else { return "input-monitoring-denied" }
        let mask: CGEventMask =
            (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, _ in
            HoldWatcher.shared.handleKey(type: type, event: event)
            return Unmanaged.passUnretained(event)
        }
        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: callback, userInfo: nil)
        else { return "input-monitoring-denied" }
        keyTap = tap
        keyMachine = HoldMachine(keyCode: spec.keyCode, deviceMask: spec.deviceMask)
        minHold = holdDelay(minHoldMs)
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        keyRunLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return nil
    }

    func stop() {
        apply(.key, .reset)
        if let keyRunLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), keyRunLoopSource, .commonModes) }
        if let keyTap { CGEvent.tapEnable(tap: keyTap, enable: false) }
        keyRunLoopSource = nil
        keyTap = nil
        keyMachine = nil
    }

    // MARK: mouse button

    /// Watch one non-primary mouse button. `wantSwallow` asks for an active tap that
    /// consumes that button's events (so the app under the pointer never sees them);
    /// without the permission for that, a listen-only tap is used and events pass
    /// through. Returns nil on success, otherwise a failure reason.
    func startMouse(button: Int64, swallow wantSwallow: Bool, minHoldMs: Int) -> String? {
        stopMouse()
        guard HoldWatcher.allowedButton(button) else { return "invalid-button" }
        let mask: CGEventMask =
            (1 << CGEventType.otherMouseDown.rawValue) | (1 << CGEventType.otherMouseUp.rawValue)
            | (1 << CGEventType.otherMouseDragged.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, _ in
            HoldWatcher.shared.handleMouse(type: type, event: event)
                ? nil : Unmanaged.passUnretained(event)
        }
        var tap: CFMachPort?
        if wantSwallow {
            // An active tap needs the Accessibility permission the helper already holds
            // for inserting text. Without it, fall through to listening only.
            tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                eventsOfInterest: mask, callback: callback, userInfo: nil)
            mouseSwallowing = tap != nil
        }
        if tap == nil {
            guard CGPreflightListenEventAccess() else { return "input-monitoring-denied" }
            tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: callback, userInfo: nil)
            mouseSwallowing = false
        }
        guard let tap else { return "input-monitoring-denied" }
        mouseTap = tap
        mouseButton = button
        mouseMachine = HoldMachine(mouseButton: button)
        minHold = holdDelay(minHoldMs)
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        mouseRunLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return nil
    }

    func stopMouse() {
        apply(.mouse, .reset)
        mousePoll?.cancel()
        mousePoll = nil
        if let mouseRunLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), mouseRunLoopSource, .commonModes) }
        if let mouseTap { CGEvent.tapEnable(tap: mouseTap, enable: false) }
        mouseRunLoopSource = nil
        mouseTap = nil
        mouseMachine = nil
        mouseSwallowing = false
        swallowedDown = false
        mouseButton = -1
    }

    /// Pause or resume the mouse tap (used while capturing a new button).
    func setMousePaused(_ paused: Bool) {
        guard let mouseTap else { return }
        if paused { apply(.mouse, .reset) }
        CGEvent.tapEnable(tap: mouseTap, enable: !paused)
    }

    func stopAll() {
        stop()
        stopMouse()
    }

    /// Middle, back, forward and higher. Left and right click (0, 1) are never allowed.
    static func allowedButton(_ button: Int64) -> Bool { button >= 2 && button <= 31 }

    private func holdDelay(_ ms: Int) -> TimeInterval { TimeInterval(max(60, min(ms, 1000))) / 1000 }

    // MARK: events

    fileprivate func handleKey(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            apply(.key, .tapDisabled)
            if let keyTap { CGEvent.tapEnable(tap: keyTap, enable: true) }
        case .keyDown:
            apply(.key, .keyDown)
        case .flagsChanged:
            apply(
                .key,
                .flagsChanged(
                    keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                    flags: event.flags.rawValue))
        default:
            break
        }
    }

    /// Returns true when the event should be consumed. Only the configured
    /// button is ever consumed, and only when the tap is an active one.
    fileprivate func handleMouse(type: CGEventType, event: CGEvent) -> Bool {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            apply(.mouse, .tapDisabled)
            swallowedDown = false
            if let mouseTap { CGEvent.tapEnable(tap: mouseTap, enable: true) }
            return false
        case .otherMouseDown, .otherMouseUp, .otherMouseDragged:
            let number = event.getIntegerValueField(.mouseEventButtonNumber)
            guard number == mouseButton else { return false }
            switch type {
            case .otherMouseDown:
                apply(.mouse, .buttonDown(button: number))
                swallowedDown = mouseSwallowing
                return mouseSwallowing
            case .otherMouseUp:
                apply(.mouse, .buttonUp(button: number))
                let consume = swallowedDown
                swallowedDown = false
                return consume
            default:
                return swallowedDown
            }
        default:
            return false
        }
    }

    /// While the button is held, check now and then that it still is: a lost
    /// release (a tap that was paused, the pointer on a secure prompt) must end the hold.
    private func watchMouseRelease() {
        guard mousePoll == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak self] in
            guard let self, self.mouseMachine?.isDown == true else { return }
            let down = NSEvent.pressedMouseButtons & (1 << Int(self.mouseButton)) != 0
            self.apply(.mouse, .buttonState(down: down))
        }
        mousePoll = timer
        timer.resume()
    }

    private func stopWatchingMouse() {
        mousePoll?.cancel()
        mousePoll = nil
    }

    /// Feed one source's machine and carry out what it asks for, applying the
    /// one-owner rule across both sources.
    private func apply(_ source: Source, _ input: HoldMachine.Input) {
        guard var machine = source == .key ? keyMachine : mouseMachine else { return }
        // One counter for both sources, so ids never repeat or cross.
        if case .announceTimer = input { machine.holdId = lastHoldId }
        let outputs = machine.handle(input)
        if source == .key { keyMachine = machine } else { mouseMachine = machine }
        for output in outputs {
            guard arbiter.allow(output, from: source) else { continue }
            switch output {
            case .scheduleAnnounce:
                let work = DispatchWorkItem { [weak self] in self?.apply(source, .announceTimer) }
                setPending(source, work)
                DispatchQueue.main.asyncAfter(deadline: .now() + minHold, execute: work)
            case .cancelAnnounce:
                setPending(source, nil)
            case .holdDown(let id):
                lastHoldId = id
                if source == .mouse { watchMouseRelease() }
                Wire.send(["event": "hold", "phase": "down", "holdId": id])
            case .holdUp(let id, let reason):
                if source == .mouse { stopWatchingMouse() }
                Wire.send(["event": "hold", "phase": "up", "holdId": id, "reason": reason])
            case .tap:
                Wire.send(["event": "tap"])
            }
        }
    }

    private func setPending(_ source: Source, _ work: DispatchWorkItem?) {
        if source == .key {
            keyPending?.cancel()
            keyPending = work
        } else {
            mousePending?.cancel()
            mousePending = work
        }
    }
}

/// Records the next mouse button the user presses, for the settings page. A
/// listen-only tap: it only looks, never consumes. Left and right click are
/// reported as not allowed.
final class MouseCapture {
    static let shared = MouseCapture()
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var timeout: DispatchWorkItem?
    private var completion: (([String: Any]?, String?) -> Void)?

    /// Main thread only. `done(fields, nil)` on a usable button, `done(nil, reason)` otherwise.
    func begin(seconds: TimeInterval, done: @escaping ([String: Any]?, String?) -> Void) {
        cancel(reason: "superseded")
        guard CGPreflightListenEventAccess() else {
            done(nil, "input-monitoring-denied")
            return
        }
        let mask: CGEventMask =
            (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
            | (1 << CGEventType.otherMouseDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                MouseCapture.shared.finish(nil, "tap-disabled")
            } else {
                MouseCapture.shared.saw(event.getIntegerValueField(.mouseEventButtonNumber))
            }
            return Unmanaged.passUnretained(event)
        }
        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: callback, userInfo: nil)
        else {
            done(nil, "input-monitoring-denied")
            return
        }
        completion = done
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        let work = DispatchWorkItem { [weak self] in self?.finish(nil, "timeout") }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func cancel(reason: String) { finish(nil, reason) }

    fileprivate func saw(_ button: Int64) {
        if HoldWatcher.allowedButton(button) {
            finish(["button": Int(button)], nil)
        } else {
            finish(nil, "primary-button")
        }
    }

    private func finish(_ fields: [String: Any]?, _ reason: String?) {
        timeout?.cancel()
        timeout = nil
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        source = nil
        tap = nil
        let done = completion
        completion = nil
        done?(fields, reason)
    }
}
