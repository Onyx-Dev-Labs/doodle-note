import SwiftUI

/// Exact dark palette from the Mac renderer's assets/main.css. The watch
/// deliberately uses the dark brand surface, including in Always On mode.
enum WatchTheme {
    static let background = color(0x1D1F19)
    static let card = color(0x262922)
    static let border = color(0x3A3E33)
    static let ink = color(0xF0EEE2)
    static let secondary = color(0xCFCDBE)
    static let muted = color(0xA4A88F)
    static let sage = color(0x8FB07A)
    static let sageFill = color(0x34402B)
    static let danger = color(0xD98A75)
    static let dangerFill = color(0x432C25)

    private static func color(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 255) / 255,
              green: Double((hex >> 8) & 255) / 255,
              blue: Double(hex & 255) / 255)
    }
}

struct WatchWordmark: View {
    var compact = false
    var body: some View {
        HStack(spacing: 7) {
            Image("Mascot")
                .resizable().scaledToFit()
                .frame(width: compact ? 20 : 25, height: compact ? 20 : 25)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .accessibilityHidden(true)
            HStack(spacing: 0) {
                Text("Doodle").foregroundStyle(WatchTheme.ink)
                Text("Note").foregroundStyle(WatchTheme.sage)
            }
                .font(.system(size: compact ? 14 : 16, weight: .bold))
                .tracking(-0.4)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("DoodleNote")
    }
}

struct WatchActionStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var isStop = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(isStop ? WatchTheme.ink : WatchTheme.background)
            .background(isStop ? WatchTheme.dangerFill : WatchTheme.sage,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isStop ? WatchTheme.danger.opacity(0.6) : Color.white.opacity(0.12))
            }
            .opacity(configuration.isPressed ? 0.78 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
