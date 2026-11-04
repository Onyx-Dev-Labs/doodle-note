import AppKit
import ApplicationServices
import Foundation

/// The field the last dictation was typed into, kept so the host can read it back
/// for a few minutes and notice a correction. Only the element handle and the
/// process id live here; the helper stores no text, and a secure field is never
/// watched. At most one field is watched at a time.
final class FieldWatches: @unchecked Sendable {
    struct Watch {
        let id: String
        let pid: pid_t
        let element: AXUIElement
        let expires: Date
    }

    /// Long enough to edit and send a message; short enough that a forgotten
    /// handle does not linger.
    static let lifetime: TimeInterval = 300

    private let lock = NSLock()
    private var current: Watch?

    func start(id: String, pid: pid_t, element: AXUIElement, now: Date = Date()) {
        lock.lock()
        defer { lock.unlock() }
        current = Watch(
            id: id, pid: pid, element: element, expires: now.addingTimeInterval(Self.lifetime))
    }

    func get(_ id: String, now: Date = Date()) -> Watch? {
        lock.lock()
        defer { lock.unlock() }
        guard let watch = current, watch.id == id, watch.expires > now else { return nil }
        return watch
    }

    func stop(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        if current?.id == id { current = nil }
    }
}

enum FieldRead {
    /// Longest field text the host is sent; a longer field is not read at all.
    static let maxCharacters = 20_000

    /// ok: the text, and whether the field still has the user's focus.
    /// gone: the field or its app no longer exists (a sent message clears or removes it).
    /// secure: it became a password field. unreadable: this control does not expose its text.
    /// too-long: past `maxCharacters`.
    static func read(_ watch: FieldWatches.Watch) -> [String: Any] {
        guard AX.trusted else { return ["state": "unreadable"] }
        if NSRunningApplication(processIdentifier: watch.pid)?.isTerminated ?? true {
            return ["state": "gone"]
        }
        var raw: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(
            watch.element, kAXValueAttribute as CFString, &raw)
        switch error {
        case .success: break
        case .invalidUIElement: return ["state": "gone"]
        default: return ["state": "unreadable"]
        }
        if ElementFacts(watch.element).secure { return ["state": "secure"] }
        guard let text = raw as? String else { return ["state": "unreadable"] }
        if text.count > maxCharacters { return ["state": "too-long"] }
        let focused: Bool = {
            guard AX.frontmostPid() == watch.pid,
                let current = AX.focusedElement(pid: watch.pid)
            else { return false }
            return CFEqual(current, watch.element)
        }()
        return ["state": "ok", "value": text, "focused": focused]
    }
}
