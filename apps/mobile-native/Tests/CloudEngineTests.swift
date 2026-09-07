import XCTest
@testable import DoodleNoteNative

final class CloudEngineTests: XCTestCase {
    @MainActor func testCloudRefreshCannotReplaceEditSavedWhileDiskReadWasInFlight() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        _ = await library.flush()
        let stale = library.notes
        try await library.refreshAfterCloud {
            XCTAssertTrue(library.update(id) { $0.text = "Newer completed local write" })
            let saved = await library.flush()
            XCTAssertTrue(saved)
            return stale
        }
        XCTAssertEqual(library.note(id)?.text, "Newer completed local write")
    }

    @MainActor func testCloudRefreshCannotReinsertPurgedPayloadFromStaleRead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        _ = await library.flush()
        let stale = library.notes
        try await library.refreshAfterCloud {
            await library.performStorage(.trash, id: id, captureActive: false)
            await library.performStorage(.purge, id: id, confirmed: true, captureActive: false)
            XCTAssertFalse(library.notes.contains { $0.id == id })
            return stale
        }
        XCTAssertFalse(library.notes.contains { $0.id == id })
    }

    func testPullImportsRestartablyAndAnotherAccountCannotResolveItsSource() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root.appendingPathComponent("notes"))
        let repository = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "one", workspaceID: "shared")
        let remoteLibrary = UUID(), remoteNote = UUID(), head = UUID(), generation = UUID()
        let map = CloudIdentityMap(identity: identity, remoteLibraryID: remoteLibrary)
        _ = try await repository.attachLibrary(id: map.localLibraryID, name: "Shared", identity: identity)
        var source = NoteRecord()
        source.metadata?.libraryID = map.localLibraryID
        source.text = "Synthetic text kept across restart"
        source.captureState = .interrupted
        source.passages = [.init(start: 0, end: 1, text: "Partial phrase", isFinal: false)]
        let snapshot = try CloudProjection(map: map, remoteNoteID: remoteNote).snapshot(note: source, retained: [], inkReferences: [])
        let change: CloudJSON = .object(["id": .uuid(head), "note_id": .uuid(remoteNote), "parent_id": .null,
            "kind": .string("upsert"), "created_at": .string("2026-09-07T10:00:00.000Z"), "snapshot": snapshot,
            "head_revision": .uuid(head), "lifecycle_generation": .uuid(generation), "state": .string("active"),
            "deletion_id": .null, "deleted_at": .null, "expires_at": .null])
        let keys = EngineTestCredentials()
        let connections = try CloudConnectionStore(directory: root.appendingPathComponent("account"), credentials: keys)
        let linked = try await connections.connect(account: .init(accountId: "one", workspaceId: "shared", workspaceName: "Shared",
            entitled: true, syncAvailable: true, libraries: [.init(id: remoteLibrary)]),
            secret: CloudSecret("dnsy_" + String(repeating: "a", count: 64)))
        let connection = try await connections.select(libraryID: remoteLibrary, expectedGeneration: linked.generation)
        let transport = EngineTestTransport(changes: [change])
        let syncRoot = root.appendingPathComponent("sync")
        let engine = try CloudSyncEngine(connection: connection, connections: connections, repository: repository, transport: transport, root: syncRoot)
        let result = try await engine.synchronize()
        XCTAssertEqual(result.downloaded, 1)
        let localID = map.localNoteID(remoteNote)
        let imported = try await repository.cloudNote(noteID: localID, libraryID: map.localLibraryID, identity: identity)
        XCTAssertEqual(imported?.text, source.text)
        XCTAssertEqual(imported?.metadata?.cloudTranscriptStatus, .interrupted)
        XCTAssertEqual(imported?.passages.first?.isFinal, false)
        XCTAssertTrue(disk.audioFiles(for: localID).isEmpty)
        let other = LibraryIdentity(accountID: "two", workspaceID: "shared")
        do {
            _ = try await repository.cloudNote(noteID: localID, libraryID: map.localLibraryID, identity: other)
            XCTFail("other account must not open cached content")
        } catch {}
        let restarted = try CloudSyncEngine(connection: connection, connections: connections, repository: repository, transport: transport, root: syncRoot)
        _ = try await restarted.synchronize()
        let posts = await transport.posts
        XCTAssertEqual(posts, 0, "unchanged imported source must not echo an upsert")
        try await connections.signOut()
        do { _ = try await restarted.synchronize(); XCTFail("stale authenticated engine") } catch {}
    }
    func testLostPushReplyReplaysExactDurableOperationAfterEngineRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root.appendingPathComponent("notes"))
        let repository = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "one", workspaceID: "work"), remoteLibrary = UUID()
        let map = CloudIdentityMap(identity: identity, remoteLibraryID: remoteLibrary)
        _ = try await repository.attachLibrary(id: map.localLibraryID, name: "Work", identity: identity)
        var note = NoteRecord()
        note.metadata?.libraryID = map.localLibraryID
        note.text = "Offline edit survives lost HTTP reply"
        try await repository.save(note, identities: [identity])
        let connections = try CloudConnectionStore(directory: root.appendingPathComponent("account"), credentials: EngineTestCredentials())
        let linked = try await connections.connect(account: .init(accountId: "one", workspaceId: "work", workspaceName: "Work",
            entitled: true, syncAvailable: true, libraries: [.init(id: remoteLibrary)]), secret: CloudSecret("dnsy_" + String(repeating: "a", count: 64)))
        let connection = try await connections.select(libraryID: remoteLibrary, expectedGeneration: linked.generation)
        let transport = LostReplyTransport()
        let syncRoot = root.appendingPathComponent("sync")
        let first = try CloudSyncEngine(connection: connection, connections: connections, repository: repository, transport: transport, root: syncRoot)
        do { _ = try await first.synchronize(); XCTFail("fixture drops first committed response") } catch {}
        let pending = try await first.journal.load()
        XCTAssertEqual(pending.outbox.count, 1)
        let second = try CloudSyncEngine(connection: connection, connections: connections, repository: repository, transport: transport, root: syncRoot)
        _ = try await second.synchronize()
        let bodies = await transport.pushBodies
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual(bodies.first, bodies.last)
        let finished = try await second.journal.load()
        XCTAssertTrue(finished.outbox.isEmpty)
        let local = try await repository.cloudNote(noteID: note.id, libraryID: map.localLibraryID, identity: identity)
        XCTAssertEqual(local?.text, note.text)
    }

    func testLocalPurgeAfterLostFirstUploadReplyRedactsCachesThenPurgesServerCopy() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root)
        let repository = LibraryRepository(disk: disk)
        let identity = LibraryIdentity(accountID: "one", workspaceID: "work"), remoteLibrary = UUID()
        let map = CloudIdentityMap(identity: identity, remoteLibraryID: remoteLibrary)
        _ = try await repository.attachLibrary(id: map.localLibraryID, name: "Work", identity: identity)
        var note = NoteRecord()
        note.metadata?.libraryID = map.localLibraryID
        note.text = "Synthetic deleted payload"
        try await repository.save(note, identities: [identity])
        let connections = try CloudConnectionStore(directory: root.appendingPathComponent("account"), credentials: EngineTestCredentials())
        let linked = try await connections.connect(account: .init(accountId: "one", workspaceId: "work", workspaceName: "Work",
            entitled: true, syncAvailable: true, libraries: [.init(id: remoteLibrary)]), secret: CloudSecret("dnsy_" + String(repeating: "a", count: 64)))
        let connection = try await connections.select(libraryID: remoteLibrary, expectedGeneration: linked.generation)
        let transport = PurgeAfterLostReplyTransport()
        let engine = try CloudSyncEngine(connection: connection, connections: connections, repository: repository,
            transport: transport, root: root.appendingPathComponent("cloud/libraries"))
        do { _ = try await engine.synchronize(); XCTFail("first response is lost") } catch {}
        let queued = try await engine.journal.load()
        let remote = try XCTUnwrap(queued.noteBindings.first(where: { $0.value == note.id })?.key)
        XCTAssertEqual(queued.outbox.count, 1)
        let trash = try await repository.trash(noteID: note.id, libraryID: map.localLibraryID,
            expectedGeneration: note.id, operationID: UUID(), now: Date(), identities: [identity])
        _ = try await repository.permanentlyDelete(noteID: note.id, libraryID: map.localLibraryID,
            expectedGeneration: trash.generation, operationID: UUID(), confirmed: true, identities: [identity])
        let redacted = try await engine.journal.load()
        XCTAssertTrue(redacted.outbox.isEmpty)
        XCTAssertEqual(redacted.noteBindings[remote], note.id)
        let journalBytes = try Data(contentsOf: engine.journal.directory.appendingPathComponent("journal.json"))
        XCTAssertFalse(String(decoding: journalBytes, as: UTF8.self).contains("Synthetic deleted payload"))
        _ = try await engine.synchronize() // learns accepted server identity without caching deleted snapshot
        let noContent = try await engine.replica.content(remote)
        XCTAssertNil(noContent)
        _ = try await engine.synchronize() // sends Trash, preserving permanent local deletion
        _ = try await engine.synchronize() // sends purge
        let kinds = await transport.kinds
        XCTAssertEqual(kinds, ["upsert", "trash", "purge"])
        let final = try await engine.journal.load()
        XCTAssertTrue(final.purgedNoteIDs.contains(remote))
        XCTAssertTrue(final.outbox.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: disk.directory(for: note.id).path))
    }

}

private final class EngineTestCredentials: CloudCredentialStore, @unchecked Sendable {
    let lock = NSLock()
    var values: [String: CloudSecret] = [:]
    func read(key: String) throws -> CloudSecret? { lock.withLock { values[key] } }
    func write(_ secret: CloudSecret, key: String) throws { lock.withLock { values[key] = secret } }
    func remove(key: String) throws { _ = lock.withLock { values.removeValue(forKey: key) } }
}
private actor EngineTestTransport: CloudTransport {
    let changes: [CloudJSON]
    var posts = 0
    init(changes: [CloudJSON]) { self.changes = changes }
    func request(path: String, method: String, query: [URLQueryItem], body: Data?, contentType: String,
                 secret: CloudSecret, maxBytes: Int) async throws -> Data {
        guard path == "api/sync/v2", method == "GET" else { posts += 1; throw CloudSyncFailure.invalidResponse }
        let first = !query.contains { $0.name == "cursor" }
        return try CloudJSON.object(["protocolVersion": .number(2), "cursor": .string("fixture-cursor"),
            "hasMore": .bool(false), "changes": .array(first ? changes : [])]).data()
    }
}

private actor LostReplyTransport: CloudTransport {
    var pushBodies: [Data] = []
    var operation: CloudJSON?
    let head = UUID(), generation = UUID()
    func request(path: String, method: String, query: [URLQueryItem], body: Data?, contentType: String,
                 secret: CloudSecret, maxBytes: Int) async throws -> Data {
        guard path == "api/sync/v2" else { throw CloudSyncFailure.invalidResponse }
        if method == "POST" {
            let body = try XCTUnwrap(body)
            pushBodies.append(body)
            let value = try JSONDecoder().decode(CloudJSON.self, from: body)
            operation = value["operations"]?.list?.first
            if pushBodies.count == 1 { throw CloudSyncFailure.unavailable }
            guard body == pushBodies[0], let operation else { throw CloudSyncFailure.changed }
            return try CloudJSON.object(["protocolVersion": .number(2), "results": .array([.object([
                "index": .number(0), "receipt": .object(["status": .string("ok"), "noteId": operation["noteId"]!,
                "revision": .uuid(head), "headRevision": .uuid(head), "lifecycleGeneration": .uuid(generation), "state": .string("active")])])])]).data()
        }
        guard let operation else { throw CloudSyncFailure.invalidResponse }
        let change: CloudJSON = .object(["id": .uuid(head), "note_id": operation["noteId"]!, "parent_id": .null,
            "kind": .string("upsert"), "created_at": .string("2026-09-07T10:00:00.000Z"), "snapshot": operation["snapshot"]!,
            "head_revision": .uuid(head), "lifecycle_generation": .uuid(generation), "state": .string("active"),
            "deletion_id": .null, "deleted_at": .null, "expires_at": .null])
        return try CloudJSON.object(["protocolVersion": .number(2), "cursor": .string("after-commit"), "hasMore": .bool(false), "changes": .array([change])]).data()
    }
}

private actor PurgeAfterLostReplyTransport: CloudTransport {
    var kinds: [String] = []
    var change: CloudJSON?
    var head: UUID?
    var generation = UUID()
    var state = "active"
    var deletionID: CloudJSON = .null
    func request(path: String, method: String, query: [URLQueryItem], body: Data?, contentType: String,
                 secret: CloudSecret, maxBytes: Int) async throws -> Data {
        guard path == "api/sync/v2" else { throw CloudSyncFailure.invalidResponse }
        if method == "POST" {
            let value = try JSONDecoder().decode(CloudJSON.self, from: XCTUnwrap(body))
            let operation = try XCTUnwrap(value["operations"]?.list?.first)
            let kind = try operation.requiredString("kind")
            if let head { XCTAssertEqual(operation["expectedRevision"], .uuid(head)) }
            kinds.append(kind)
            if kind == "trash" { state = "trashed"; deletionID = operation["deletionId"] ?? .null }
            if kind == "purge" { XCTAssertEqual(state, "trashed"); state = "purged" }
            let parent = head
            head = UUID()
            generation = UUID()
            change = .object(["id": .uuid(head!), "note_id": operation["noteId"]!, "parent_id": parent.map(CloudJSON.uuid) ?? .null,
                "kind": .string(kind), "created_at": .string("2026-09-07T10:00:00.000Z"), "snapshot": operation["snapshot"] ?? .null,
                "head_revision": .uuid(head!), "lifecycle_generation": .uuid(generation), "state": .string(state),
                "deletion_id": deletionID, "deleted_at": .null, "expires_at": .null])
            if kinds.count == 1 { throw CloudSyncFailure.unavailable }
            return try CloudJSON.object(["protocolVersion": .number(2), "results": .array([.object(["index": .number(0),
                "receipt": .object(["status": .string("ok"), "noteId": operation["noteId"]!, "revision": .uuid(head!),
                    "headRevision": .uuid(head!), "lifecycleGeneration": .uuid(generation), "state": .string(state)])])])]).data()
        }
        return try CloudJSON.object(["protocolVersion": .number(2), "cursor": .string(head!.uuidString),
            "hasMore": .bool(false), "changes": .array(change.map { [$0] } ?? [])]).data()
    }
}
