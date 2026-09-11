import XCTest
import PDFKit
import PencilKit
@testable import DoodleNoteNative

final class NoteExportTests: XCTestCase {
    private let languages = ["English complete", "Dansk æøå ÆØÅ", "Español acción ¿Qué?", "Français été cœur", "Deutsch Grüße äöüß"]
    private func fixture() -> NoteRecord {
        var note = NoteRecord()
        note.title = "Export fixture"
        note.text = languages.joined(separator: "\n")
        note.passages = [.init(start: 3661, end: 3665, text: "Transcript preserved", isFinal: true, speakerName: "Camille")]
        note.metadata?.cloudTranscriptStatus = .complete
        note.ink = InkFixture.drawing().dataRepresentation()
        note.metadata?.summaries = [.init(id: UUID(), parentID: nil, createdAt: Date(timeIntervalSince1970: 0), origin: .generated, format: "general", language: .english, text: "Older selected summary", sources: []),
                                    .init(id: UUID(), parentID: nil, createdAt: Date(timeIntervalSince1970: 100), origin: .edited, format: "general", language: .english, text: "Newer unselected summary", sources: [])]
        return note
    }

    func testSelectedSectionsAndVersionDoNotLeakOtherContent() throws {
        let note = fixture()
        let selected = NoteExportSelection(personal: false, transcript: true, ink: false, summaryIDs: [note.metadata!.summaries[0].id])
        let doc = try NoteExportDocument(note: note, selection: selected)
        let text = doc.sections.map(\.text).joined()
        XCTAssertTrue(text.contains("Older selected summary"))
        XCTAssertFalse(text.contains("Newer unselected summary"))
        XCTAssertFalse(text.contains("English complete"))
        XCTAssertTrue(text.contains("[01:01:01–01:01:05] Camille"))
        XCTAssertTrue(doc.ink.isEmpty)
    }

    func testLocalSpeakerAnnotationsPreserveConfirmedAndProvisionalLabels() throws {
        var note = fixture()
        note.passages[0].speakerName = nil
        let turn = SpeakerTurn(sessionID: UUID(), slot: 0, start: 3661, end: 3665, isFinal: false)
        note.speakerAnnotations = SpeakerAnnotations(turns: [turn], names: [turn.key: "Camille"])
        let doc = try NoteExportDocument(note: note, selection: NoteExportSelection(personal: false, transcript: true, ink: false))
        XCTAssertTrue(doc.sections[0].text.contains("Camille (provisional)"))
    }

    func testPDFContainsEveryLanguageAndFinalTextAcrossManyPages() throws {
        var note = fixture()
        note.ink = Data()
        note.text = (0..<120).map { index in "Row \(index) " + languages.joined(separator: " / ") }.joined(separator: "\n") + "\nFINAL_SENTINEL"
        let artifact = try NoteExporter.create(NoteExportDocument(note: note, selection: NoteExportSelection()), format: .pdf)
        defer { artifact.cleanup() }
        let pdf = try XCTUnwrap(PDFDocument(url: artifact.file))
        XCTAssertGreaterThan(pdf.pageCount, 3)
        let text = try XCTUnwrap(pdf.string)
        for value in languages { XCTAssertTrue(text.contains(value), value) }
        for index in 0..<120 { XCTAssertTrue(text.contains("Row \(index) ")) }
        XCTAssertTrue(text.contains("FINAL_SENTINEL"))
        XCTAssertTrue(text.contains("Transcript preserved"))
        XCTAssertTrue(text.contains("Camille"))
        add(XCTAttachment(contentsOfFile: artifact.file))
    }

    func testMarkdownArchiveReferencesAllInkTilesAndOnlySafeContent() throws {
        let note = fixture()
        let artifact = try NoteExporter.create(NoteExportDocument(note: note, selection: NoteExportSelection()), format: .markdown)
        defer { artifact.cleanup() }
        let entries = try unzipStored(Data(contentsOf: artifact.file))
        let markdown = try XCTUnwrap(String(data: XCTUnwrap(entries["note.md"]), encoding: .utf8))
        for name in entries.keys where name != "note.md" {
            XCTAssertTrue(name.hasPrefix("assets/ink-"))
            XCTAssertTrue(markdown.contains("](\(name))"))
            XCTAssertNotNil(UIImage(data: entries[name]!))
        }
        XCTAssertEqual(entries.count, try NoteExporter.inkTiles(note.ink).count + 1)
        XCTAssertGreaterThan(entries.count, 1)
        XCTAssertTrue(markdown.contains("Dansk æøå ÆØÅ"))
        XCTAssertTrue(markdown.contains("Camille"))
        XCTAssertFalse(markdown.contains("Newer unselected summary"))
        XCTAssertFalse(entries.keys.contains(where: { $0.hasSuffix(".caf") || $0.contains("profile") || $0.contains("token") }))
        let attachment = XCTAttachment(contentsOfFile: artifact.file); attachment.name = "Complete Markdown package"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testInkPDFHasAllTilesAtReadableScale() throws {
        let note = fixture()
        let tiles = try NoteExporter.inkTiles(note.ink)
        XCTAssertGreaterThan(tiles.count, 1)
        XCTAssertTrue(tiles.allSatisfy { $0.rect.width <= 500 && $0.rect.height <= 680 })
        let doc = try NoteExportDocument(note: note, selection: NoteExportSelection(personal: false, transcript: false, ink: true))
        let artifact = try NoteExporter.create(doc, format: .pdf)
        defer { artifact.cleanup() }
        let pdf = try XCTUnwrap(PDFDocument(url: artifact.file))
        XCTAssertEqual(pdf.pageCount, tiles.count + 1)
        let attachment = XCTAttachment(contentsOfFile: artifact.file); attachment.name = "Readable ink tiles"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testEmptySelectionAndCorruptInkFailWithoutMutatingNoteOrLeavingFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var note = fixture()
        note.ink = Data("bad drawing".utf8)
        let before = note
        XCTAssertThrowsError(try NoteExportDocument(note: note, selection: NoteExportSelection(personal: false, transcript: false, ink: false)))
        let doc = try NoteExportDocument(note: note, selection: NoteExportSelection())
        XCTAssertThrowsError(try NoteExporter.create(doc, format: .pdf, root: root))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        XCTAssertEqual(note, before)
    }

    func testCancellationAndCleanupPreserveOriginalAndUnrelatedFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let sentinel = root.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: sentinel)
        let document = try NoteExportDocument(note: fixture(), selection: NoteExportSelection())
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try NoteExporter.create(document, format: .pdf, root: root)
        }
        do { _ = try await task.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("Unexpected error") }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), ["keep.txt"])
        let artifact = try NoteExporter.create(document, format: .pdf, root: root)
        artifact.cleanup(); artifact.cleanup()
        XCTAssertEqual(try Data(contentsOf: sentinel), Data("keep".utf8))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), ["keep.txt"])
    }

    func testMarkdownDoesNotInterpretUserHTMLOrRemoteImages() {
        let rendered = NoteExporter.markdownLiteral("![private](https://example.com/pixel) <script> & text")
        XCTAssertFalse(rendered.contains("![private]("))
        XCTAssertFalse(rendered.contains("<script>"))
        XCTAssertTrue(rendered.contains("&lt;script&gt;"))
    }

    /// Independent minimal reader of ZIP local headers, not the production writer's helpers.
    private func unzipStored(_ data: Data) throws -> [String: Data] {
        let bytes = [UInt8](data)
        func number(_ position: Int, _ count: Int) -> Int { (0..<count).reduce(0) { $0 | (Int(bytes[position + $1]) << ($1 * 8)) } }
        var offset = 0
        var result: [String: Data] = [:]
        while offset + 30 <= bytes.count, number(offset, 4) == 0x04034b50 {
            XCTAssertEqual(number(offset + 8, 2), 0)
            let size = number(offset + 18, 4), nameLength = number(offset + 26, 2), extra = number(offset + 28, 2)
            let start = offset + 30 + nameLength + extra
            guard start + size <= bytes.count else { throw NoteExportError.rendering }
            let name = String(decoding: bytes[(offset + 30)..<(offset + 30 + nameLength)], as: UTF8.self)
            result[name] = Data(bytes[start..<(start + size)])
            offset = start + size
        }
        XCTAssertEqual(number(offset, 4), 0x02014b50)
        return result
    }
}
