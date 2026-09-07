import XCTest
import PencilKit
@testable import DoodleNoteNative

@MainActor final class InkEditingTests: XCTestCase {
    func testNonemptyEditUndoRedoSerializeAndReopen() throws {
        let session = InkEditingSession(), id = UUID()
        let first = InkFixture.drawing()
        session.load(first.dataRepresentation(), id: id, editable: true)
        var updated = first
        updated.strokes.append(first.strokes[0])
        var persisted = Data()
        session.changed = { persisted = $0 }
        session.replace(with: updated)
        XCTAssertEqual(try PKDrawing(data: persisted).strokes.count, 4)
        session.undo()
        XCTAssertEqual(try PKDrawing(data: persisted).strokes.count, 3)
        session.redo()
        XCTAssertEqual(try PKDrawing(data: persisted).strokes.count, 4)
        let reopened = InkEditingSession()
        reopened.load(persisted, id: id, editable: true)
        XCTAssertEqual(reopened.canvas.drawing.strokes.count, 4)
        XCTAssertNil(reopened.problem)
    }

    func testStrokeGroupsChangesAndRepeatedLayoutLoadKeepsUndo() throws {
        let session = InkEditingSession(), id = UUID()
        session.load(Data(), id: id, editable: true)
        session.canvasViewDidBeginUsingTool(session.canvas)
        session.canvas.drawing = InkFixture.drawing()
        session.canvasViewDrawingDidChange(session.canvas)
        let result = session.bytes
        session.load(result, id: id, editable: true)
        session.canvasViewDidEndUsingTool(session.canvas)
        XCTAssertEqual(session.undoSteps.count, 1)
        session.undo()
        XCTAssertTrue(session.canvas.drawing.strokes.isEmpty)
        session.redo()
        XCTAssertEqual(session.canvas.drawing.strokes.count, 3)
    }

    func testCorruptAndReadOnlyInkNeverPublishesEmptyReplacement() throws {
        let session = InkEditingSession(), original = Data([0, 1, 2, 3])
        var writes = 0
        session.changed = { _ in writes += 1 }
        let corruptID = UUID()
        session.load(original, id: corruptID, editable: true)
        session.load(original, id: corruptID, editable: true)
        XCTAssertFalse(session.canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertNotNil(session.problem)
        session.replace(with: InkFixture.drawing())
        session.canvasViewDrawingDidChange(session.canvas)
        XCTAssertEqual(session.bytes, original)
        XCTAssertEqual(writes, 0)
        let valid = InkFixture.drawing().dataRepresentation()
        session.load(valid, id: UUID(), editable: false)
        session.replace(with: PKDrawing())
        XCTAssertEqual(session.bytes, valid)
        XCTAssertFalse(session.canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertTrue(session.canvas.isScrollEnabled)
        XCTAssertEqual(writes, 0)
    }

    func testUndoDuringActiveGestureDoesNotResurrectHistoryAtEnd() {
        let session = InkEditingSession()
        session.load(Data(), id: UUID(), editable: true)
        session.canvasViewDidBeginUsingTool(session.canvas)
        session.canvas.drawing = InkFixture.drawing()
        session.canvasViewDrawingDidChange(session.canvas)
        session.undo()
        XCTAssertTrue(session.canvas.drawing.strokes.isEmpty)
        XCTAssertTrue(session.undoSteps.isEmpty)
        XCTAssertEqual(session.redoSteps.count, 1)
        session.canvasViewDidEndUsingTool(session.canvas)
        XCTAssertTrue(session.undoSteps.isEmpty)
        XCTAssertEqual(session.redoSteps.count, 1)
        session.redo()
        XCTAssertEqual(session.canvas.drawing.strokes.count, 3)
        XCTAssertEqual(session.undoSteps.count, 1)
    }

    func testChangingNotesCannotUndoIntoAnotherNote() {
        let session = InkEditingSession()
        session.load(Data(), id: UUID(), editable: true)
        session.replace(with: InkFixture.drawing())
        session.canvasViewDidBeginUsingTool(session.canvas)
        session.load(Data(), id: UUID(), editable: true)
        session.canvasViewDidEndUsingTool(session.canvas)
        session.undo()
        XCTAssertTrue(session.canvas.drawing.strokes.isEmpty)
        XCTAssertTrue(session.undoSteps.isEmpty)
    }

    func testFailedInkSavePreservesPreviousAndPendingDrawingForRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let original = InkFixture.drawing().dataRepresentation()
        library.update(id) { $0.ink = original; $0.text = "Personal text" }
        await library.flush()
        let disk = try XCTUnwrap(library.disk), file = disk.directory(for: id).appendingPathComponent("note.json")
        let source = try Data(contentsOf: file)
        let recovery = root.appendingPathComponent("synthetic-preserved-original.json")
        try source.write(to: recovery)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        var changed = InkFixture.drawing(); changed.strokes.append(changed.strokes[0])
        let newer = changed.dataRepresentation()
        library.update(id) { $0.ink = newer }
        let saved = await library.flush()
        XCTAssertFalse(saved)
        XCTAssertEqual(library.note(id)?.ink, newer)
        XCTAssertEqual(try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: recovery)).ink, original)
        try FileManager.default.removeItem(at: file)
        try source.write(to: file)
        library.retrySaving()
        let retried = await library.flush()
        XCTAssertTrue(retried)
        let reopened = try XCTUnwrap(disk.load().notes.first)
        XCTAssertEqual(try PKDrawing(data: reopened.ink).strokes.count, 4)
        XCTAssertEqual(reopened.text, "Personal text")
    }
}
