import XCTest
@testable import DoodleNoteNative

@MainActor final class PreparationTests: XCTestCase {
    func testNavigationCannotReplaceThePreparingSpeechLanguage() async {
        var requested: [SpokenLanguage] = []
        var pending: CheckedContinuation<LocalSpeech.Availability?, Never>?
        let entered = expectation(description: "Capture language probe entered")
        let speech = LocalSpeech(availability: { language in
            requested.append(language)
            return await withCheckedContinuation { pending = $0; entered.fulfill() }
        })
        let start = Task { await speech.start(language: .english, offset: 0, onPassage: { _ in }) }
        await fulfillment(of: [entered], timeout: 2)
        await speech.check(.spanish)
        XCTAssertEqual(requested, [.english])
        pending?.resume(returning: nil)
        let feed = await start.value
        XCTAssertNil(feed)
        XCTAssertEqual(speech.readiness, .unavailable)
    }

    func testPlaybackIsExcludedWhileRecordPermissionIsPending() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        let id = try XCTUnwrap(library.create())
        var pending: CheckedContinuation<Bool, Never>?
        let entered = expectation(description: "Permission request entered")
        let recording = RecordingSession(recordPermission: {
            await withCheckedContinuation { pending = $0; entered.fulfill() }
        })
        XCTAssertTrue(recording.permitsPlayback)
        let start = Task { await recording.start(id, library: library) }
        await fulfillment(of: [entered], timeout: 2)
        XCTAssertTrue(recording.busy)
        XCTAssertNil(recording.noteID)
        XCTAssertFalse(recording.permitsPlayback)
        pending?.resume(returning: false)
        await start.value
        XCTAssertTrue(recording.permitsPlayback)
        XCTAssertNotNil(recording.problem)
    }
}
