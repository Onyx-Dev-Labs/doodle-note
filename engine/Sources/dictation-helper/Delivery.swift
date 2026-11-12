import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

/// How a delivery ended. `uncertain` means an insertion was attempted and could
/// not be confirmed; the host must keep the text and must NOT retry blindly.
enum DeliveryOutcome: String {
    case delivered, uncertain, refused, failed
}

/// Where the time of one delivery went, in whole milliseconds. Numbers only.
struct DeliveryTimings {
    /// Re-validating the target (focus, secure, editable) before touching it.
    var validateMs = 0
    /// The insertion call itself (accessibility set, or clipboard write and keystroke).
    var insertMs = 0
    /// Polling the control to see the text arrived.
    var confirmMs = 0
    /// A fixed wait before restoring the clipboard, when arrival cannot be seen.
    var settleMs = 0
    /// Accessibility insertion was skipped because this app ignored it before.
    var skippedAx = false

    var fields: [String: Any] {
        [
            "validateMs": validateMs, "insertMs": insertMs, "confirmMs": confirmMs,
            "settleMs": settleMs, "skippedAx": skippedAx,
        ]
    }
}

private func elapsedMs(since start: UInt64) -> Int {
    Int((DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
}

/// Apps whose accessibility text insertion reported success but changed nothing.
/// The clipboard path is used for them straight away next time, instead of
/// waiting out the confirmation window first. Forgotten after a while, so an
/// app update that fixes accessibility is noticed.
final class AxNoOpMemory: @unchecked Sendable {
    static let shared = AxNoOpMemory()
    private let lock = NSLock()
    private var seen: [String: Date] = [:]
    private let lifetime: TimeInterval = 30 * 60

    func remember(_ bundleId: String) {
        guard !bundleId.isEmpty else { return }
        lock.lock()
        seen[bundleId] = Date()
        lock.unlock()
    }

    func knows(_ bundleId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let at = seen[bundleId] else { return false }
        if Date().timeIntervalSince(at) > lifetime {
            seen[bundleId] = nil
            return false
        }
        return true
    }
}

struct DeliveryResult {
    var outcome: DeliveryOutcome
    var reason: String?
    var method: String?
    var verified = false
    /// untouched | restored | user-changed | partial
    var clipboard = "untouched"
    var timings: DeliveryTimings?

    var fields: [String: Any] {
        var out: [String: Any] = ["outcome": outcome.rawValue, "verified": verified, "clipboard": clipboard]
        if let reason { out["reason"] = reason }
        if let method { out["method"] = method }
        if let timings { out["timings"] = timings.fields }
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

/// Finding text in a field. A replacement may only go where its target text is
/// the one and only match, so an edit can never land on the wrong copy.
enum TextLocator {
    /// The UTF-16 range (what accessibility uses) of `needle` in `haystack`, only when
    /// it occurs exactly once. Nothing for an empty needle, no match, or several.
    static func uniqueRange(of needle: String, in haystack: String) -> NSRange? {
        guard !needle.isEmpty else { return nil }
        let text = haystack as NSString
        let first = text.range(of: needle)
        guard first.location != NSNotFound else { return nil }
        // Search from the next unit, so overlapping copies count as two.
        let next = first.location + 1
        let rest = NSRange(location: next, length: text.length - next)
        return text.range(of: needle, options: [], range: rest).location == NSNotFound ? first : nil
    }
}

/// Optional guards on a delivery that edits text already in the field.
struct DeliveryGuards {
    /// The selection must be exactly this text, or the insertion is refused.
    var expectSelection: String?
    /// This text must occur exactly once in the field; it is selected and replaced.
    var replace: String?

    /// A wait or clipboard serialization must not invalidate an edit's selection.
    func refusal(selected: String?) -> String? {
        if let expected = expectSelection, selected != expected { return "selection-changed" }
        if let target = replace, selected != target { return "text-changed" }
        return nil
    }
}

/// Secure event input is global, not proof that this target is a password
/// field. Give a just-dismissed secure prompt a brief chance to release it,
/// rechecking the original destination on every pass. No insertion is retried.
enum PasteReadiness {
    static func refusal(
        validate: () -> String?, secureInput: () -> Bool,
        wait: () -> Void, attempts: Int = 6
    ) -> String? {
        for attempt in 0...attempts {
            if let reason = validate() { return reason }
            if !secureInput() { return validate() }
            if attempt == attempts { return "secure-input" }
            wait()
        }
        return "secure-input"
    }
}

enum Delivery {
    private static func refusal(_ snapshot: TargetSnapshot) -> String? {
        guard AX.trusted else { return "accessibility-denied" }
        guard let expected = snapshot.element, let facts = snapshot.facts else { return "no-target" }
        guard AX.frontmostPid() == snapshot.pid,
            let current = AX.focusedElement(pid: snapshot.pid), CFEqual(current, expected)
        else { return "focus-changed" }
        let now = ElementFacts(current)
        if facts.secure || now.secure { return "secure-field" }
        if !now.editable { return "not-editable" }
        return nil
    }

    private static func pasteRefusal(_ snapshot: TargetSnapshot, guards: DeliveryGuards) -> String? {
        if let reason = refusal(snapshot) { return reason }
        guard guards.expectSelection != nil || guards.replace != nil,
            let element = snapshot.element
        else { return nil }
        return guards.refusal(selected: AX.string(element, kAXSelectedTextAttribute as String))
    }

    /// Validate the target immediately before inserting, then insert once.
    static func deliver(
        _ snapshot: TargetSnapshot, text: String, guards: DeliveryGuards = DeliveryGuards()
    ) -> DeliveryResult {
        var timings = DeliveryTimings()
        var result = deliver(snapshot, text: text, guards: guards, timings: &timings)
        result.timings = timings
        return result
    }

    private static func deliver(
        _ snapshot: TargetSnapshot, text: String, guards: DeliveryGuards,
        timings: inout DeliveryTimings
    ) -> DeliveryResult {
        let began = DispatchTime.now().uptimeNanoseconds
        if let reason = refusal(snapshot) {
            return DeliveryResult(outcome: .refused, reason: reason)
        }
        guard let current = snapshot.element else {
            return DeliveryResult(outcome: .refused, reason: "no-target")
        }

        if let expected = guards.expectSelection,
            AX.string(current, kAXSelectedTextAttribute as String) != expected
        {
            return DeliveryResult(outcome: .refused, reason: "selection-changed")
        }
        if let target = guards.replace {
            // Undo and the like: find the one copy of the old text, select it, and let
            // the normal insertion below replace it.
            guard let value = AX.string(current, kAXValueAttribute as String),
                let range = TextLocator.uniqueRange(of: target, in: value),
                AX.settable(current, kAXSelectedTextRangeAttribute as String)
            else {
                return DeliveryResult(outcome: .refused, reason: "text-changed")
            }
            var cfRange = CFRange(location: range.location, length: range.length)
            guard let wrapped = AXValueCreate(.cfRange, &cfRange),
                AXUIElementSetAttributeValue(
                    current, kAXSelectedTextRangeAttribute as CFString, wrapped) == .success,
                AX.string(current, kAXSelectedTextAttribute as String) == target
            else {
                return DeliveryResult(outcome: .refused, reason: "text-changed")
            }
        }
        let before = ControlState(current)
        timings.validateMs = elapsedMs(since: began)

        // Preferred: replace the selection (the caret, when nothing is selected)
        // through accessibility. No keystrokes, no clipboard.
        // DICTATION_HELPER_STRATEGY=paste is a test switch that exercises the
        // clipboard fallback on targets where accessibility insertion works.
        let forcePaste = ProcessInfo.processInfo.environment["DICTATION_HELPER_STRATEGY"] == "paste"
        let knownNoOp = snapshot.chromiumBased || AxNoOpMemory.shared.knows(snapshot.bundleId)
        timings.skippedAx = knownNoOp && !forcePaste
        if !forcePaste, !knownNoOp, AX.settable(current, kAXSelectedTextAttribute as String) {
            let insertStarted = DispatchTime.now().uptimeNanoseconds
            let error = AXUIElementSetAttributeValue(
                current, kAXSelectedTextAttribute as CFString, text as CFString)
            timings.insertMs = elapsedMs(since: insertStarted)
            let confirmStarted = DispatchTime.now().uptimeNanoseconds
            defer { timings.confirmMs = elapsedMs(since: confirmStarted) }
            if error == .success {
                if before.observable {
                    if changed(current, from: before, within: 0.4) {
                        return DeliveryResult(outcome: .delivered, method: "ax", verified: true)
                    }
                    // Success was reported yet nothing changed: a known no-op in
                    // some web views. It is safe to fall back, because the
                    // control demonstrably did not take the text. Remember the
                    // app, so the next dictation skips straight to the fallback.
                    AxNoOpMemory.shared.remember(snapshot.bundleId)
                } else {
                    return DeliveryResult(outcome: .uncertain, reason: "insertion-unverifiable", method: "ax")
                }
            } else if changed(current, from: before, within: 0.15) {
                return DeliveryResult(outcome: .delivered, method: "ax", verified: true)
            }
        }
        return paste(text, into: current, snapshot: snapshot, before: before, guards: guards, timings: &timings)
    }

    private static func paste(
        _ text: String, into element: AXUIElement, snapshot: TargetSnapshot, before: ControlState,
        guards: DeliveryGuards, timings: inout DeliveryTimings
    ) -> DeliveryResult {
        let validateStarted = DispatchTime.now().uptimeNanoseconds
        let reason = PasteReadiness.refusal(
            validate: { pasteRefusal(snapshot, guards: guards) },
            secureInput: { IsSecureEventInputEnabled() },
            wait: { Thread.sleep(forTimeInterval: 0.03) })
        timings.validateMs += elapsedMs(since: validateStarted)
        if let reason { return DeliveryResult(outcome: .refused, reason: reason) }
        // The accessibility attempt or the user may have changed the field
        // during a wait. Never follow that with a second insertion.
        guard ControlState(element) == before else {
            return DeliveryResult(outcome: .uncertain, reason: "insertion-unverifiable")
        }
        let insertStarted = DispatchTime.now().uptimeNanoseconds
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

        // Clipboard serialization can take time. Revalidate at the actual
        // keystroke boundary, including the secure-input flag, without waiting.
        let finalReason = PasteReadiness.refusal(
            validate: { pasteRefusal(snapshot, guards: guards) }, secureInput: { IsSecureEventInputEnabled() },
            wait: {}, attempts: 0)
        if let finalReason {
            let restored = saved.restore(to: pasteboard, expecting: ours)
            return DeliveryResult(outcome: .refused, reason: finalReason, clipboard: restored)
        }
        guard ControlState(element) == before else {
            let restored = saved.restore(to: pasteboard, expecting: ours)
            return DeliveryResult(outcome: .uncertain, reason: "insertion-unverifiable", clipboard: restored)
        }
        guard postPaste(to: snapshot.pid) else {
            let restored = saved.restore(to: pasteboard, expecting: ours)
            return DeliveryResult(outcome: .failed, reason: "keystroke-unavailable", method: "paste", clipboard: restored)
        }

        timings.insertMs += elapsedMs(since: insertStarted)

        var verified = false
        let confirmStarted = DispatchTime.now().uptimeNanoseconds
        if before.observable { verified = changed(element, from: before, within: 0.8) }
        timings.confirmMs += elapsedMs(since: confirmStarted)
        // The target reads the clipboard asynchronously after the keystroke.
        // Restoring too early would paste the user's old clipboard instead.
        if !verified {
            let settleStarted = DispatchTime.now().uptimeNanoseconds
            Thread.sleep(forTimeInterval: 0.6)
            timings.settleMs = elapsedMs(since: settleStarted)
        }
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
            Thread.sleep(forTimeInterval: 0.008)
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
