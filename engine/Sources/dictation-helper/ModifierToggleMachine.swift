import Foundation

/// Physical modifier identities used by the desktop KeyboardEvent.code setting.
/// Device-dependent bits distinguish left/right even when their public flag is shared.
struct ModifierToggleKeySpec: Equatable {
    let keyCode: Int64
    let deviceMask: UInt64
    let familyMask: UInt64

    static func named(_ name: String) -> ModifierToggleKeySpec? {
        switch name {
        case "AltRight": return .init(keyCode: 61, deviceMask: 0x40, familyMask: 0x80000)
        case "AltLeft": return .init(keyCode: 58, deviceMask: 0x20, familyMask: 0x80000)
        case "ControlRight": return .init(keyCode: 62, deviceMask: 0x2000, familyMask: 0x40000)
        case "ControlLeft": return .init(keyCode: 59, deviceMask: 0x1, familyMask: 0x40000)
        case "MetaRight": return .init(keyCode: 54, deviceMask: 0x10, familyMask: 0x100000)
        case "MetaLeft": return .init(keyCode: 55, deviceMask: 0x8, familyMask: 0x100000)
        case "ShiftRight": return .init(keyCode: 60, deviceMask: 0x4, familyMask: 0x20000)
        case "ShiftLeft": return .init(keyCode: 56, deviceMask: 0x2, familyMask: 0x20000)
        case "Fn": return .init(keyCode: 63, deviceMask: 0x800000, familyMask: 0x800000)
        default: return nil
        }
    }

    static let physicalModifierCodes: Set<Int64> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
    private static let deviceMasks: UInt64 = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x2000
    private static let familyMasks: UInt64 = 0x20000 | 0x40000 | 0x80000 | 0x100000 | 0x800000

    func hasOtherModifiers(_ flags: UInt64) -> Bool {
        // Caps Lock's latched state is not a held modifier. Its own transition
        // during a candidate press still taints that candidate below.
        flags & ((Self.deviceMasks & ~deviceMask) | (Self.familyMasks & ~familyMask)) != 0
    }
}

/// Pure release-trigger decision logic. A toggle requires an observed clean down
/// followed by this exact physical key's up. It never infers a toggle from a lost
/// release, a repeating flags event, a chord, or an interrupted event tap.
struct ModifierToggleMachine {
    enum Input {
        case flagsChanged(keyCode: Int64, flags: UInt64)
        case keyDown(keyCode: Int64)
        case keyUp(keyCode: Int64)
        case mouseDown(button: Int64)
        case mouseUp(button: Int64)
        case mouseInteraction // scrolling or dragging, not plain movement
        case tapDisabled
        case reset
    }

    enum Output: Equatable { case toggle }

    let spec: ModifierToggleKeySpec
    private let eventsAfter: UInt64
    private(set) var isDown: Bool
    private(set) var tainted: Bool
    private var waitingForRelease = false
    private var keysDown: Set<Int64>
    private var buttonsDown: Set<Int64>

    init(spec: ModifierToggleKeySpec, flags: UInt64 = 0,
         keysDown: Set<Int64> = [], buttonsDown: Set<Int64> = [], eventsAfter: UInt64 = 0) {
        self.spec = spec
        self.eventsAfter = eventsAfter
        self.isDown = flags & spec.deviceMask != 0
        // Starting/rearming while held cannot turn the existing press into a tap.
        self.tainted = self.isDown
        self.keysDown = keysDown
        self.buttonsDown = buttonsDown
    }

    mutating func handle(_ input: Input, timestamp: UInt64? = nil) -> [Output] {
        // Event taps may queue input around installation/recovery. A new
        // snapshot cannot reinterpret a pre-snapshot down/up as a fresh tap.
        if let timestamp, timestamp < eventsAfter { return [] }
        switch input {
        case .reset, .tapDisabled:
            isDown = false
            tainted = true
            waitingForRelease = true
            keysDown.removeAll()
            buttonsDown.removeAll()
        case .keyDown(let code):
            guard code != spec.keyCode else { return [] }
            keysDown.insert(code)
            if isDown { tainted = true }
        case .keyUp(let code):
            guard code != spec.keyCode else { return [] }
            keysDown.remove(code)
            if isDown { tainted = true }
        case .mouseDown(let button):
            buttonsDown.insert(button)
            if isDown { tainted = true }
        case .mouseUp(let button):
            buttonsDown.remove(button)
            if isDown { tainted = true }
        case .mouseInteraction:
            if isDown { tainted = true }
        case .flagsChanged(let code, let flags):
            let pressed = flags & spec.deviceMask != 0
            guard code == spec.keyCode else {
                if isDown { tainted = true }
                if !pressed {
                    // Another event proves the key is up, but it is not the
                    // matching release. Drop the candidate without toggling.
                    isDown = false
                    waitingForRelease = false
                }
                return []
            }
            if pressed {
                guard !isDown else { return [] }
                isDown = true
                tainted = waitingForRelease || spec.hasOtherModifiers(flags)
                    || !keysDown.isEmpty || !buttonsDown.isEmpty
            } else {
                let clean = isDown && !tainted && !waitingForRelease
                    && !spec.hasOtherModifiers(flags) && keysDown.isEmpty && buttonsDown.isEmpty
                isDown = false
                tainted = false
                waitingForRelease = false
                return clean ? [.toggle] : []
            }
        }
        return []
    }
}
