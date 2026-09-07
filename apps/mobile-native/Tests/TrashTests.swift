import XCTest
import AVFoundation
@testable import DoodleNoteNative

final class TrashTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func fixture() throws -> (NoteDiskStore, LibraryRepository, NoteRecord) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root)
        var note = NoteRecord()
        note.text = "Keep private text"
        note.ink = Data([1, 2, 3])
        note.passages = [TranscriptPassage(start: 0, end: 2, text: "Keep transcript", isFinal: true)]
        note.metadata?.summaries = [SummaryVersion(id: UUID(), parentID: nil, createdAt: now, origin: .generated,
            format: "meeting", language: .english, text: "Keep summary", sources: [])]
        try disk.save(note)
        try Data([7, 8, 9]).write(to: disk.audioDirectory(for: note.id).appendingPathComponent("001.caf"))
        try Data("original migration backup".utf8).write(to: disk.directory(for: note.id).appendingPathComponent("note.schema1.original.json"))
        return (disk, LibraryRepository(disk: disk), note)
    }

    func testTrashRetainsAudioAndSourcesAreUnavailableUntilRestore() async throws {
        let (disk, repository, note) = try fixture()
        let anchor = SourceAnchor(libraryID: LibraryRecord.localID, noteID: note.id,
            revisionID: note.metadata!.revisionID, content: .personalParagraph(0))
        let state = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), now: now, identities: [])
        XCTAssertEqual(state.expiresAt, now.addingTimeInterval(30 * 86400))
        XCTAssertEqual(try Data(contentsOf: disk.directory(for: note.id).appendingPathComponent("audio/001.caf")), Data([7, 8, 9]))
        do { _ = try await repository.resolve(anchor, identities: []); XCTFail("Trash source leaked") } catch { }
        let restored = try await repository.restore(noteID: note.id, libraryID: LibraryRecord.localID,
            deletionID: state.deletionID!, expectedGeneration: state.generation, operationID: UUID(), now: now.addingTimeInterval(29 * 86400), identities: [])
        XCTAssertEqual(restored.text, note.text)
        XCTAssertEqual(restored.ink, note.ink)
        XCTAssertEqual(restored.metadata?.summaries, note.metadata?.summaries)
        XCTAssertNotEqual(restored.metadata?.lifecycleGeneration, note.metadata?.lifecycleGeneration)
        let source = try await repository.resolve(anchor, identities: [])
        XCTAssertEqual(source, note.text)
        XCTAssertThrowsError(try disk.save(note), "Old pre-trash save must not resurrect or overwrite restored note")
    }

    func testExpiryRunsOnLaterExecutionAndPermanentPurgeCoversAllPayload() async throws {
        let (disk, repository, note) = try fixture()
        _ = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), now: now, identities: [])
        _ = try await repository.processRetention(now: now.addingTimeInterval(30 * 86400 - 1), identities: [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: disk.directory(for: note.id).path))
        let restarted = LibraryRepository(disk: disk)
        _ = try await restarted.processRetention(now: now.addingTimeInterval(31 * 86400), identities: [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: disk.directory(for: note.id).path))
        let receipt = try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID)
        XCTAssertEqual(receipt.state, .purged)
        XCTAssertFalse(receipt.cleanupPending)
        _ = try await restarted.processRetention(now: now.addingTimeInterval(40 * 86400), identities: [])
        XCTAssertThrowsError(try disk.save(note))
        XCTAssertThrowsError(try disk.audioDirectory(for: note.id))
        XCTAssertTrue(try disk.load().notes.isEmpty)
    }

    func testConfirmationAndFailedPurgeAreDurableAndRetryable() async throws {
        let (disk, repository, note) = try fixture()
        let state = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), now: now, identities: [])
        do {
            _ = try await repository.permanentlyDelete(noteID: note.id, libraryID: LibraryRecord.localID,
                expectedGeneration: state.generation, operationID: UUID(), confirmed: false, identities: [])
            XCTFail("Missing confirmation accepted")
        } catch { }
        XCTAssertEqual(try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID).state, .trashed)
        do {
            _ = try await repository.permanentlyDelete(noteID: note.id, libraryID: LibraryRecord.localID,
                expectedGeneration: state.generation, operationID: UUID(), confirmed: true, identities: [],
                beforeRemoval: { throw CocoaError(.fileWriteNoPermission) })
            XCTFail("Injected failure ignored")
        } catch { }
        XCTAssertTrue(try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID).cleanupPending)
        XCTAssertTrue(FileManager.default.fileExists(atPath: disk.directory(for: note.id).path))
        XCTAssertTrue(try disk.load().notes.isEmpty)
        let usage = try await repository.storageUsage(libraryID: LibraryRecord.localID, identities: [])
        XCTAssertGreaterThan(usage.notesBytes, 0)
        XCTAssertEqual(usage.audioBytes, 3)
        XCTAssertThrowsError(try disk.save(note))
        _ = try await LibraryRepository(disk: disk).processRetention(now: now, identities: [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: disk.directory(for: note.id).path))
        XCTAssertFalse(try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID).cleanupPending)
    }

    func testRestoreIntentRecoversAfterRestartAndMissingFolderBecomesUnfiled() async throws {
        let (disk, repository, original) = try fixture()
        let folder = try await repository.addFolder(name: "Old folder", libraryID: LibraryRecord.localID, identities: [])
        var note = original
        note.metadata?.folderID = folder.id
        try await repository.save(note, identities: [])
        let state = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), now: now, identities: [])
        var catalog = try await repository.catalog()
        catalog.folders = []
        try await repository.saveCatalog(catalog)
        do {
            _ = try await repository.restore(noteID: note.id, libraryID: LibraryRecord.localID,
                deletionID: state.deletionID!, expectedGeneration: state.generation, operationID: UUID(), now: now, identities: [],
                beforeRestore: { throw CocoaError(.fileWriteOutOfSpace) })
            XCTFail("Injected failure ignored")
        } catch { }
        XCTAssertTrue(try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID).restorePending)
        XCTAssertThrowsError(try disk.save(original))
        _ = try await LibraryRepository(disk: disk).processRetention(now: now, identities: [])
        let restored = try XCTUnwrap(disk.load().notes.first)
        XCTAssertNil(restored.metadata?.folderID)
        XCTAssertEqual(restored.text, note.text)
        XCTAssertEqual(restored.metadata?.libraryID, LibraryRecord.localID)
    }

    func testFailedAudioCleanupRetainsPayloadUntilRetryAndUsageCountsPendingPurge() async throws {
        let (disk, repository, note) = try fixture()
        do {
            _ = try await repository.removeAudio(noteID: note.id, libraryID: LibraryRecord.localID,
                expectedGeneration: note.id, operationID: UUID(), confirmed: true, now: now, identities: [],
                beforeRemoval: { throw CocoaError(.fileWriteNoPermission) })
            XCTFail("Injected failure ignored")
        } catch { }
        let usage = try await repository.storageUsage(libraryID: LibraryRecord.localID, identities: [])
        XCTAssertGreaterThan(usage.notesBytes, 0)
        XCTAssertEqual(usage.audioBytes, 3)
        XCTAssertTrue(disk.audioFiles(for: note.id).isEmpty)
        _ = try await repository.processRetention(now: now, identities: [])
        XCTAssertEqual(try disk.load().notes, [note])
        let cleaned = try await repository.storageUsage(libraryID: LibraryRecord.localID, identities: [])
        XCTAssertEqual(cleaned.audioBytes, 0)
    }

    func testAudioRemovalPreservesAllContentAndReplayDoesNotDeleteNewAudio() async throws {
        let (disk, repository, note) = try fixture()
        let operation = UUID()
        _ = try await repository.removeAudio(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: operation, confirmed: true, now: now, identities: [])
        XCTAssertTrue(disk.audioFiles(for: note.id).isEmpty)
        XCTAssertEqual(try disk.load().notes, [note])
        let newAudio = try disk.audioDirectory(for: note.id).appendingPathComponent("new.caf")
        try Data([5]).write(to: newAudio)
        _ = try await repository.removeAudio(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: operation, confirmed: true, now: now, identities: [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: newAudio.path))
    }

    func testRecordingAfterAudioRemovalKeepsOriginalSourceTimeline() async throws {
        let (disk, repository, note) = try fixture()
        let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000)!
        buffer.frameLength = 16_000
        memset(buffer.floatChannelData![0], 0, 16_000 * MemoryLayout<Float>.size)
        do {
            let original = try AVAudioFile(forWriting: disk.audioDirectory(for: note.id).appendingPathComponent("001.caf"), settings: format.settings)
            try original.write(from: buffer)
        }
        _ = try await repository.removeAudio(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), confirmed: true, now: now, identities: [])
        XCTAssertEqual(try disk.recordingOffset(for: note.id), 2)
        do {
            let file = try AVAudioFile(forWriting: disk.audioDirectory(for: note.id).appendingPathComponent("new.caf"), settings: format.settings)
            try file.write(from: buffer)
        }
        XCTAssertEqual(try disk.audioTimelineStart(for: note.id), 2)
        XCTAssertEqual(try disk.recordingOffset(for: note.id), 3)
        XCTAssertEqual(try disk.load().notes.first?.passages, note.passages)
    }

    func testAccountTrashDoesNotExpireFromDeviceClockAndOtherAccountCannotReadStorage() async throws {
        let (_, repository, original) = try fixture()
        let identity = LibraryIdentity(accountID: "a", workspaceID: "w")
        let library = try await repository.addLibrary(name: "Work", identity: identity)
        var note = NoteRecord()
        note.metadata?.libraryID = library.id
        note.text = original.text
        try await repository.save(note, identities: [identity])
        _ = try await repository.trash(noteID: note.id, libraryID: library.id,
            expectedGeneration: note.id, operationID: UUID(), now: now, identities: [identity])
        let events = try await repository.processRetention(now: now.addingTimeInterval(365 * 86400), identities: [identity])
        XCTAssertEqual(events.first(where: { $0.noteID == note.id })?.state, .trashed)
        let hidden = try await repository.lifecycleEvents(identities: [])
        XCTAssertFalse(hidden.contains { $0.noteID == note.id })
        do { _ = try await repository.storageUsage(libraryID: library.id, identities: []); XCTFail("Signed-out storage leaked") } catch { }
    }

    func testTrashReplayAndRestoreRejectWrongDeletionIdentity() async throws {
        let (_, repository, note) = try fixture()
        let operation = UUID()
        let state = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: operation, now: now, identities: [])
        let replay = try await repository.trash(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: operation, now: now.addingTimeInterval(100), identities: [])
        XCTAssertEqual(state, replay)
        do {
            _ = try await repository.restore(noteID: note.id, libraryID: LibraryRecord.localID,
                deletionID: UUID(), expectedGeneration: state.generation, operationID: UUID(), now: now, identities: [])
            XCTFail("Wrong deletion accepted")
        } catch { }
    }
}

@MainActor final class TrashLibraryTests: XCTestCase {
    func testActiveCaptureBlocksTrashAndOtherEditsSurviveStorageOperation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let first = try XCTUnwrap(library.create())
        let second = try XCTUnwrap(library.create())
        await library.performStorage(.trash, id: first, captureActive: true)
        XCTAssertNotNil(library.note(first))
        let trash = Task { await library.performStorage(.trash, id: first, captureActive: false) }
        await Task.yield()
        for index in 0..<100 { library.update(second) { $0.text = "Concurrent edit \(index)" } }
        await trash.value
        await library.flush()
        XCTAssertNil(library.note(first))
        XCTAssertEqual(library.trashNotes.map(\.id), [first])
        XCTAssertEqual(library.note(second)?.text, "Concurrent edit 99")
        XCTAssertFalse(library.visibleNotes.contains { $0.id == first })
        XCTAssertEqual(try library.disk?.load().notes.first(where: { $0.id == second })?.text, "Concurrent edit 99")
    }

    func testAudioRecoveryCanFreeSpaceWhileUnrelatedEditCannotSave() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let audioNote = try XCTUnwrap(library.create())
        let other = try XCTUnwrap(library.create())
        await library.flush()
        let disk = try XCTUnwrap(library.disk)
        try Data([1, 2, 3]).write(to: disk.audioDirectory(for: audioNote).appendingPathComponent("local.caf"))
        let file = disk.directory(for: other).appendingPathComponent("note.json")
        let bytes = try Data(contentsOf: file)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        library.update(other) { $0.text = "Unsaved other note" }
        let failed = await library.flush()
        XCTAssertFalse(failed)
        await library.performStorage(.removeAudio, id: audioNote, confirmed: true, captureActive: false)
        XCTAssertTrue(disk.audioFiles(for: audioNote).isEmpty)
        XCTAssertEqual(library.note(other)?.text, "Unsaved other note")
        try FileManager.default.removeItem(at: file)
        try bytes.write(to: file)
        library.retrySaving()
        let retried = await library.flush()
        XCTAssertTrue(retried)
    }

    func testWrongLibraryReceiptCannotExposeLocalNote() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root)
        let note = NoteRecord()
        try disk.save(note)
        var receipt = NoteLifecycle.initial(noteID: note.id, libraryID: UUID())
        receipt.state = .trashed
        try disk.saveLifecycle(receipt)
        let loaded = try disk.load()
        XCTAssertTrue(loaded.notes.isEmpty)
        XCTAssertEqual(loaded.unreadable, [note.id.uuidString])
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        XCTAssertNil(library.note(note.id))
        XCTAssertTrue(library.visibleNotes.isEmpty)
    }

    func testUnreadableLifecycleFailsClosedInsteadOfShowingTrashAsActive() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root)
        let note = NoteRecord()
        try disk.save(note)
        try disk.saveLifecycle(.initial(noteID: note.id, libraryID: LibraryRecord.localID))
        try Data("corrupt lifecycle".utf8).write(to: disk.lifecycleURL(note.id))
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        XCTAssertFalse(library.lifecycleReadable)
        XCTAssertTrue(library.visibleNotes.isEmpty)
        XCTAssertNil(library.note(note.id))
        XCTAssertNotNil(library.problem)
    }
}
