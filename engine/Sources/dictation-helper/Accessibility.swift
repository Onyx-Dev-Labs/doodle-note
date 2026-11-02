import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

/// Thin, side-effect-free wrappers over the Accessibility API.
enum AX {
    static var trusted: Bool { AXIsProcessTrusted() }

    static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return error == .success ? value : nil
    }

    static func string(_ element: AXUIElement, _ name: String) -> String? {
        attribute(element, name) as? String
    }

    static func settable(_ element: AXUIElement, _ name: String) -> Bool {
        var flag = DarwinBoolean(false)
        let error = AXUIElementIsAttributeSettable(element, name as CFString, &flag)
        return error == .success && flag.boolValue
    }

    static func element(_ value: CFTypeRef?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    static func range(_ element: AXUIElement) -> CFRange? {
        guard let raw = attribute(element, kAXSelectedTextRangeAttribute as String),
            CFGetTypeID(raw) == AXValueGetTypeID()
        else { return nil }
        var range = CFRange()
        let value = unsafeDowncast(raw, to: AXValue.self)
        return AXValueGetValue(value, .cfRange, &range) ? range : nil
    }

    /// The process that currently has the user's attention, read live. Neither
    /// answer is cached: NSWorkspace.frontmostApplication is, and goes stale in
    /// a process without a full app run loop, so it must not decide whether
    /// focus has moved. The system-wide accessibility query is the most direct
    /// answer; it can fail (for instance while a secure prompt is up), so the
    /// frontmost normal window's owner is the live fallback.
    static func frontmostPid() -> pid_t? {
        let system = AXUIElementCreateSystemWide()
        if let app = element(attribute(system, kAXFocusedApplicationAttribute as String)) {
            var pid: pid_t = 0
            if AXUIElementGetPid(app, &pid) == .success, pid > 0 { return pid }
        }
        return topWindowOwner()
    }

    /// Owner of the front-most ordinary (layer 0) on-screen window.
    static func topWindowOwner() -> pid_t? {
        guard
            let windows = CGWindowListCopyWindowInfo(
                [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return nil }
        for window in windows {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                let pid = window[kCGWindowOwnerPID as String] as? Int32
            else { continue }
            return pid
        }
        return nil
    }

    static func focusedElement(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        return element(attribute(app, kAXFocusedUIElementAttribute as String))
    }

    /// Chromium and Electron build their accessibility tree only when an
    /// assistive client asks. This is the documented switch for that.
    static func requestWebAccessibility(pid: pid_t) {
        let app = AXUIElementCreateApplication(pid)
        _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        _ = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }
}

let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

struct ElementFacts {
    let role: String
    let subrole: String?
    let secure: Bool
    let editable: Bool

    init(_ element: AXUIElement) {
        role = AX.string(element, kAXRoleAttribute as String) ?? ""
        subrole = AX.string(element, kAXSubroleAttribute as String)
        secure = subrole == (kAXSecureTextFieldSubrole as String)
        // Roles alone are not enough for web content: contenteditable regions
        // report generic roles but expose a settable selection.
        editable =
            textRoles.contains(role)
            || AX.settable(element, kAXSelectedTextRangeAttribute as String)
            || AX.settable(element, kAXValueAttribute as String)
    }
}

/// A focused control remembered by the helper. The element handle never leaves
/// this process; the host only holds the snapshot id and descriptive fields.
final class TargetSnapshot {
    let id: String
    let pid: pid_t
    let bundleId: String
    let appName: String
    let element: AXUIElement?
    let facts: ElementFacts?
    /// The app is built on Chromium (browsers, Electron apps). Their text
    /// controls take accessibility insertion as a silent no-op, so delivery goes
    /// straight to the verified clipboard path instead of waiting to find out.
    let chromiumBased: Bool
    let taken = Date()

    init(
        id: String, pid: pid_t, bundleId: String, appName: String, element: AXUIElement?,
        chromiumBased: Bool = false
    ) {
        self.id = id
        self.pid = pid
        self.bundleId = bundleId
        self.appName = appName
        self.element = element
        self.facts = element.map(ElementFacts.init)
        self.chromiumBased = chromiumBased
    }
}

/// Recognizes Chromium-based apps by the engine they ship: a framework inside
/// the app bundle that carries Chromium's ICU data file (Chrome, Edge, Brave
/// and Electron apps all do). Answers are cached per bundle.
enum WebEngine {
    private static let lock = NSLock()
    private static var cache: [String: Bool] = [:]

    static func isChromiumBased(_ app: NSRunningApplication) -> Bool {
        let key = app.bundleIdentifier ?? ""
        if !key.isEmpty {
            lock.lock()
            let known = cache[key]
            lock.unlock()
            if let known { return known }
        }
        let result = detect(app.bundleURL)
        if !key.isEmpty {
            lock.lock()
            cache[key] = result
            lock.unlock()
        }
        return result
    }

    static func detect(_ bundle: URL?) -> Bool {
        guard let frameworks = bundle?.appendingPathComponent("Contents/Frameworks"),
            let names = try? FileManager.default.contentsOfDirectory(atPath: frameworks.path)
        else { return false }
        return names.contains { name in
            name.hasSuffix(".framework")
                && FileManager.default.fileExists(
                    atPath: frameworks.appendingPathComponent(name)
                        .appendingPathComponent("Resources/icudtl.dat").path)
        }
    }
}

final class SnapshotStore: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: TargetSnapshot] = [:]
    private var order: [String] = []
    /// Bounded so an abandoned session cannot pin accessibility handles forever.
    private let limit = 6

    func put(_ snapshot: TargetSnapshot) {
        lock.lock()
        defer { lock.unlock() }
        items[snapshot.id] = snapshot
        order.append(snapshot.id)
        while order.count > limit { items[order.removeFirst()] = nil }
    }

    func get(_ id: String) -> TargetSnapshot? {
        lock.lock()
        defer { lock.unlock() }
        return items[id]
    }

    func drop(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        items[id] = nil
        order.removeAll { $0 == id }
    }
}

enum Target {
    /// Capture the frontmost app and its focused control, without activating anything.
    static func capture(id: String) -> TargetSnapshot? {
        // Prefer the live answer; fall back to the workspace only if the system
        // cannot say (accessibility off), where no element is captured anyway.
        let livePid = AX.trusted ? AX.frontmostPid() : nil
        guard let pid = livePid ?? NSWorkspace.shared.frontmostApplication?.processIdentifier,
            let app = NSRunningApplication(processIdentifier: pid)
        else { return nil }
        var element: AXUIElement?
        if AX.trusted {
            element = AX.focusedElement(pid: pid)
            if element == nil || ElementFacts(element!).role == "AXWebArea" {
                // Chromium and Electron build their accessibility tree only
                // after being asked, and take a moment to do so. Wait briefly
                // (the user is still speaking); the delivery check re-validates
                // the element anyway.
                AX.requestWebAccessibility(pid: pid)
                for _ in 0..<40 {
                    Thread.sleep(forTimeInterval: 0.03)
                    if let found = AX.focusedElement(pid: pid), ElementFacts(found).role != "AXWebArea" {
                        element = found
                        break
                    }
                }
            }
        }
        return TargetSnapshot(
            id: id, pid: pid, bundleId: app.bundleIdentifier ?? "",
            appName: app.localizedName ?? "", element: element,
            chromiumBased: WebEngine.isChromiumBased(app))
    }

    static func describe(_ snapshot: TargetSnapshot) -> [String: Any] {
        var out: [String: Any] = [
            "snapshotId": snapshot.id,
            "pid": Int(snapshot.pid),
            "bundleId": snapshot.bundleId,
            "appName": snapshot.appName,
            "hasElement": snapshot.element != nil,
            "accessibility": AX.trusted,
        ]
        if let facts = snapshot.facts {
            out["role"] = facts.role
            out["secure"] = facts.secure
            out["editable"] = facts.editable
        }
        return out
    }

    static var conflictingDictationApps: [String] {
        NSWorkspace.shared.runningApplications.compactMap { app in
            let name = app.localizedName ?? ""
            return name.lowercased().contains("wispr") ? name : nil
        }
    }
}
