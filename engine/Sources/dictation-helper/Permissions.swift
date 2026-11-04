import ApplicationServices
import CoreGraphics
import Foundation
import IOKit.hid

/// Asking macOS for the permissions the helper needs, and reading their state.
/// macOS attributes a request made by a child process to the app that launched
/// it, so asking here registers DoodleNote Dev itself in System Settings.
enum Permissions {
    /// granted | denied | not-determined. Input Monitoring is the only one of the
    /// helper's permissions macOS reports as a three-way state.
    static var inputMonitoringState: String {
        stateName(IOHIDCheckAccess(kIOHIDRequestTypeListenEvent))
    }

    static func stateName(_ access: IOHIDAccessType) -> String {
        switch access {
        case kIOHIDAccessTypeGranted: return "granted"
        case kIOHIDAccessTypeDenied: return "denied"
        default: return "not-determined"
        }
    }

    /// Shows macOS's own Accessibility dialog when the permission is missing, which
    /// also adds the app to the Accessibility list. Returns whether it is granted now.
    static func requestAccessibility() -> Bool {
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
    }

    /// Shows macOS's Input Monitoring dialog the first time (and adds the app to the
    /// list). Once the user has answered, macOS does not ask again and this does nothing.
    static func requestInputMonitoring() -> Bool {
        CGRequestListenEventAccess()
    }
}
