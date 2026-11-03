import AppKit
import Foundation

/// The name and icon of an installed app, found from its bundle identifier, so the
/// settings page can show real apps instead of identifiers. Only the app bundle's
/// own name and icon are read.
enum AppInfo {
    /// Most identifiers answered per request.
    static let maxBatch = 40

    /// `bundleId` always; `name` and `png` (base64) only when the app is installed.
    static func lookup(bundleId: String, pixels: Int = 64) -> [String: Any] {
        var out: [String: Any] = ["bundleId": bundleId]
        guard !bundleId.isEmpty, bundleId.count <= 200,
            let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)
        else { return out }
        var name = FileManager.default.displayName(atPath: url.path)
        if name.hasSuffix(".app") { name.removeLast(4) }
        if !name.isEmpty { out["name"] = name }
        if let png = AppIcon.png(path: url.path, pixels: pixels) {
            out["png"] = png.base64EncodedString()
        }
        return out
    }
}
