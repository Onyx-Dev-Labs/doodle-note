import SwiftUI
import UIKit

/// DoodleNote brand palette — mirrors apps/web/app/globals.css and the
/// desktop app's main.css. Each color adapts to light/dark.
extension Color {
    static let cream = adaptive(light: 0xF7F5EE, dark: 0x1D1F19)
    static let card = adaptive(light: 0xFFFFFF, dark: 0x262922)
    static let cardSoft = adaptive(light: 0xFDFCF8, dark: 0x22251E)
    static let sand = adaptive(light: 0xE7E3D8, dark: 0x3A3E33)
    static let ink = adaptive(light: 0x26281F, dark: 0xF0EEE2)
    static let bark = adaptive(light: 0x3A3D33, dark: 0xCFCDBE)
    static let stone = adaptive(light: 0x686D61, dark: 0xA4A88F)
    static let sage = adaptive(light: 0x7C9769, dark: 0x8FB07A)
    static let sageDeep = adaptive(light: 0x526E43, dark: 0xAAC996)
    static let sageFill = adaptive(light: 0xE9EFE0, dark: 0x34402B)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// The two-tone wordmark used across every DoodleNote surface.
struct Wordmark: View {
    var font: Font = .headline

    var body: some View {
        HStack(spacing: 0) {
            Text("Doodle").foregroundStyle(Color.ink)
            Text("Note").foregroundStyle(Color.sage)
        }
        .font(font.weight(.bold))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("DoodleNote")
    }
}
