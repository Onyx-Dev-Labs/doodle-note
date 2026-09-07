import CryptoKit
import Foundation

struct CloudPage: Codable, Equatable, Sendable {
    let cursor: String
    let hasMore: Bool
    let changes: [CloudJSON]
    init(_ response: CloudJSON) throws {
        guard response["protocolVersion"]?.number == 2,
              let cursor = response["cursor"]?.string, !cursor.isEmpty, cursor.count <= 1000,
              let hasMore = response["hasMore"]?.boolean,
              let changes = response["changes"]?.list, changes.count <= 50 else {
            throw CloudSyncFailure.invalidResponse
        }
        self.cursor = cursor
        self.hasMore = hasMore
        self.changes = changes
    }
}

struct CloudJournalState: Codable, Equatable, Sendable {
    var schemaVersion = 1
    let identity: LibraryIdentity
    let libraryID: UUID
    var cursor: String?
    var outbox: [CloudOperation] = []
    var noteBindings: [UUID: UUID] = [:] // remote note UUID -> local note UUID
    var pendingPage: CloudPage?
    var acknowledgements: [UUID: CloudJSON] = [:]
    var operationHashes: [UUID: String] = [:]
    var purgedNoteIDs: Set<UUID> = []
}

/// One account/workspace/library per durable journal. Network completions never choose another partition.
/// A page is persisted before local imports, and its cursor advances only after all imports succeed.
actor CloudJournal {
    let identity: LibraryIdentity
    let libraryID: UUID
    let directory: URL
    private var file: URL { directory.appendingPathComponent("journal.json") }
    init(root: URL, identity: LibraryIdentity, libraryID: UUID) throws {
        guard libraryID != LibraryRecord.localID, !identity.accountID.isEmpty, !identity.workspaceID.isEmpty else {
            throw LibraryDataError.invalidOwnership
        }
        self.identity = identity
        self.libraryID = libraryID
        let key = try JSONEncoder().encode([identity.accountID, identity.workspaceID, libraryID.uuidString.lowercased()])
        let hash = SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined()
        directory = root.appendingPathComponent(hash, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
    }
    func load() throws -> CloudJournalState {
        guard FileManager.default.fileExists(atPath: file.path) else {
            return CloudJournalState(identity: identity, libraryID: libraryID)
        }
        let state = try JSONDecoder().decode(CloudJournalState.self, from: Data(contentsOf: file))
        guard state.schemaVersion == 1, state.identity == identity, state.libraryID == libraryID,
              state.outbox.allSatisfy({ $0.libraryID == libraryID }),
              Set(state.outbox.map(\.id)).count == state.outbox.count,
              Set(state.noteBindings.values).count == state.noteBindings.count else {
            throw LibraryDataError.invalidOwnership
        }
        return state
    }
    private func save(_ state: CloudJournalState) throws {
        try JSONEncoder().encode(state).write(to: file,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func bind(remoteNoteID: UUID, localNoteID: UUID? = nil) throws -> UUID {
        var state = try load()
        if let existing = state.noteBindings[remoteNoteID] {
            guard localNoteID == nil || localNoteID == existing else { throw LibraryDataError.invalidOwnership }
            return existing
        }
        let local = localNoteID ?? CloudIdentityMap(identity: identity, remoteLibraryID: libraryID).localNoteID(remoteNoteID)
        guard !state.noteBindings.values.contains(local) else { throw LibraryDataError.invalidOwnership }
        state.noteBindings[remoteNoteID] = local
        try save(state)
        return local
    }
    func enqueue(_ operation: CloudOperation) throws {
        guard operation.libraryID == libraryID else { throw LibraryDataError.invalidOwnership }
        let bytes = try operation.wire.data()
        guard bytes.count <= 1_990_000 else { throw CloudSyncFailure.unsupported }
        var state = try load()
        guard !state.purgedNoteIDs.contains(operation.noteID) else { throw LifecycleError.unavailable }
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        if let previous = state.operationHashes[operation.id], previous != hash { throw LibraryDataError.immutableHistory }
        if let existing = state.outbox.first(where: { $0.id == operation.id }) {
            guard existing == operation else { throw LibraryDataError.immutableHistory }
            return
        }
        guard state.acknowledgements[operation.id] == nil else { return }
        state.operationHashes[operation.id] = hash
        state.outbox.append(operation)
        try save(state)
    }
    func acknowledge(operationID: UUID, receipt: CloudJSON) throws {
        var state = try load()
        guard let operation = state.outbox.first(where: { $0.id == operationID }) else {
            guard state.acknowledgements[operationID] == receipt else { throw CloudSyncFailure.changed }
            return
        }
        guard let status = receipt["status"]?.string, ["ok", "conflict", "purged"].contains(status),
              try receipt.requiredUUID("noteId") == operation.noteID else { throw CloudSyncFailure.invalidResponse }
        // Receipt is committed together with removal. A crash before this write replays the exact same operation ID/body.
        state.acknowledgements[operationID] = receipt
        state.outbox.removeAll { $0.id == operationID }
        try save(state)
    }
    func stage(_ page: CloudPage) throws {
        var state = try load()
        if let pending = state.pendingPage {
            guard pending == page else { throw CloudSyncFailure.changed }
            return
        }
        state.pendingPage = page
        try save(state)
    }
    func finishPage(expected: CloudPage) throws {
        var state = try load()
        guard state.pendingPage == expected else { throw CloudSyncFailure.changed }
        state.cursor = expected.cursor
        state.pendingPage = nil
        try save(state)
    }
    /// Server purge removes every queued payload for this note; its minimal acknowledgement remains.
    func discardPurgedPayload(noteID: UUID) throws {
        var state = try load()
        state.purgedNoteIDs.insert(noteID)
        state.outbox.removeAll { $0.noteID == noteID }
        state.acknowledgements = state.acknowledgements.mapValues { receipt in
            guard receipt["noteId"]?.string == noteID.uuidString.lowercased() else { return receipt }
            return .object(["noteId": .uuid(noteID), "status": .string("purged")])
        }
        if let page = state.pendingPage {
            let changes = page.changes.map { change -> CloudJSON in
                guard change["note_id"]?.string == noteID.uuidString.lowercased(), case .object(var row) = change else { return change }
                row["snapshot"] = .null
                row["state"] = .string("purged")
                return .object(row)
            }
            state.pendingPage = try CloudPage(.object(["protocolVersion": .number(2), "cursor": .string(page.cursor),
                "hasMore": .bool(page.hasMore), "changes": .array(changes)]))
        }
        try save(state)
    }
}
