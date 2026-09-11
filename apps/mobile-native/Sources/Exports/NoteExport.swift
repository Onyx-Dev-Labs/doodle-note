import Foundation
import UIKit
import PencilKit
import CoreText

struct NoteExportSelection: Sendable {
    var personal = true
    var transcript = true
    var ink = true
    var summaryIDs: Set<UUID> = []
}

enum NoteExportFormat: String, CaseIterable, Identifiable, Sendable {
    case pdf, markdown
    var id: String { rawValue }
    var label: String { self == .pdf ? "PDF" : "Markdown (.zip)" }
}

enum NoteExportError: LocalizedError {
    case empty, invalidInk, rendering, tooLarge
    var errorDescription: String? {
        switch self {
        case .empty: "Choose at least one nonempty section to export."
        case .invalidInk: "The drawing could not be exported. Your original note is preserved."
        case .rendering: "The document could not be exported completely. Your original note is preserved."
        case .tooLarge: "This export is too large. Export fewer sections at a time."
        }
    }
}

/// An allowlisted snapshot: no account metadata, credentials, voice profiles or audio paths.
struct NoteExportDocument: Sendable {
    struct Section: Sendable { let heading: String; let text: String }
    let title: String
    let sections: [Section]
    let ink: Data

    init(note: NoteRecord, selection: NoteExportSelection) throws {
        title = note.title.isEmpty ? L10n.key("Untitled note") : note.title
        var sections: [Section] = []
        if selection.personal && !note.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sections.append(Section(heading: L10n.key("Personal notes"), text: note.text))
        }
        for version in note.metadata?.summaries ?? [] where selection.summaryIDs.contains(version.id) {
            sections.append(Section(heading: L10n.key("Summary") + " · " + L10n.key(MeetingFormat(rawValue: version.format)?.label ?? version.format) + " · " + L10n.date(version.createdAt), text: version.text))
        }
        if selection.transcript && !note.passages.isEmpty {
            let body = note.passages.map { passage in
                let name = passage.speakerName ?? note.speakerAnnotations?.label(for: passage, localized: true) ?? L10n.key("Unassigned speaker")
                return "[\(Self.timestamp(passage.start))–\(Self.timestamp(passage.end))] \(name)\n\(passage.text)"
            }.joined(separator: "\n\n")
            sections.append(Section(heading: L10n.key("Transcript") + (note.metadata?.cloudTranscriptStatus == .complete ? "" : " · " + L10n.key("Transcript may be incomplete")), text: body))
        }
        self.sections = sections
        ink = selection.ink ? note.ink : Data()
        guard !sections.isEmpty || !ink.isEmpty else { throw NoteExportError.empty }
    }

    static func timestamp(_ value: TimeInterval) -> String {
        guard value.isFinite, value >= 0, value < Double(Int.max) else { return "?" }
        let seconds = Int(value)
        return String(format: "%02d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    }
}

struct NoteExportArtifact: Identifiable, Sendable {
    let id = UUID()
    let directory: URL
    let file: URL
    func cleanup() { try? FileManager.default.removeItem(at: directory) }
}

enum NoteExporter {
    static let temporaryRoot = FileManager.default.temporaryDirectory.appendingPathComponent("DoodleNoteExports", isDirectory: true)

    /// Only deletes this feature's own old UUID directories; never notes or someone else's temporary files.
    static func removeExpiredArtifacts(now: Date = Date()) {
        for url in (try? FileManager.default.contentsOfDirectory(at: temporaryRoot, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
            guard UUID(uuidString: url.lastPathComponent) != nil,
                  let created = try? url.resourceValues(forKeys: [.creationDateKey]).creationDate,
                  now.timeIntervalSince(created) > 86_400 else { continue }
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func create(_ document: NoteExportDocument, format: NoteExportFormat, root: URL = temporaryRoot) throws -> NoteExportArtifact {
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent(format == .pdf ? "DoodleNote.pdf" : "DoodleNote-Markdown.zip")
        do {
            try Task.checkCancellation()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
            let tiles = try inkTiles(document.ink)
            guard !document.sections.isEmpty || !tiles.isEmpty else { throw NoteExportError.empty }
            if format == .pdf { try pdf(document, tiles: tiles, to: file) }
            else {
                var text = "# " + markdownLiteral(document.title) + "\n\n"
                for section in document.sections { text += "## " + markdownLiteral(section.heading) + "\n\n" + markdownLiteral(section.text) + "\n\n" }
                var entries: [(String, Data)] = []
                var assetBytes = 0
                for (index, tile) in tiles.enumerated() {
                    try Task.checkCancellation()
                    let name = "assets/ink-\(index + 1).png"
                    guard let data = render(tile).pngData() else { throw NoteExportError.invalidInk }
                    assetBytes += data.count
                    guard assetBytes <= 32 * 1_024 * 1_024 else { throw NoteExportError.tooLarge }
                    entries.append((name, data))
                    text += "![" + L10n.key("Drawing") + " \(index + 1)](\(name))\n\n"
                }
                entries.insert(("note.md", Data(text.utf8)), at: 0)
                try StoredExportZIP.write(entries, to: file)
            }
            try Task.checkCancellation()
            return NoteExportArtifact(directory: directory, file: file)
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }

    /// Escape markup so user-authored links/HTML cannot load remote content in a Markdown reader.
    static func markdownLiteral(_ text: String) -> String {
        var result = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        for character in ["\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|"] {
            result = result.replacingOccurrences(of: character, with: "\\" + character)
        }
        return result.replacingOccurrences(of: "\n", with: "  \n")
    }

    struct InkTile { let drawing: PKDrawing; let rect: CGRect }
    static func inkTiles(_ data: Data) throws -> [InkTile] {
        guard !data.isEmpty else { return [] }
        guard let drawing = try? PKDrawing(data: data) else { throw NoteExportError.invalidInk }
        guard !drawing.strokes.isEmpty else { return [] }
        let bounds = drawing.bounds.insetBy(dx: -12, dy: -12)
        guard !bounds.isNull, !bounds.isInfinite, bounds.width.isFinite, bounds.height.isFinite else { throw NoteExportError.invalidInk }
        // Tile at natural size rather than shrinking an entire large canvas to unreadable marks.
        let columns = ceil(bounds.width / 500), rows = ceil(bounds.height / 680)
        guard columns * rows <= 256 else { throw NoteExportError.tooLarge }
        return (0..<Int(rows)).flatMap { row in (0..<Int(columns)).map { column in
            InkTile(drawing: drawing, rect: CGRect(x: bounds.minX + CGFloat(column) * 500, y: bounds.minY + CGFloat(row) * 680,
                width: min(500, bounds.width - CGFloat(column) * 500), height: min(680, bounds.height - CGFloat(row) * 680)))
        } }
    }

    static func render(_ tile: InkTile) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = true
        var result: UIImage!
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            result = UIGraphicsImageRenderer(size: tile.rect.size, format: format).image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: tile.rect.size))
                tile.drawing.image(from: tile.rect, scale: 2).draw(at: .zero)
            }
        }
        return result
    }

    static func pdf(_ document: NoteExportDocument, tiles: [InkTile], to file: URL) throws {
        let body = NSMutableAttributedString(string: document.title + "\n\n", attributes: [.font: UIFont.boldSystemFont(ofSize: 22), .foregroundColor: UIColor.black])
        for section in document.sections {
            body.append(NSAttributedString(string: section.heading + "\n", attributes: [.font: UIFont.boldSystemFont(ofSize: 15), .foregroundColor: UIColor.black]))
            body.append(NSAttributedString(string: section.text + "\n\n", attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor.black]))
        }
        let framesetter = CTFramesetterCreateWithAttributedString(body)
        let page = CGRect(x: 0, y: 0, width: 612, height: 792)
        var failure: Error?
        try UIGraphicsPDFRenderer(bounds: page).writePDF(to: file) { context in
            var offset = 0
            while offset < body.length {
                do { try Task.checkCancellation() } catch { failure = error; return }
                context.beginPage()
                let cg = context.cgContext
                cg.saveGState()
                cg.textMatrix = .identity
                cg.translateBy(x: 0, y: page.height)
                cg.scaleBy(x: 1, y: -1)
                let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: offset, length: 0), CGPath(rect: page.insetBy(dx: 44, dy: 48), transform: nil), nil)
                let visible = CTFrameGetVisibleStringRange(frame)
                guard visible.length > 0 else { cg.restoreGState(); failure = NoteExportError.rendering; return }
                CTFrameDraw(frame, cg)
                cg.restoreGState()
                offset += visible.length
            }
            for tile in tiles {
                do { try Task.checkCancellation() } catch { failure = error; return }
                context.beginPage()
                (L10n.key("Drawing") as NSString).draw(at: CGPoint(x: 44, y: 24), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 15), .foregroundColor: UIColor.black])
                render(tile).draw(in: CGRect(origin: CGPoint(x: 44, y: 56), size: tile.rect.size))
            }
        }
        if let failure { throw failure }
    }
}

/// Standard uncompressed ZIP with fixed safe relative paths, no third-party executable or network.
/// Writes payloads incrementally; explicitly refuses ZIP64 sizes instead of overflowing headers.
enum StoredExportZIP {
    private static let crcTable: [UInt32] = (0..<256).map { value in
        var crc = UInt32(value)
        for _ in 0..<8 { crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0) }
        return crc
    }
    static func write(_ entries: [(String, Data)], to url: URL) throws {
        guard entries.count <= Int(UInt16.max) else { throw NoteExportError.tooLarge }
        _ = FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        var central = Data()
        var offset: UInt64 = 0
        for (name, bytes) in entries {
            try Task.checkCancellation()
            let path = Data(name.utf8)
            guard bytes.count <= Int(UInt32.max), offset <= UInt64(UInt32.max), path.count <= Int(UInt16.max) else { throw NoteExportError.tooLarge }
            var crc: UInt32 = 0xffffffff
            for (index, byte) in bytes.enumerated() {
                if index % 65_536 == 0 { try Task.checkCancellation() }
                crc = (crc >> 8) ^ crcTable[Int((crc ^ UInt32(byte)) & 0xff)]
            }
            crc ^= 0xffffffff
            var local = Data()
            local.le(UInt32(0x04034b50)); local.le(UInt16(20)); local.le(UInt16(0x0800)); local.le(UInt16(0)); local.le(UInt16(0)); local.le(UInt16(33))
            local.le(crc); local.le(UInt32(bytes.count)); local.le(UInt32(bytes.count)); local.le(UInt16(path.count)); local.le(UInt16(0)); local.append(path)
            try handle.write(contentsOf: local); try handle.write(contentsOf: bytes)
            central.le(UInt32(0x02014b50)); central.le(UInt16(20)); central.le(UInt16(20)); central.le(UInt16(0x0800)); central.le(UInt16(0)); central.le(UInt16(0)); central.le(UInt16(33))
            central.le(crc); central.le(UInt32(bytes.count)); central.le(UInt32(bytes.count)); central.le(UInt16(path.count)); central.le(UInt16(0)); central.le(UInt16(0)); central.le(UInt16(0)); central.le(UInt16(0)); central.le(UInt32(0)); central.le(UInt32(offset)); central.append(path)
            offset += UInt64(local.count + bytes.count)
        }
        guard offset <= UInt64(UInt32.max), central.count <= Int(UInt32.max) else { throw NoteExportError.tooLarge }
        try handle.write(contentsOf: central)
        var end = Data(); end.le(UInt32(0x06054b50)); end.le(UInt16(0)); end.le(UInt16(0)); end.le(UInt16(entries.count)); end.le(UInt16(entries.count)); end.le(UInt32(central.count)); end.le(UInt32(offset)); end.le(UInt16(0))
        try handle.write(contentsOf: end)
    }
}

private extension Data {
    mutating func le<T: FixedWidthInteger>(_ value: T) { var value = value.littleEndian; Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) } }
}
