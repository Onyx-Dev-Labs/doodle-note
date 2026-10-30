import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

/// How a delivery ended. `uncertain` means an insertion was attempted and could
/// not be confirmed; the host must keep the text and must NOT retry blindly.
enum DeliveryOutcome: String {
    case delivered, uncertain, refused, failed
}

struct DeliveryResult {
    var outcome: DeliveryOutcome
    var reason: String?
    var method: String?
    var verified = false
    /// untouched | restored | user-changed | partial
    var clipboard = "untouched"

    var fields: [String: Any] {
        var out: [String: Any] = ["outcome": outcome.rawValue, "verified": verified, "clipboard": clipboard]
        if let reason { out["reason"] = reason }
        if let method { out["method"] = method }
        return out
    }
}

/// What a control currently holds, for before/after comparison.
private struct ControlState: Equatable {
    var value: String?
    var location: Int?
    var length: Int?

    init(_ element: AXUIElement) {
        value = AX.string(element, kAXValueAttribute as String)
        let selection = AX.range(element)
        location = selection?.location
        length = selection?.length
    }

    var observable: Bool { value != nil || location != nil }
}

enum Delivery {
    /// Validate the target immediately before inserting, then insert once.
    static func deliver(_ snapshot: TargetSnapshot, text: String) -> DeliveryResult {
        guard AX.trusted else {
            return DeliveryResult(outcome: .refused, reason: "accessibility-denied")
        }
        guard let expected = snapshot.element, let facts = snapshot.facts else {
            return DeliveryResult(outcome: .refused, reason: "no-target")
        }
        guard AX.frontmostPid() == snapshot.pid else {
            return DeliveryResult(outcome: .refused, reason: "focus-changed")
        }
        guard let current = AX.focusedElement(pid: snapshot.pid), CFEqual(current, expected) else {
            return DeliveryResult(outcome: .refused, reason: "focus-changed")
        }
        // Re-read: the field may have become a password field since the snapshot.
        let now = ElementFacts(current)
        if facts.secure || now.secure { return DeliveryResult(outcome: .refused, reason: "secure-field") }
        if !now.editable { return DeliveryResult(outcome: .refused, reason: "not-editable") }

        let before = ControlState(current)

        // Preferred: replace the selection (the caret, when nothing is selected)
        // through accessibility. No keystrokes, no clipboard.
        // DICTATION_HELPER_STRATEGY=paste is a test switch that exercises the
        // clipboard fallback on targets where accessibility insertion works.
        let forcePaste = ProcessInfo.processInfo.environment["DICTATION_HELPER_STRATEGY"] == "paste"
        if !forcePaste, AX.settable(current, kAXSelectedTextAttribute as String) {
            let error = AXUIElementSetAttributeValue(
                current, kAXSelectedTextAttribute as CFString, text as CFString)
            if error == .success {
                if before.observable {
                    if changed(current, from: before, within: 0.4) {
                        return DeliveryResult(outcome: .delivered, method: "ax", verified: true)
                    }
                    // Success was reported yet nothing changed: a known no-op in
                    // some web views. It is safe to fall back, because the
                    // control demonstrably did not take the text.
                } else {
                    return DeliveryResult(outcome: .uncertain, reason: "insertion-unverifiable", method: "ax")
                }
            } else if changed(current, from: before, within: 0.15) {
                return DeliveryResult(outcome: .delivered, method: "ax", verified: true)
            }
        }
        return paste(text, into: current, snapshot: snapshot, before: before)
    }

    private static func paste(
        _ text: String, into element: AXUIElement, snapshot: TargetSnapshot, before: ControlState
    ) -> DeliveryResult {
        // Synthetic keystrokes are blocked, and unsafe, while a password field
        // anywhere has secure event input.
        if IsSecureEventInputEnabled() {
            return DeliveryResult(outcome: .refused, reason: "secure-field")
        }
        let pasteboard = NSPasteboard.general
        let saved = SavedPasteboard(pasteboard)
        pasteboard.clearContents()
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        // Clipboard managers honor this marker and skip recording the entry.
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        guard pasteboard.writeObjects([item]) else {
            saved.restore(to: pasteboard, expecting: nil)
            return DeliveryResult(outcome: .failed, reason: "clipboard-unavailable", method: "paste")
        }
        let ours = pasteboard.changeCount

        guard postPaste(to: snapshot.pid) else {
            let restored = saved.restore(to: pasteboard, expecting: ours)
            return DeliveryResult(outcome: .failed, reason: "keystroke-unavailable", method: "paste", clipboard: restored)
        }

        var verified = false
        if before.observable { verified = changed(element, from: before, within: 0.8) }
        // The target reads the clipboard asynchronously after the keystroke.
        // Restoring too early would paste the user's old clipboard instead.
        if !verified { Thread.sleep(forTimeInterval: 0.6) }
        let clipboard = saved.restore(to: pasteboard, expecting: ours)

        if verified {
            return DeliveryResult(outcome: .delivered, method: "paste", verified: true, clipboard: clipboard)
        }
        return DeliveryResult(
            outcome: .uncertain, reason: "insertion-unverifiable", method: "paste", clipboard: clipboard)
    }

    /// Cmd+V addressed to one process, so a focus change cannot redirect it.
    private static func postPaste(to pid: pid_t) -> Bool {
        guard let source = CGEventSource(stateID: .combinedSessionState),
            let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false)
        else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.postToPid(pid)
        up.postToPid(pid)
        return true
    }

    private static func changed(_ element: AXUIElement, from before: ControlState, within seconds: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        repeat {
            if ControlState(element) != before { return true }
            Thread.sleep(forTimeInterval: 0.03)
        } while Date() < deadline
        return ControlState(element) != before
    }
}

/// Every representation on the general pasteboard, copied before a paste
/// fallback so the user's clipboard survives it.
struct SavedPasteboard {
    private var items: [[(NSPasteboard.PasteboardType, Data)]] = []
    private var complete = true

    init(_ pasteboard: NSPasteboard) {
        for item in pasteboard.pasteboardItems ?? [] {
            var representations: [(NSPasteboard.PasteboardType, Data)] = []
            for type in item.types {
                if let data = item.data(forType: type) {
                    representations.append((type, data))
                } else {
                    complete = false  // promised data we could not materialize
                }
            }
            items.append(representations)
        }
    }

    /// Restores only if nobody else wrote to the clipboard since `expecting`.
    @discardableResult
    func restore(to pasteboard: NSPasteboard, expecting changeCount: Int?) -> String {
        if let changeCount, pasteboard.changeCount != changeCount { return "user-changed" }
        if items.isEmpty {
            pasteboard.clearContents()
            return "restored"
        }
        pasteboard.clearContents()
        let rebuilt: [NSPasteboardItem] = items.map { representations in
            let item = NSPasteboardItem()
            for (type, data) in representations { item.setData(data, forType: type) }
            return item
        }
        pasteboard.writeObjects(rebuilt)
        return complete ? "restored" : "partial"
    }
}
