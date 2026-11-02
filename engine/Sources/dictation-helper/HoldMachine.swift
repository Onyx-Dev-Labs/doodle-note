import Foundation

/// The decision logic of hold-to-talk, with no timers, no event taps and no I/O,
/// so it can be driven by tests. The watcher feeds it what the keyboard did and
/// carries out what comes back.
///
/// A modifier pressed on its own is announced as a hold only after the watcher's
/// delay (`announceTimer`). Released before that, it is a `tap`: the raw material
/// of the double tap. A chord, or any other key struck while it is down, is
/// neither.
///
/// The same machine drives an optional mouse button (`init(mouseButton:)`), so
/// hold, tap and double tap behave identically for both. A button has no chord
/// rule (other keys and buttons do not spoil it), and its lost-release check
/// reads the live button state instead of another key's flags.
struct HoldMachine {
    enum Input {
        case keyDown
        case flagsChanged(keyCode: Int64, flags: UInt64)
        case announceTimer
        /// A mouse button went down (mouse mode only; other buttons are ignored).
        case buttonDown(button: Int64)
        case buttonUp(button: Int64)
        /// The live state of the mouse button, polled while it is held. A button
        /// that reads as up while we think it is down lost its release event.
        case buttonState(down: Bool)
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
    /// Set for a mouse trigger; the key fields are unused then.
    let mouseButton: Int64?

    private(set) var keyIsDown = false
    private(set) var tainted = false
    private(set) var announced = false
    /// Settable so the watcher can keep one counter across a key and a button.
    var holdId: Int

    init(keyCode: Int64, deviceMask: UInt64, holdId: Int = 0) {
        self.keyCode = keyCode
        self.deviceMask = deviceMask
        self.mouseButton = nil
        self.holdId = holdId
    }

    init(mouseButton: Int64, holdId: Int = 0) {
        self.keyCode = -1
        self.deviceMask = 0
        self.mouseButton = mouseButton
        self.holdId = holdId
    }

    /// Whether the trigger is currently held (the key, or the button).
    var isDown: Bool { keyIsDown }

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
            guard mouseButton == nil else { return [] }
            if keyIsDown && !announced { tainted = true }
            return []
        case .buttonDown(let button):
            guard button == mouseButton, !keyIsDown else { return [] }
            keyIsDown = true
            tainted = false
            return [.cancelAnnounce, .scheduleAnnounce]
        case .buttonUp(let button):
            guard button == mouseButton, keyIsDown else { return [] }
            return release()
        case .buttonState(let down):
            guard mouseButton != nil, keyIsDown, !down else { return [] }
            return release()
        case .announceTimer:
            guard keyIsDown, !tainted, !announced else { return [] }
            announced = true
            holdId += 1
            return [.holdDown(id: holdId)]
        case .flagsChanged(let code, let flags):
            guard mouseButton == nil else { return [] }
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

/// Decides which of two hold sources (the key and the mouse button) the host
/// hears from. The first one announced owns the session; the other is ignored
/// until the owner is released, so one being held never confuses the other.
struct HoldArbiter {
    enum Source { case key, mouse }

    private(set) var owner: Source?

    /// Whether `output`, produced by `source`, should be sent on. Internal
    /// scheduling outputs always pass.
    mutating func allow(_ output: HoldMachine.Output, from source: Source) -> Bool {
        switch output {
        case .holdDown:
            guard owner == nil else { return false }
            owner = source
            return true
        case .holdUp:
            guard owner == source else { return false }
            owner = nil
            return true
        case .tap:
            // A tap while the other source is held would only confuse a double tap.
            return owner == nil
        case .scheduleAnnounce, .cancelAnnounce:
            return true
        }
    }
}
