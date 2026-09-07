import XCTest
@testable import DoodleNoteNative

final class TranscriptCloudTests: XCTestCase {
    func testCrossDeviceCorrectionMarkerRoundTripsAndProtectsRetryBeforeItStarts() throws {
        let map = CloudIdentityMap(identity: .init(accountID: "fixture", workspaceID: "work"), remoteLibraryID: UUID())
        let remoteID = UUID()
        var original = NoteRecord()
        original.metadata?.libraryID = map.localLibraryID
        original.passages = [.init(start: 0, end: 1, text: "Correction from another device", isFinal: true, isUserEdited: true)]
        let snapshot = try CloudProjection(map: map, remoteNoteID: remoteID).snapshot(note: original, retained: [], inkReferences: [])
        XCTAssertEqual(snapshot["passages"]?.list?.first?["isUserEdited"], .bool(true))
        XCTAssertEqual(snapshot["sourceVersions"]?.list?.first?["passages"]?.list?.first?["isUserEdited"], .bool(true))
        let decoder = CloudSnapshotDecoder(map: map, remoteNoteID: remoteID, localNoteID: map.localNoteID(remoteID))
        let decoded = try decoder.decode(snapshot, revisionID: UUID(), generation: UUID(), savedAt: Date(), ink: Data())
        XCTAssertFalse(decoded.isReadOnly)
        XCTAssertEqual(decoded.sources.first?.passages.first?.isUserEdited, true)
        var received = decoded.note
        XCTAssertTrue(received.replaceTranscript(start: 0, end: 1, with: [.init(start: 0, end: 1, text: "Later automatic recognition", isFinal: true)]))
        XCTAssertEqual(received.passages.first?.text, "Correction from another device")
        XCTAssertEqual(received.passages.first?.isUserEdited, true)
        // Optional booleans must not be interpreted from strings in either head or history.
        for history in [false, true] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: snapshot.data()) as? [String: Any])
            if history {
                var sources = object["sourceVersions"] as! [[String: Any]]
                var passages = sources[0]["passages"] as! [[String: Any]]
                passages[0]["isUserEdited"] = "true"; sources[0]["passages"] = passages; object["sourceVersions"] = sources
            } else {
                var passages = object["passages"] as! [[String: Any]]
                passages[0]["isUserEdited"] = "true"; object["passages"] = passages
            }
            let bad = try JSONDecoder().decode(CloudJSON.self, from: JSONSerialization.data(withJSONObject: object))
            XCTAssertThrowsError(try decoder.decode(bad, revisionID: UUID(), generation: UUID(), savedAt: Date(), ink: Data()))
        }
    }

    func testCompletionUsesDurableSpeechOutcomeInsteadOfFinishedAudio() throws {
        let map = CloudIdentityMap(identity: .init(accountID: "fixture", workspaceID: "work"), remoteLibraryID: UUID())
        var note = NoteRecord()
        note.metadata?.libraryID = map.localLibraryID
        note.captureState = .finished
        note.passages = [.init(start: 0, end: 1, text: "Final portion", isFinal: true)]
        let projection = CloudProjection(map: map, remoteNoteID: UUID())
        XCTAssertEqual(try projection.snapshot(note: note, retained: [], inkReferences: [])["transcriptStatus"], .string("partial"))
        for status in [TranscriptCompletion.partial, .interrupted, .complete] {
            note.metadata?.cloudTranscriptStatus = status
            XCTAssertEqual(try projection.snapshot(note: note, retained: [], inkReferences: [])["transcriptStatus"], .string(status.rawValue))
        }
    }

    func testCloudImportPreservesCorrectionsAndLanguageAcrossSameAndNewHead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root), repository = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "fixture", workspaceID: "work")
        let record = try await repository.addLibrary(name: "Fixture", identity: identity)
        var note = NoteRecord()
        note.metadata?.libraryID = record.id
        note.captureState = .finished
        note.speechSessions = [.init(id: UUID(), start: 0, end: 1, language: .danish)]
        note.passages = [.init(start: 0, end: 1, text: "Reviewed correction", isFinal: true, isUserEdited: true)]
        try await repository.save(note, identities: [identity])
        let original = note
        for newHead in [false, true] {
            var incoming = note
            incoming.speechSessions = nil; incoming.captureState = .idle
            incoming.passages[0].isUserEdited = nil
            if newHead { incoming.metadata?.revisionID = UUID(); incoming.text = "Remote personal edit"; incoming.updatedAt = Date() }
            let remote = CloudRemoteNote(id: UUID(), headRevision: UUID(), generation: UUID(), state: .active)
            try await repository.cloudImport(decoded: .init(note: incoming, sources: [NoteRevision(incoming)], isLegacy: false, isReadOnly: false),
                remote: remote, localNoteID: note.id, libraryID: record.id, identity: identity,
                expectedLocalRevisionID: note.metadata?.revisionID, readOnly: false)
            let loaded = try await repository.cloudNote(noteID: note.id, libraryID: record.id, identity: identity)
            note = try XCTUnwrap(loaded)
            XCTAssertEqual(note.speechSessions, original.speechSessions)
            XCTAssertEqual(note.passages.first?.isUserEdited, true)
            XCTAssertEqual(note.captureState, .finished)
            XCTAssertNotEqual(note.transcriptCloudReviewRequired, true)
            XCTAssertEqual(try disk.load(recoverRecording: false).notes.first?.passages, note.passages)
        }
        // Changed cloud text is accepted, but never inherits the local human-review marker.
        var changed = note
        changed.metadata?.revisionID = UUID(); changed.updatedAt = Date()
        changed.passages[0].text = "Changed remote phrase"; changed.passages[0].isUserEdited = nil
        changed.metadata?.cloudTranscriptStatus = .complete
        try await repository.cloudImport(decoded: .init(note: changed, sources: [NoteRevision(changed)], isLegacy: false, isReadOnly: false),
            remote: .init(id: UUID(), headRevision: UUID(), generation: UUID(), state: .active),
            localNoteID: note.id, libraryID: record.id, identity: identity,
            expectedLocalRevisionID: note.metadata?.revisionID, readOnly: false)
        let imported = try await repository.cloudNote(noteID: note.id, libraryID: record.id, identity: identity)
        var reviewed = try XCTUnwrap(imported)
        XCTAssertEqual(reviewed.passages[0].text, "Changed remote phrase")
        XCTAssertNil(reviewed.passages[0].isUserEdited)
        XCTAssertEqual(reviewed.transcriptCloudReviewRequired, true)
        XCTAssertEqual(reviewed.metadata?.cloudTranscriptStatus, .partial)
        let anchor = try XCTUnwrap(reviewed.transcriptCorrectionSources?.first)
        let text = try await repository.resolve(anchor, identities: [identity])
        XCTAssertEqual(text, "Reviewed correction")
        reviewed.acknowledgeTranscriptCloudReview()
        XCTAssertEqual(reviewed.transcriptCloudReviewRequired, false)
        XCTAssertEqual(reviewed.transcriptNeedsReview, true)
        XCTAssertEqual(reviewed.metadata?.cloudTranscriptStatus, .partial)
    }

    func testRetryCannotClearReviewWhenRecognitionOmitsACorrectedInterval() {
        var note = NoteRecord()
        note.passages = [.init(start: 0, end: 1, text: "Reviewed original", isFinal: true, isUserEdited: true)]
        XCTAssertFalse(note.replaceTranscript(start: 0, end: 1, with: []))
        XCTAssertEqual(note.passages[0].text, "Reviewed original")
        XCTAssertEqual(note.transcriptNeedsReview, true)
    }

    func testDeletedCorrectionRetainsHistoryAnchorAndUnrelatedReviewState() {
        var old = NoteRecord()
        old.passages = [.init(start: 0, end: 1, text: "Original", isFinal: true, isUserEdited: true)]
        var next = old; next.passages = []; next.metadata?.revisionID = UUID()
        var sources = [NoteRevision(next)]
        next.preserveLocalTranscript(from: old, sources: &sources)
        XCTAssertTrue(next.passages.isEmpty)
        XCTAssertEqual(next.transcriptCorrectionSources?.first?.revisionID, old.metadata?.revisionID)
        XCTAssertEqual(next.transcriptCloudReviewRequired, true)
    }
}
