import XCTest
@testable import DoodleNoteNative

final class CloudSyncTests: XCTestCase {
    func testProjectionPreservesLongTranscriptAndDoesNotEncodeLocalInkOrCaptureMetadata() throws {
        let map = CloudIdentityMap(identity: .init(accountID: "one", workspaceID: "work"), remoteLibraryID: UUID())
        var note = NoteRecord()
        note.metadata?.libraryID = map.localLibraryID
        note.ink = Data("PRIVATE_DRAWING_BYTES_NOT_IN_NOTES_JSON".utf8)
        note.passages = (0..<6001).map { index in
            TranscriptPassage(start: Double(index), end: Double(index + 1), text: index == 6000 ? "final sentinel" : "x", isFinal: true)
        }
        let snapshot = try CloudProjection(map: map, remoteNoteID: UUID()).snapshot(note: note, retained: [], inkReferences: [])
        XCTAssertEqual(snapshot["passages"]?.list?.count, 6001)
        XCTAssertEqual(snapshot["passages"]?.list?.last?["text"]?.string, "final sentinel")
        let encoded = String(decoding: try snapshot.data(), as: UTF8.self)
        XCTAssertFalse(encoded.contains("PRIVATE_DRAWING_BYTES"))
        XCTAssertNil(snapshot["captureState"])
        XCTAssertNil(snapshot["audio"])
        XCTAssertNil(snapshot["voiceProfiles"])
    }
    func testSharedWorkspaceUsesSeparateLocalIDsAndRejectsBindingCollisions() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteLibrary = UUID(), remoteNote = UUID()
        let one = CloudIdentityMap(identity: .init(accountID: "one", workspaceID: "shared"), remoteLibraryID: remoteLibrary)
        let two = CloudIdentityMap(identity: .init(accountID: "two", workspaceID: "shared"), remoteLibraryID: remoteLibrary)
        XCTAssertNotEqual(one.localLibraryID, two.localLibraryID)
        XCTAssertNotEqual(one.localNoteID(remoteNote), two.localNoteID(remoteNote))
        let journal = try CloudJournal(root: root, identity: one.identity, libraryID: remoteLibrary)
        let local = try await journal.bind(remoteNoteID: remoteNote)
        XCTAssertEqual(local, one.localNoteID(remoteNote))
        let retry = try await journal.bind(remoteNoteID: remoteNote)
        XCTAssertEqual(retry, local)
        do { _ = try await journal.bind(remoteNoteID: UUID(), localNoteID: local); XCTFail("duplicate local binding") }
        catch {}
        do { _ = try await journal.bind(remoteNoteID: remoteNote, localNoteID: UUID()); XCTFail("rebound remote identity") }
        catch {}
        let reopened = try CloudJournal(root: root, identity: one.identity, libraryID: remoteLibrary)
        let restored = try await reopened.bind(remoteNoteID: remoteNote)
        XCTAssertEqual(restored, local)
    }
    func testJournalRestartsReplayExactOperationAndDoNotAdvanceUnappliedCursor() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let identity = LibraryIdentity(accountID: "one", workspaceID: "work")
        let library = UUID(), note = UUID(), revision = UUID()
        let journal = try CloudJournal(root: root, identity: identity, libraryID: library)
        let operation = CloudOperation(id: UUID(), noteID: note, libraryID: library, kind: .upsert,
            expectedRevision: nil, expectedGeneration: nil, deletionID: nil, localRevisionID: revision,
            snapshot: .object(["text": .string("Synthetic retained text")]))
        try await journal.enqueue(operation)
        let page = try CloudPage(.object(["protocolVersion": .number(2), "cursor": .string("synthetic-bound-cursor"),
            "hasMore": .bool(false), "changes": .array([])]))
        try await journal.stage(page)
        let reopened = try CloudJournal(root: root, identity: identity, libraryID: library)
        let state = try await reopened.load()
        XCTAssertNil(state.cursor)
        XCTAssertEqual(state.pendingPage, page)
        XCTAssertEqual(try state.outbox[0].wire.data(), try operation.wire.data())
        try await reopened.enqueue(operation)
        let retry = try await reopened.load()
        XCTAssertEqual(retry.outbox.count, 1)
        try await reopened.finishPage(expected: page)
        let applied = try await reopened.load()
        XCTAssertEqual(applied.cursor, page.cursor)
        XCTAssertNil(applied.pendingPage)
        let other = try CloudJournal(root: root, identity: .init(accountID: "two", workspaceID: "work"), libraryID: library)
        let isolated = try await other.load()
        XCTAssertTrue(isolated.outbox.isEmpty)
        XCTAssertNil(isolated.cursor)
        let receipt: CloudJSON = .object(["status": .string("conflict"), "noteId": .uuid(note), "revision": .uuid(UUID())])
        try await reopened.acknowledge(operationID: operation.id, receipt: receipt)
        let completed = try await reopened.load()
        XCTAssertTrue(completed.outbox.isEmpty)
        XCTAssertEqual(completed.acknowledgements[operation.id], receipt)
        let changed = CloudOperation(id: operation.id, noteID: note, libraryID: library, kind: .upsert,
            expectedRevision: nil, expectedGeneration: nil, deletionID: nil, localRevisionID: revision,
            snapshot: .object(["text": .string("Changed replay")]))
        do { try await reopened.enqueue(changed); XCTFail("acknowledged operation must remain immutable") } catch {}
        try await reopened.discardPurgedPayload(noteID: note)
        do { try await reopened.enqueue(operation); XCTFail("purged note must not requeue content") } catch {}
        let purged = try await reopened.load()
        XCTAssertTrue(purged.purgedNoteIDs.contains(note))
        XCTAssertTrue(purged.outbox.isEmpty)
    }
    func testSignOutRemainsLockedAcrossRestartWhenKeychainRemovalFails() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let keys = CloudFixtureCredentials()
        let store = try CloudConnectionStore(directory: directory, credentials: keys)
        let account = CloudAccount(accountId: "one", workspaceId: "work", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [])
        let connected = try await store.connect(account: account, secret: CloudSecret("dnid_" + String(repeating: "a", count: 64)))
        let secret = try await store.credential(expectedGeneration: connected.generation)
        XCTAssertTrue(secret.identityOnly)
        keys.failRemoval()
        do { try await store.signOut(); XCTFail("injected removal failure") } catch {}
        let reopened = try CloudConnectionStore(directory: directory, credentials: keys)
        let record = try await reopened.load()
        XCTAssertEqual(record?.authenticated, false)
        do { _ = try await reopened.credential(expectedGeneration: connected.generation); XCTFail("must remain locked") }
        catch {}
        let bytes = try Data(contentsOf: directory.appendingPathComponent("connection.json"))
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("dnid_"))
        let other = CloudAccount(accountId: "two", workspaceId: "work", workspaceName: "Work", entitled: true,
            syncAvailable: true, libraries: [])
        let switched = try await reopened.connect(account: other, secret: CloudSecret("dnsy_" + String(repeating: "b", count: 64)))
        XCTAssertNotEqual(switched.generation, connected.generation)
        XCTAssertNil(switched.selectedLibraryID)
    }
    func testCallbackIsBoundToAttemptAndNeverTrustsDisplayIdentity() throws {
        let attempt = try CloudLinkAttempt()
        let secret = "dnid_" + String(repeating: "a", count: 64)
        func callback(_ state: String) -> URL {
            var components = URLComponents(string: "doodlenote://link")!
            components.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "token", value: secret),
                                    URLQueryItem(name: "email", value: "not-an-identity@example.test")]
            return components.url!
        }
        XCTAssertTrue(try attempt.secret(from: callback(attempt.state)).identityOnly)
        XCTAssertThrowsError(try attempt.secret(from: callback("another-attempt")))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: callback(attempt.state).absoluteString + "&state=duplicate")!))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: callback(attempt.state).absoluteString + "#fragment")!))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: "https://example.test/link")!))
        XCTAssertThrowsError(try CloudSecret("dnsy_short"))
        XCTAssertThrowsError(try CloudHTTP(origin: URL(string: "http://example.test")!))
        XCTAssertThrowsError(try CloudHTTP(origin: URL(string: "https://user@example.test")!))
    }

    func testRemoteAccountCannotClaimLocalLibrary() throws {
        let account = CloudAccount(accountId: "a", workspaceId: "w", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [.init(id: LibraryRecord.localID)])
        XCTAssertThrowsError(try account.validate())
        let valid = CloudAccount(accountId: "a", workspaceId: "w", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [])
        XCTAssertNoThrow(try valid.validate())
        XCTAssertEqual(valid.identity, LibraryIdentity(accountID: "a", workspaceID: "w"))
    }
}

private final class CloudFixtureCredentials: CloudCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: CloudSecret] = [:]
    private var removalFails = false
    func failRemoval() { lock.withLock { removalFails = true } }
    func read(key: String) throws -> CloudSecret? { lock.withLock { values[key] } }
    func write(_ secret: CloudSecret, key: String) throws { lock.withLock { values[key] = secret } }
    func remove(key: String) throws {
        try lock.withLock {
            if removalFails { throw CloudSyncFailure.unavailable }
            values.removeValue(forKey: key)
        }
    }
}
