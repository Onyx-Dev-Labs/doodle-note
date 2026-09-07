import XCTest
@testable import DoodleNoteNative

final class LibraryContractTests: XCTestCase {
    func store() throws -> NoteDiskStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return try NoteDiskStore(root: root)
    }

    func legacy(_ disk: NoteDiskStore) throws -> (NoteRecord, Data) {
        var note = NoteRecord()
        note.schemaVersion = 1
        note.metadata = nil
        note.text = "Original personal notes\nSecond paragraph"
        note.ink = Data(repeating: 7, count: 1024)
        note.passages = [TranscriptPassage(start: 1, end: 3, text: "Bonjour", isFinal: true, speakerName: "Taylor")]
        try disk.save(note)
        let audio = try disk.audioDirectory(for: note.id).appendingPathComponent("0001.caf")
        try Data([4, 5, 6]).write(to: audio)
        return (note, try Data(contentsOf: disk.directory(for: note.id).appendingPathComponent("note.json")))
    }

    func testMigrationRetainsOriginalContentAudioAndRollbackBytes() throws {
        let disk = try store()
        let (old, bytes) = try legacy(disk)
        let result = try disk.load()
        let note = try XCTUnwrap(result.notes.first)
        XCTAssertEqual(note.schemaVersion, 2)
        XCTAssertEqual(note.metadata?.libraryID, LibraryRecord.localID)
        XCTAssertEqual(note.text, old.text)
        XCTAssertEqual(note.ink, old.ink)
        XCTAssertEqual(note.passages, old.passages)
        XCTAssertEqual(note.createdAt, old.createdAt)
        XCTAssertEqual(note.updatedAt, old.updatedAt)
        let dir = disk.directory(for: note.id)
        XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("note.schema1.original.json")), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("migration-1-to-2.json").path))
        XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("audio/0001.caf")), Data([4, 5, 6]))
        XCTAssertEqual(try disk.load().notes, [note])
    }

    func testInterruptedMigrationIsRestartableAndMismatchedIdentityUntouched() throws {
        let disk = try store()
        let (old, bytes) = try legacy(disk)
        let dir = disk.directory(for: old.id)
        XCTAssertThrowsError(try disk.migrate(old, data: bytes, directory: dir, beforeCommit: { throw CocoaError(.fileWriteOutOfSpace) }))
        XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("note.json")), bytes)
        XCTAssertEqual(try disk.load().notes.first?.metadata?.revisionID, old.id)
        let other = disk.directory(for: UUID())
        try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)
        try bytes.write(to: other.appendingPathComponent("note.json"))
        let result = try disk.load()
        XCTAssertTrue(result.unreadable.contains(other.lastPathComponent))
        XCTAssertEqual(try Data(contentsOf: other.appendingPathComponent("note.json")), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: other.appendingPathComponent("note.schema1.original.json").path))
    }

    func testMigrationWriteFailureKeepsReadableLegacyNoteAndOriginalBytes() throws {
        let disk = try store()
        let (old, bytes) = try legacy(disk)
        let result = try disk.load(beforeMigrationCommit: { throw CocoaError(.fileWriteOutOfSpace) })
        XCTAssertEqual(result.notes.first?.text, old.text)
        XCTAssertEqual(result.notes.first?.ink, old.ink)
        XCTAssertEqual(result.notes.first?.schemaVersion, 1)
        XCTAssertEqual(result.migrationProblems, [old.id.uuidString])
        XCTAssertTrue(result.unreadable.isEmpty)
        XCTAssertEqual(try Data(contentsOf: disk.directory(for: old.id).appendingPathComponent("note.json")), bytes)
        XCTAssertEqual(try disk.load().notes.first?.schemaVersion, 2)
    }

    func testNormalSaveCannotBypassMigrationOrOverwriteMalformedMetadata() throws {
        let disk = try store()
        let (legacyNote, bytes) = try legacy(disk)
        var replacement = legacyNote
        replacement.schemaVersion = 2
        replacement.metadata = NoteMetadata()
        XCTAssertThrowsError(try disk.save(replacement))
        let file = disk.directory(for: legacyNote.id).appendingPathComponent("note.json")
        XCTAssertEqual(try Data(contentsOf: file), bytes)
        replacement.metadata = nil
        let invalidBytes = try JSONEncoder().encode(replacement)
        try invalidBytes.write(to: file)
        replacement.metadata = NoteMetadata()
        XCTAssertThrowsError(try disk.save(replacement))
        XCTAssertEqual(try Data(contentsOf: file), invalidBytes)
    }

    func testAnchorsSurviveLaterEditsAndRejectAnotherLibrary() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        var note = NoteRecord()
        note.text = "First paragraph\nOriginal second"
        note.passages = [TranscriptPassage(start: 1, end: 2, text: "Transcript original", isFinal: true)]
        try await repository.save(note, identities: [])
        let anchor = SourceAnchor(libraryID: LibraryRecord.localID, noteID: note.id,
            revisionID: note.metadata!.revisionID, content: .personalParagraph(1))
        let transcript = SourceAnchor(libraryID: LibraryRecord.localID, noteID: note.id,
            revisionID: note.metadata!.revisionID, content: .transcript(note.passages[0].id))
        note.text = "Everything replaced"
        note.passages = []
        note.metadata?.revisionID = UUID()
        try await repository.save(note, identities: [])
        let resolved = try await repository.resolve(anchor, identities: [])
        let speech = try await repository.resolve(transcript, identities: [])
        XCTAssertEqual(resolved, "Original second")
        XCTAssertEqual(speech, "Transcript original")
        let forged = SourceAnchor(libraryID: UUID(), noteID: note.id, revisionID: anchor.revisionID, content: anchor.content)
        do { _ = try await repository.resolve(forged, identities: []); XCTFail("Cross-library anchor accepted") }
        catch { }
    }

    func testOwnershipFoldersAndLocalLibraryAreExplicit() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "account-a", workspaceID: "workspace-a")
        let account = try await repository.addLibrary(name: "Work", identity: identity)
        var local = NoteRecord()
        try await repository.save(local, identities: [identity])
        let folder = try await repository.addFolder(name: "Work folder", libraryID: account.id, identities: [identity])
        local.metadata?.folderID = folder.id
        do { try await repository.save(local, identities: [identity]); XCTFail("Cross-library folder accepted") } catch { }
        local.metadata?.folderID = nil
        local.metadata?.libraryID = account.id
        do { try await repository.save(local, identities: [identity]); XCTFail("Implicit adoption accepted") } catch { }
        let catalog = try await LibraryRepository(disk: disk).catalog()
        XCTAssertEqual(catalog.libraries.first, .local)
        do { try await repository.authorize(account.id, identities: []); XCTFail("Signed-out account accessible") } catch { }
    }

    func testSummaryCommitPreservesConcurrentPersonalEditsAndReplaysOnce() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        var note = NoteRecord()
        note.text = "Original"
        let prior = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated,
            format: "meeting", language: .english, text: "Earlier generated", sources: [])
        let edited = SummaryVersion(id: UUID(), parentID: prior.id, createdAt: Date(), origin: .edited,
            format: "meeting", language: .english, text: "User edited summary", sources: [])
        note.metadata?.summaries = [prior, edited]
        note.metadata?.selectedSummaryID = edited.id
        try await repository.save(note, identities: [])
        let job = try await repository.beginJob(libraryID: LibraryRecord.localID, kind: .summary, key: "generate-once", noteID: note.id, identities: [])
        var output = note
        let version = SummaryVersion(id: job.versionID, parentID: nil, createdAt: Date(), origin: .generated,
            format: "meeting", language: .english, text: "Generated", sources: [])
        output.metadata?.summaries.append(version)
        note.text = "Personal edit made during generation"
        note.title = "Edited title"
        note.ink = Data([9, 8, 7])
        note.metadata?.revisionID = UUID()
        try await repository.save(note, identities: [])
        do {
            _ = try await repository.commit(output, for: job.id, identities: [], afterOutput: { throw CocoaError(.fileWriteOutOfSpace) })
            XCTFail("Expected simulated crash")
        } catch { }
        let restarted = LibraryRepository(disk: disk)
        let replayJob = try await restarted.beginJob(libraryID: LibraryRecord.localID, kind: .summary, key: "generate-once", noteID: note.id, identities: [])
        XCTAssertEqual(replayJob.id, job.id)
        let replay = try await restarted.commit(output, for: job.id, identities: [])
        XCTAssertEqual(replay.text, note.text)
        XCTAssertEqual(replay.ink, note.ink)
        XCTAssertEqual(replay.title, note.title)
        XCTAssertEqual(replay.metadata?.summaries, [prior, edited, version])
        XCTAssertEqual(replay.metadata?.selectedSummaryID, edited.id)
        let catalog = try await restarted.catalog()
        XCTAssertEqual(catalog.jobs.first?.state, .completed)
    }

    func testImportReplayRetainsReservedIdentityAndDoesNotOverwriteUserEdit() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        let job = try await repository.beginJob(libraryID: LibraryRecord.localID, kind: .audioImport, key: "file-hash", identities: [])
        var output = NoteRecord(id: job.noteID)
        output.text = "Imported"
        _ = try await repository.commit(output, for: job.id, identities: [])
        var edited = output
        edited.text = "Edited after import"
        edited.metadata?.revisionID = UUID()
        try await repository.save(edited, identities: [])
        let replay = try await LibraryRepository(disk: disk).commit(output, for: job.id, identities: [])
        XCTAssertEqual(replay.text, edited.text)
        XCTAssertEqual(try disk.load().notes.count, 1)
    }

    func testJobCannotCompleteBeforeOutputAndCancellationIsDurable() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        let job = try await repository.beginJob(libraryID: LibraryRecord.localID, kind: .audioImport, key: "input", identities: [])
        do {
            _ = try await repository.transitionJob(job.id, to: .completed, identities: [])
            XCTFail("Completed without durable output")
        } catch { }
        _ = try await repository.transitionJob(job.id, to: .running, identities: [])
        _ = try await repository.transitionJob(job.id, to: .retryable, error: "Interrupted", identities: [])
        let retry = try await LibraryRepository(disk: disk).beginJob(libraryID: LibraryRecord.localID, kind: .audioImport, key: "input", identities: [])
        XCTAssertEqual(retry.state, .retryable)
        XCTAssertEqual(retry.attempts, 1)
        _ = try await repository.transitionJob(job.id, to: .cancelled, identities: [])
        do {
            _ = try await repository.commit(NoteRecord(id: job.noteID), for: job.id, identities: [])
            XCTFail("Cancelled job committed")
        } catch { }
    }

    func testEventOccurrenceIdentityIncludesAccountCalendarAndLibrary() async throws {
        let disk = try store()
        let repository = LibraryRepository(disk: disk)
        let event = EventOccurrenceKey(provider: "google", accountID: "a", calendarID: "c", eventID: "e", occurrenceID: "original-instance")
        let job = try await repository.beginEventNote(libraryID: LibraryRecord.localID, event: event, identities: [])
        let replay = try await repository.beginEventNote(libraryID: LibraryRecord.localID, event: event, identities: [])
        XCTAssertEqual(job.noteID, replay.noteID)
        let other = EventOccurrenceKey(provider: "google", accountID: "b", calendarID: "c", eventID: "e", occurrenceID: "original-instance")
        let separate = try await repository.beginEventNote(libraryID: LibraryRecord.localID, event: other, identities: [])
        XCTAssertNotEqual(job.noteID, separate.noteID)
    }

    func testEditedSummaryRetainsOriginalAndRejectsInvalidSelection() throws {
        let disk = try store()
        var note = NoteRecord()
        let original = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated,
            format: "meeting", language: .english, text: "Original summary", sources: [])
        note.metadata?.summaries = [original]
        try disk.save(note)
        let edited = SummaryVersion(id: UUID(), parentID: original.id, createdAt: Date(), origin: .edited,
            format: "meeting", language: .english, text: "Edited summary", sources: [])
        note.metadata?.summaries.append(edited)
        note.metadata?.selectedSummaryID = edited.id
        try disk.save(note)
        XCTAssertEqual(try disk.load().notes.first?.metadata?.summaries, [original, edited])
        note.metadata?.selectedSummaryID = UUID()
        XCTAssertThrowsError(try disk.save(note))
    }

    func testRetainedSummaryCannotBeChangedOrDuplicatedAndDowngradeRejected() throws {
        let disk = try store()
        var note = NoteRecord()
        let version = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated,
            format: "meeting", language: .english, text: "Original", sources: [])
        note.metadata?.summaries = [version]
        try disk.save(note)
        note.metadata?.summaries = []
        XCTAssertThrowsError(try disk.save(note))
        note.metadata?.summaries = [version, version]
        XCTAssertThrowsError(try disk.save(note))
        note.schemaVersion = 1
        XCTAssertThrowsError(try disk.save(note))
    }
}

@MainActor final class LibraryEditingTests: XCTestCase {
    func testLargeRapidEditsCoalesceAndPersistLatestContent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let ink = Data(repeating: 5, count: 10 * 1024 * 1024)
        for index in 0..<200 {
            library.update(id) { $0.text = "Latest edit \(index)"; $0.ink = ink }
        }
        XCTAssertLessThanOrEqual(library.pendingSaves, 2)
        let saved = await library.flush()
        XCTAssertTrue(saved)
        XCTAssertLessThanOrEqual(library.completedWrites, 2)
        let reopened = NoteLibrary(root: root)
        await reopened.waitUntilLoaded()
        XCTAssertEqual(reopened.note(id)?.text, "Latest edit 199")
        XCTAssertEqual(reopened.note(id)?.ink, ink)
    }

    func testFailedLatestSaveRemainsUnsavedUntilRetrySucceeds() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let first = await library.flush()
        XCTAssertTrue(first)
        let dir = try XCTUnwrap(library.disk).directory(for: id)
        let saved = dir.appendingPathComponent("note.json")
        let bytes = try Data(contentsOf: saved)
        try FileManager.default.removeItem(at: saved)
        try FileManager.default.createDirectory(at: saved, withIntermediateDirectories: false)
        library.update(id) { $0.text = "Latest must not disappear" }
        let failed = await library.flush()
        XCTAssertFalse(failed)
        XCTAssertNotNil(library.saveProblem)
        XCTAssertEqual(library.note(id)?.text, "Latest must not disappear")
        try FileManager.default.removeItem(at: saved)
        try bytes.write(to: saved)
        library.retrySaving()
        let retried = await library.flush()
        XCTAssertTrue(retried)
        XCTAssertNil(library.saveProblem)
        XCTAssertEqual(try library.disk?.load().notes.first?.text, "Latest must not disappear")
    }

    func testFolderMoveAndSignOutKeepLocalNotesIndependent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let localID = try XCTUnwrap(library.create())
        await library.addFolder("Discovery")
        let folder = try XCTUnwrap(library.folders.first)
        library.update(localID) { $0.metadata?.folderID = folder.id }
        let identity = LibraryIdentity(accountID: "account-a", workspaceID: "workspace-a")
        try await library.authenticate(identity, name: "Work")
        let account = try XCTUnwrap(library.libraries.first { $0.identity == identity })
        library.selectLibrary(account.id)
        XCTAssertTrue(library.visibleNotes.isEmpty)
        let accountNote = try XCTUnwrap(library.create())
        let generation = library.authenticationGeneration
        XCTAssertEqual(library.authorizedNotes(in: account.id).map(\.id), [accountNote])
        let refused = await library.signOut(identity, captureActive: true)
        XCTAssertFalse(refused)
        XCTAssertEqual(library.authenticationGeneration, generation)
        let signedOut = await library.signOut(identity, captureActive: false)
        XCTAssertTrue(signedOut)
        XCTAssertNotEqual(library.authenticationGeneration, generation)
        XCTAssertTrue(library.authorizedNotes(in: account.id).isEmpty)
        XCTAssertEqual(library.authorizedNotes(in: LibraryRecord.localID).map(\.id), [localID])
        XCTAssertNil(library.note(accountNote))
        XCTAssertEqual(library.note(localID)?.metadata?.folderID, folder.id)
        XCTAssertEqual(library.note(localID)?.metadata?.libraryID, LibraryRecord.localID)
        try await library.authenticate(identity, name: "Work")
        XCTAssertNotNil(library.note(accountNote))
        XCTAssertNotEqual(library.authenticationGeneration, generation)
        XCTAssertEqual(library.authorizedNotes(in: account.id).map(\.id), [accountNote])
    }
}
