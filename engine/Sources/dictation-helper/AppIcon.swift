import AppKit
import Foundation

/// Draws an app's icon so the host can show where dictated text will go. Only an
/// app bundle's own icon is read; nothing about the app's contents.
enum AppIcon {
    /// The icon of the app bundle at `path` as a square PNG, or nil when the path
    /// is not an existing app bundle.
    static func png(path: String, pixels: Int = 64) -> Data? {
        guard path.hasPrefix("/"), path.hasSuffix(".app"), path.count <= 1024,
            FileManager.default.fileExists(atPath: path),
            let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: rep)
        else { return nil }
        let icon = NSWorkspace.shared.icon(forFile: path)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        icon.draw(
            in: NSRect(x: 0, y: 0, width: pixels, height: pixels), from: .zero,
            operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
