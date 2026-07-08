import SwiftUI

/// Line-based markdown renderer for generated notes — headings, bullets,
/// checkboxes, and inline styling via AttributedString. Enough for the
/// note templates' output shape; not a general markdown engine.
struct MarkdownText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(markdown.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                render(line: line)
            }
        }
    }

    @ViewBuilder
    private func render(line rawLine: String) -> some View {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.isEmpty {
            Spacer().frame(height: 2)
        } else if line.hasPrefix("# ") {
            inline(String(line.dropFirst(2)))
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.ink)
                .padding(.top, 2)
        } else if line.hasPrefix("## ") {
            inline(String(line.dropFirst(3)))
                .font(.headline)
                .foregroundStyle(Color.ink)
                .padding(.top, 4)
        } else if line.hasPrefix("### ") {
            inline(String(line.dropFirst(4)))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.ink)
                .padding(.top, 2)
        } else if line.hasPrefix("- [ ] ") || line.hasPrefix("- [x] ") {
            let checked = line.hasPrefix("- [x] ")
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: checked ? "checkmark.square" : "square")
                    .font(.subheadline)
                    .foregroundStyle(Color.sage)
                inline(String(line.dropFirst(6)))
                    .font(.callout)
                    .foregroundStyle(Color.bark)
            }
        } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•").foregroundStyle(Color.sage)
                inline(String(line.dropFirst(2)))
                    .font(.callout)
                    .foregroundStyle(Color.bark)
            }
        } else {
            inline(line)
                .font(.callout)
                .foregroundStyle(Color.bark)
        }
    }

    private func inline(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }
}
