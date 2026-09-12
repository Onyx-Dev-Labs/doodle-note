import XCTest
import SwiftData
@testable import DoodleNote

final class WatchRecordingTests: XCTestCase {
    func testMetadataRejectsUnsupportedInvalidAndNonFiniteValues() throws {
        let recording = WatchRecording(duration: 30, status: .ready)
        let decoded = try WatchRecording(metadata: recording.metadata)
        XCTAssertEqual(decoded.id, recording.id)
        XCTAssertEqual(decoded.duration, recording.duration)
        XCTAssertEqual(decoded.startedAt.timeIntervalSince1970, recording.startedAt.timeIntervalSince1970, accuracy: 0.001)
        for patch: [String: Any] in [["version": 999], ["id": "../../other"], ["duration": -1.0], ["duration": Double.infinity], ["startedAt": Double.nan]] {
            XCTAssertThrowsError(try WatchRecording(metadata: recording.metadata.merging(patch) { _, new in new }))
        }
    }

    func testReceiptSurvivesRemovalOfTemporaryTransferAndDuplicateKeepsProgress() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("transfer.caf")
        let fixture = Data("synthetic audio bytes".utf8)
        try fixture.write(to: source)
        let store = WatchRecordingStore(directory: root.appendingPathComponent("inbox"))
        let recording = WatchRecording(duration: 45, status: .ready)
        try store.receive(recording, from: source)
        try FileManager.default.removeItem(at: source)
        XCTAssertEqual(try Data(contentsOf: store.audioURL(recording.id)), fixture)
        var completed = recording
        completed.status = .transcribed
        try store.save(completed)
        try store.receive(recording, from: source)
        let reopened = WatchRecordingStore(directory: store.directory)
        XCTAssertEqual(try reopened.recordings(), [completed])
    }

    func testFailedCopyDoesNotCreateReceipt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = WatchRecordingStore(directory: root)
        XCTAssertThrowsError(try store.receive(WatchRecording(duration: 10), from: root.appendingPathComponent("missing.caf")))
        XCTAssertTrue(try store.recordings().isEmpty)
    }

    @MainActor
    func testTranscriptImportRetryDoesNotDuplicateOrOverwriteMeeting() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let container = try ModelContainer(for: Meeting.self, Segment.self, Folder.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let inbox = WatchInbox(store: WatchRecordingStore(directory: root))
        let recording = WatchRecording(duration: 12, status: .received)
        let parts = [WatchTranscriptSegment(text: "Synthetic test sentence", startMs: 0, endMs: 1000)]
        try inbox.saveTranscript(parts, for: recording, container: container)
        try inbox.saveTranscript(parts, for: recording, container: container)
        let context = ModelContext(container)
        let meetings = try context.fetch(FetchDescriptor<Meeting>())
        XCTAssertEqual(meetings.count, 1)
        XCTAssertEqual(meetings.first?.origin, "watch")
        XCTAssertEqual(meetings.first?.segments.count, 1)
        XCTAssertEqual(meetings.first?.durationMs, 12_000)
        XCTAssertEqual(try inbox.store.recordings().first?.status, .transcribed)
    }
}
