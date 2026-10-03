import XCTest
@testable import DoodleNoteNative

final class CloudConflictPreviewTests: XCTestCase {
    func testLatePreviewCannotReplaceNewSelectionOrRepopulateAfterLock() {
        var preview = CloudConflictPreview()
        let a = UUID(), b = UUID(), revisionB = UUID()
        let readA = preview.begin(noteID: a)
        let readB = preview.begin(noteID: b)
        preview.publish(requestID: readB, noteID: b, revisionID: revisionB, text: "B source")
        preview.publish(requestID: readA, noteID: a, revisionID: UUID(), text: "A source")
        XCTAssertEqual(preview.noteID, b)
        XCTAssertEqual(preview.revisionID, revisionB)
        XCTAssertEqual(preview.text, "B source")
        preview.invalidate()
        preview.publish(requestID: readB, noteID: b, revisionID: revisionB, text: "B source")
        XCTAssertNil(preview.text)
        XCTAssertNil(preview.revisionID)
        XCTAssertNil(preview.noteID)
    }
}
