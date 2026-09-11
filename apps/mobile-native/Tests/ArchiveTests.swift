import XCTest
import AVFoundation
import CryptoKit
import PencilKit
@testable import DoodleNoteNative

final class ArchiveTests: XCTestCase, @unchecked Sendable {
    let password = "Synthetic archive password"
    func directory() throws -> URL {
        let url = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    func fixture(_ disk: NoteDiskStore) throws -> NoteRecord {
        var note = NoteRecord(title: "Synthetic meeting", text: "Keep this text", ink: InkFixture.drawing().dataRepresentation(),
                              passages: [.init(start: 0, end: 2, text: "Synthetic transcript", isFinal: true)])
        try disk.save(note)
        let source = SourceAnchor(libraryID: LibraryRecord.localID, noteID: note.id, revisionID: note.metadata!.revisionID, content: .title)
        let summary = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated, format: "general",
                                     language: .english, text: "Synthetic summary", sources: [source])
        note.metadata?.summaries = [summary]
        note.metadata?.selectedSummaryID = summary.id
        note.metadata?.revisionID = UUID(); note.text = "Edited personal notes"
        try disk.save(note)
        return note
    }
    func testRoundTripPreservesHistoryAudioAndCopiesOnRepeatedRestore() async throws {
        let disk = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        let note = try fixture(disk)
        let audio = try disk.audioDirectory(for: note.id).appendingPathComponent("sample.caf")
        let bytes = Data(repeating: 37, count: EncryptedArchive.blockSize + 71)
        try bytes.write(to: audio)
        try Data("Excluded credential".utf8).write(to: disk.root.appendingPathComponent("credentials.json"))
        try Data("Excluded voice profile".utf8).write(to: disk.root.appendingPathComponent("voices.json"))
        let archive = try directory().appendingPathComponent("roundtrip.doodlenote")
        try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true, password: password, to: archive)
        let encrypted = try Data(contentsOf: archive)
        XCTAssertNil(encrypted.range(of: Data("Edited personal notes".utf8)))
        let repo = LibraryRepository(disk: destination)
        let count = try await repo.restoreArchive(from: archive, password: password)
        XCTAssertEqual(count, 1)
        _ = try await repo.restoreArchive(from: archive, password: password)
        let restored = try destination.load(recoverRecording: false).notes
        XCTAssertEqual(restored.count, 2)
        XCTAssertFalse(restored.contains { $0.id == note.id })
        for copy in restored {
            XCTAssertEqual(copy.text, note.text); XCTAssertEqual(copy.ink, note.ink); XCTAssertEqual(copy.passages, note.passages)
            XCTAssertEqual(copy.metadata?.libraryID, LibraryRecord.localID)
            XCTAssertEqual(copy.metadata?.summaries.first?.sources.first?.noteID, copy.id)
            XCTAssertEqual(try Data(contentsOf: destination.directory(for: copy.id).appendingPathComponent("audio/sample.caf")), bytes)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.directory(for: copy.id).appendingPathComponent("revisions").path).count, 2)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.root.appendingPathComponent("credentials.json").path))
        XCTAssertEqual(try disk.load(recoverRecording: false).notes.first, note)
    }
    func testWrongPasswordTamperTruncationAndTrailingDataNeverPublish() async throws {
        let disk = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        _ = try fixture(disk)
        let url = try directory().appendingPathComponent("good.doodlenote")
        try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true, password: password, to: url)
        let original = try Data(contentsOf: url)
        for mutation in 0..<4 {
            var data = original
            if mutation == 1 { data[data.count - 5] ^= 1 }
            if mutation == 2 { data = Data(data.dropLast()) }
            if mutation == 3 { data.append(0) }
            try data.write(to: url)
            do {
                _ = try await LibraryRepository(disk: destination).restoreArchive(from: url,
                    password: mutation == 0 ? "The wrong password here" : password)
                XCTFail("Must reject altered archive")
            } catch {}
            XCTAssertTrue(try destination.load(recoverRecording: false).notes.isEmpty)
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.root.appendingPathComponent(".archive-staging").path))
        }
    }
    func testPathVersionAndResourceValidation() throws {
        for path in ["../note.json", "audio/../../secret", "/audio/foo.caf", "audio/a\\b.caf", "audio/", "audio/😀.caf", "audio/foo.exe"] {
            XCTAssertFalse(EncryptedArchive.validPath(path), path)
        }
        let disk = try NoteDiskStore(root: directory()), note = try fixture(disk)
        let lifecycle = NoteLifecycle.initial(noteID: note.id, libraryID: LibraryRecord.localID)
        let doc = EncryptedArchive.Document(note: note, revisions: [NoteRevision(note)], lifecycle: lifecycle)
        var manifest = EncryptedArchive.Manifest(documents: [doc], entries: [.init(noteID: note.id, path: "audio/foo.caf", size: EncryptedArchive.totalLimit + 1)])
        XCTAssertThrowsError(try EncryptedArchive.validate(manifest))
        manifest = .init(documents: [doc], entries: [
            .init(noteID: note.id, path: "audio/Foo.caf", size: 0),
            .init(noteID: note.id, path: "audio/foo.caf", size: 0)])
        XCTAssertThrowsError(try EncryptedArchive.validate(manifest))
        manifest = .init(documents: [doc], entries: [])
        manifest.version = 99
        XCTAssertThrowsError(try EncryptedArchive.validate(manifest))
        XCTAssertThrowsError(try EncryptedArchive.derive(password: "short", salt: Data(repeating: 0, count: 16)))
    }
    func testExportRejectsSymlinkAncestorsAndOversizeHistoryBeforeReading() async throws {
        for component in ["audio", "revisions", "note"] {
            let disk = try NoteDiskStore(root: directory()), note = try fixture(disk)
            _ = try disk.audioDirectory(for: note.id)
            let target = component == "note" ? disk.directory(for: note.id) : disk.directory(for: note.id).appendingPathComponent(component)
            let outside = try directory().appendingPathComponent("outside")
            try FileManager.default.moveItem(at: target, to: outside)
            try FileManager.default.createSymbolicLink(at: target, withDestinationURL: outside)
            let output = try directory().appendingPathComponent("rejected.doodlenote")
            do {
                try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true, password: password, to: output)
                XCTFail("Must reject symlink ancestor")
            } catch {}
            XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
        }
        let disk = try NoteDiskStore(root: directory()), note = try fixture(disk)
        let huge = disk.directory(for: note.id).appendingPathComponent("revisions/" + UUID().uuidString + ".json")
        FileManager.default.createFile(atPath: huge.path, contents: nil)
        let handle = try FileHandle(forWritingTo: huge)
        try handle.truncate(atOffset: UInt64(EncryptedArchive.manifestLimit + 1)); try handle.close()
        do {
            try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true,
                password: password, to: directory().appendingPathComponent("too-big.doodlenote"))
            XCTFail("Must reject huge history before JSON allocation")
        } catch EncryptedArchive.Failure.limits {} catch { XCTFail("Expected bound failure: \(error)") }
    }
    func testAuthenticatedMaliciousManifestIsRejectedBeforeStaging() async throws {
        let source = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        let note = try fixture(source)
        let doc = EncryptedArchive.Document(note: note, revisions: [NoteRevision(note)],
            lifecycle: .initial(noteID: note.id, libraryID: LibraryRecord.localID))
        for path in ["../escape.caf", "audio/nested/escape.caf"] {
            let manifest = EncryptedArchive.Manifest(documents: [doc], entries: [.init(noteID: note.id, path: path, size: 0)])
            let url = try directory().appendingPathComponent("malicious.doodlenote")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            let handle = try FileHandle(forWritingTo: url)
            let salt = Data(repeating: 1, count: 16), header = EncryptedArchive.magic + salt
            let key = try EncryptedArchive.derive(password: password, salt: salt)
            try handle.write(contentsOf: header)
            try EncryptedArchive.seal(JSONEncoder().encode(manifest), handle: handle, key: key, header: header, index: 0)
            try EncryptedArchive.seal(Data("END".utf8), handle: handle, key: key, header: header, index: 1)
            try handle.close()
            do {
                _ = try await LibraryRepository(disk: destination).restoreArchive(from: url, password: password)
                XCTFail("Authenticated traversal must still fail")
            } catch {}
            XCTAssertTrue(try destination.load(recoverRecording: false).notes.isEmpty)
        }
    }
    func testInterruptedCommitRollsBackAndStartupRecovers() async throws {
        let disk = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        _ = try fixture(disk); let existing = try fixture(destination)
        let url = try directory().appendingPathComponent("restore.doodlenote")
        try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true, password: password, to: url)
        do {
            _ = try await LibraryRepository(disk: destination).restoreArchive(from: url, password: password,
                beforePublish: { throw CancellationError() })
            XCTFail("Injected cancellation must throw")
        } catch {}
        XCTAssertEqual(try destination.load(recoverRecording: false).notes, [existing])
        let orphan = NoteRecord(title: "Unpublished")
        try destination.save(orphan)
        try destination.write(ArchiveRestoreJournal(noteIDs: [orphan.id], published: false), to: destination.archiveJournalURL)
        XCTAssertEqual(try destination.load(recoverRecording: false).notes, [existing])
        let reopened = try NoteDiskStore(root: destination.root)
        XCTAssertEqual(try reopened.load(recoverRecording: false).notes, [existing])
    }
    func testTrashOptInAndLocalOnlyAccountRestore() async throws {
        let disk = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        let repo = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "test-account", workspaceID: "test-workspace")
        let library = try await repo.addLibrary(name: "Synthetic cloud", identity: identity)
        var note = NoteRecord(title: "Cloud note"); note.metadata?.libraryID = library.id
        try await repo.save(note, identities: [identity])
        var lifecycle = NoteLifecycle.initial(noteID: note.id, libraryID: library.id)
        lifecycle.state = .trashed; lifecycle.deletionID = UUID(); lifecycle.deletedAt = Date(); lifecycle.expiresAt = .distantPast
        try disk.saveLifecycle(lifecycle)
        for trash in [false, true] {
            let url = try directory().appendingPathComponent("trash.doodlenote")
            try await repo.exportArchive(libraryID: library.id, identities: [identity], includeTrash: trash, password: password, to: url)
            let count = try await LibraryRepository(disk: destination).restoreArchive(from: url, password: password)
            XCTAssertEqual(count, trash ? 1 : 0)
        }
        let copy = try XCTUnwrap(destination.load(recoverRecording: false).notes.first)
        let state = try destination.lifecycle(noteID: copy.id, libraryID: LibraryRecord.localID)
        XCTAssertEqual(state.state, .trashed); XCTAssertEqual(state.clock, .device)
        XCTAssertGreaterThan(try XCTUnwrap(state.expiresAt), Date())
        let catalog = try await LibraryRepository(disk: destination).catalog()
        XCTAssertEqual(catalog.libraries, [.local])
    }
    func testCompleteTwoHourSyntheticAudioRoundTrip() async throws {
        let disk = try NoteDiskStore(root: directory()), destination = try NoteDiskStore(root: directory())
        let note = try fixture(disk)
        let audio = try disk.audioDirectory(for: note.id).appendingPathComponent("two-hours.caf")
        let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 80_000)); buffer.frameLength = 80_000
        buffer.int16ChannelData![0].initialize(repeating: 19, count: 80_000)
        do {
            let file = try AVAudioFile(forWriting: audio, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
            for _ in 0..<1440 { try file.write(from: buffer) }
        }
        let url = try directory().appendingPathComponent("two-hours.doodlenote")
        try await LibraryRepository(disk: disk).exportArchive(libraryID: LibraryRecord.localID, identities: [], includeTrash: true, password: password, to: url)
        _ = try await LibraryRepository(disk: destination).restoreArchive(from: url, password: password)
        let copy = try XCTUnwrap(destination.load(recoverRecording: false).notes.first)
        let restored = destination.directory(for: copy.id).appendingPathComponent("audio/two-hours.caf")
        XCTAssertEqual(try AVAudioFile(forReading: restored).length, 115_200_000)
        XCTAssertEqual(SHA256.hash(data: try Data(contentsOf: audio, options: .mappedIfSafe)), SHA256.hash(data: try Data(contentsOf: restored, options: .mappedIfSafe)))
        XCTAssertEqual(copy.ink, note.ink)
        XCTAssertEqual(try PKDrawing(data: copy.ink).strokes.count, 3)
    }
}
