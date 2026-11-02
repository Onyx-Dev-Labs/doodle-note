import Foundation

/// The decision logic of hold-to-talk, with no timers, no event taps and no I/O,
/// so it can be driven by tests. The watcher feeds it what the keyboard did and
/// carries out what comes back.
///
/// A modifier pressed on its own is announced as a hold only after the watcher's
/// delay (`announceTimer`). Released before that, it is a `tap`: the raw material
/// of the double tap. A chord, or any other key struck while it is down, is
/// neither.
struct HoldMachine {
    enum Input {
        case keyDown
        case flagsChanged(keyCode: Int64, flags: UInt64)
        case announceTimer
        /// The OS paused the event tap; a release may have been missed.
        case tapDisabled
        /// Hold-to-talk is being switched off.
        case reset
    }

    enum Output: Equatable {
        case scheduleAnnounce
        case cancelAnnounce
        case holdDown(id: Int)
        case holdUp(id: Int, reason: String)
        case tap
    }

    let keyCode: Int64
    /// Device-dependent bit that is set while this physical key is down.
    let deviceMask: UInt64

    private(set) var keyIsDown = false
    private(set) var tainted = false
    private(set) var announced = false
    private(set) var holdId: Int

    init(keyCode: Int64, deviceMask: UInt64, holdId: Int = 0) {
        self.keyCode = keyCode
        self.deviceMask = deviceMask
        self.holdId = holdId
    }

    mutating func handle(_ input: Input) -> [Output] {
        switch input {
        case .tapDisabled:
            let out = endHold(reason: "tap-disabled")
            keyIsDown = false
            return out
        case .reset:
            var out: [Output] = [.cancelAnnounce]
            out += endHold(reason: "stopped")
            keyIsDown = false
            tainted = false
            return out
        case .keyDown:
            // Any other key means the modifier is part of a shortcut, not a hold.
            if keyIsDown && !announced { tainted = true }
            return []
        case .announceTimer:
            guard keyIsDown, !tainted, !announced else { return [] }
            announced = true
            holdId += 1
            return [.holdDown(id: holdId)]
        case .flagsChanged(let code, let flags):
            if code == keyCode {
                let pressed = flags & deviceMask != 0
                if pressed && !keyIsDown {
                    keyIsDown = true
                    tainted = false
                    return [.cancelAnnounce, .scheduleAnnounce]
                }
                if !pressed && keyIsDown { return release() }
                return []
            }
            guard keyIsDown else { return [] }
            // Our key's bit is gone from another key's event: we missed its
            // release (seen with Fn after a lost event). Treat it as released.
            if flags & deviceMask == 0 { return release() }
            // Another modifier joined: this is a chord.
            if !announced { tainted = true }
            return []
        }
    }

    private mutating func release() -> [Output] {
        keyIsDown = false
        var out: [Output] = [.cancelAnnounce]
        if announced {
            out += endHold(reason: "released")
        } else if !tainted {
            // Released before it counted as a hold: a tap.
            out.append(.tap)
        }
        return out
    }

    private mutating func endHold(reason: String) -> [Output] {
        guard announced else { return [] }
        announced = false
        return [.holdUp(id: holdId, reason: reason)]
    }
}
