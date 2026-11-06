import AppKit
import ApplicationServices
import Foundation

/// An independent, listen-only tap for a standalone modifier toggle. All tap
/// ownership and state-machine access lives on the main run loop. It does not
/// consume input or share hold-to-talk's timers, arbiter, or listener lifecycle.
final class ModifierToggleWatcher {
    typealias TapFactory = (CGEventMask, CGEventTapCallBack, UnsafeMutableRawPointer?) -> CFMachPort?
    static let shared = ModifierToggleWatcher()

    private final class TapContext {
        weak var watcher: ModifierToggleWatcher?
        let generation: UInt64
        init(watcher: ModifierToggleWatcher, generation: UInt64) {
            self.watcher = watcher
            self.generation = generation
        }
    }

    private let listenPermission: () -> Bool
    private let makeTap: TapFactory
    private let emit: () -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var context: TapContext?
    private var machine: ModifierToggleMachine?
    private var watchdog: DispatchSourceTimer?
    private var generation: UInt64 = 0
    var active: Bool { tap != nil }

    // Injection only covers permission/tap acquisition and output. Tests never
    // request macOS permission, create a real tap, or synthesize global input.
    init(listenPermission: @escaping () -> Bool = { CGPreflightListenEventAccess() },
         makeTap: @escaping TapFactory = { mask, callback, userInfo in
             CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                               options: .listenOnly, eventsOfInterest: mask,
                               callback: callback, userInfo: userInfo)
         }, emit: @escaping () -> Void = { Wire.send(["event": "key-toggle"]) }) {
        self.listenPermission = listenPermission
        self.makeTap = makeTap
        self.emit = emit
    }

    /// `off` always succeeds without needing permission. Reconfiguration removes
    /// the prior listener before validation, so failure cannot keep an old key live.
    func set(key: String) -> String? {
        stop()
        if key == "off" { return nil }
        guard let spec = ModifierToggleKeySpec.named(key) else { return "unknown-key" }
        guard listenPermission() else { return "input-monitoring-denied" }
        let types: [CGEventType] = [
            .flagsChanged, .keyDown, .keyUp,
            .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
            .otherMouseDown, .otherMouseUp, .scrollWheel,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
        ]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let context = TapContext(watcher: self, generation: generation)
        let callback: CGEventTapCallBack = { _, type, event, raw in
            if let raw {
                let context = Unmanaged<TapContext>.fromOpaque(raw).takeUnretainedValue()
                context.watcher?.handle(type: type, event: event, generation: context.generation)
            }
            return Unmanaged.passUnretained(event)
        }
        guard let tap = makeTap(mask, callback, Unmanaged.passUnretained(context).toOpaque()) else {
            return "input-monitoring-denied"
        }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            return "input-monitoring-denied"
        }
        self.context = context
        self.tap = tap
        self.source = source
        machine = snapshot(spec)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        startWatchdog()
        return nil
    }

    func stop() {
        generation &+= 1
        _ = machine?.handle(.reset)
        machine = nil
        watchdog?.cancel()
        watchdog = nil
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
        }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
        context = nil
    }

    private func snapshot(_ spec: ModifierToggleKeySpec) -> ModifierToggleMachine {
        let keys = Set((0..<128).map(Int64.init).filter {
            !ModifierToggleKeySpec.physicalModifierCodes.contains($0)
                && CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0))
        })
        let pressed = UInt64(NSEvent.pressedMouseButtons)
        let buttons = Set((0..<32).map(Int64.init).filter { pressed & (UInt64(1) << $0) != 0 })
        var flags = CGEventSource.flagsState(.combinedSessionState).rawValue
        if CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(spec.keyCode)) {
            flags |= spec.deviceMask
        }
        let now = CGEvent(source: nil)?.timestamp ?? DispatchTime.now().uptimeNanoseconds
        return ModifierToggleMachine(spec: spec, flags: flags,
                                     keysDown: keys, buttonsDown: buttons, eventsAfter: now)
    }

    private func rearm() {
        guard let tap, let spec = machine?.spec else { return }
        _ = machine?.handle(.tapDisabled)
        guard listenPermission() else {
            stop()
            return
        }
        // A disabled tap can have missed any key/button release. Rebuild the
        // physical snapshot; a currently held trigger remains tainted until up.
        machine = snapshot(spec)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func startWatchdog() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 3, repeating: 3)
        timer.setEventHandler { [weak self] in
            guard let self, let tap = self.tap else { return }
            if !self.listenPermission() { self.stop() }
            else if !CGEvent.tapIsEnabled(tap: tap) { self.rearm() }
        }
        watchdog = timer
        timer.resume()
    }

    private func handle(type: CGEventType, event: CGEvent, generation: UInt64) {
        guard generation == self.generation, tap != nil else { return }
        let input: ModifierToggleMachine.Input
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            rearm()
            return
        case .flagsChanged:
            input = .flagsChanged(keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                                  flags: event.flags.rawValue)
        case .keyDown: input = .keyDown(keyCode: event.getIntegerValueField(.keyboardEventKeycode))
        case .keyUp: input = .keyUp(keyCode: event.getIntegerValueField(.keyboardEventKeycode))
        case .leftMouseDown: input = .mouseDown(button: 0)
        case .leftMouseUp: input = .mouseUp(button: 0)
        case .rightMouseDown: input = .mouseDown(button: 1)
        case .rightMouseUp: input = .mouseUp(button: 1)
        case .otherMouseDown: input = .mouseDown(button: event.getIntegerValueField(.mouseEventButtonNumber))
        case .otherMouseUp: input = .mouseUp(button: event.getIntegerValueField(.mouseEventButtonNumber))
        case .scrollWheel, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            input = .mouseInteraction
        default: return
        }
        if machine?.handle(input, timestamp: event.timestamp).contains(.toggle) == true { emit() }
    }
}
