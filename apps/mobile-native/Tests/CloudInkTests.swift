import ImageIO
import PencilKit
import XCTest
@testable import DoodleNoteNative

final class CloudInkTests: XCTestCase {
    func testEmptyDrawingPreviewIsBoundedStaticRGBAAndUploadPlanSurvivesRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = UUID(), note = UUID(), head = UUID(), generation = UUID()
        let transfer = try CloudInkTransfer(root: root, libraryID: library)
        let ink = PKDrawing().dataRepresentation()
        let plan = try await transfer.prepare(noteID: note, ink: ink, head: head, generation: generation)
        let png = plan.preview
        XCTAssertEqual(Array(png.prefix(8)), [137,80,78,71,13,10,26,10])
        XCTAssertEqual(png[24], 8, "8-bit preview")
        XCTAssertTrue([2,6].contains(png[25]), "RGB or RGBA only")
        XCTAssertEqual(png[28], 0, "not interlaced")
        let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertGreaterThan(image.width, 0)
        XCTAssertLessThanOrEqual(image.width * image.height, 4_194_304)
        let reopened = try CloudInkTransfer(root: root, libraryID: library)
        let retry = try await reopened.prepare(noteID: note, ink: ink, head: head, generation: generation)
        XCTAssertEqual(retry.versionID, plan.versionID)
        XCTAssertEqual(retry.head, head)
        XCTAssertEqual(retry.preview, plan.preview)
        let matched = try await reopened.matches(noteID: note, ink: ink, references: [plan.reference])
        XCTAssertTrue(matched)
        let changedHead = UUID(), changedGeneration = UUID()
        let rebased = try await reopened.prepare(noteID: note, ink: ink, head: changedHead, generation: changedGeneration)
        XCTAssertNotEqual(rebased.versionID, plan.versionID)
        XCTAssertEqual(rebased.head, changedHead)
        XCTAssertEqual(rebased.generation, changedGeneration)
        try await reopened.purge(noteID: note)
        let after = try await reopened.matches(noteID: note, ink: ink, references: [plan.reference])
        XCTAssertFalse(after)
    }
}
