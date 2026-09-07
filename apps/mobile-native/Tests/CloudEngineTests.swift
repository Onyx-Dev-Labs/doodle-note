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
