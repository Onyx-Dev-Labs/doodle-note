import Foundation

/// Coordinates filesystem cache commits with local permanent deletion. No lock spans network I/O.
/// The local receipt remains distinct from a server purge receipt so offline deletion can still sync.
struct CloudCacheScope: Sendable {
    private static let lock = NSRecursiveLock()
    let disk: NoteDiskStore
    let map: CloudIdentityMap
    let journalDirectory: URL

    static func synchronized<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
    func localID(_ remoteID: UUID) throws -> UUID {
        let file = journalDirectory.appendingPathComponent("journal.json")
        if FileManager.default.fileExists(atPath: file.path) {
            let state = try JSONDecoder().decode(CloudJournalState.self, from: Data(contentsOf: file))
            guard state.identity == map.identity, state.libraryID == map.remoteLibraryID else { throw LibraryDataError.invalidOwnership }
            return state.noteBindings[remoteID] ?? map.localNoteID(remoteID)
        }
        return map.localNoteID(remoteID)
    }
    func locallyPurged(_ remoteID: UUID) throws -> Bool {
        try disk.lifecycle(noteID: localID(remoteID), libraryID: map.localLibraryID).state == .purged
    }
    func redact(_ change: CloudJSON) throws -> CloudJSON {
        let id = try change.requiredUUID("note_id")
        guard try locallyPurged(id), case .object(var row) = change else { return change }
        row["snapshot"] = .null
        return .object(row)
    }
    func clean(_ state: inout CloudJournalState) throws {
        state.outbox = try state.outbox.filter { operation in
            if operation.kind == .upsert || operation.kind == .restore { return try !locallyPurged(operation.noteID) }
            return true
        }
        if let page = state.pendingPage {
            state.pendingPage = try CloudPage(.object(["protocolVersion": .number(2), "cursor": .string(page.cursor),
                "hasMore": .bool(page.hasMore), "changes": .array(try page.changes.map(redact))]))
        }
    }
    /// Called while the persisted local lifecycle already says purged. Every matching partition
    /// is verified against catalog ownership and the explicit remote/local note binding.
    static func purgeCaches(disk: NoteDiskStore, record: NoteLifecycle, catalog: LibraryCatalog) throws {
        try synchronized {
            let root = disk.root.appendingPathComponent("cloud/libraries")
            guard FileManager.default.fileExists(atPath: root.path) else { return }
            for directory in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
                let file = directory.appendingPathComponent("journal.json")
                guard FileManager.default.fileExists(atPath: file.path) else { continue }
                var state = try JSONDecoder().decode(CloudJournalState.self, from: Data(contentsOf: file))
                let map = CloudIdentityMap(identity: state.identity, remoteLibraryID: state.libraryID)
                guard map.localLibraryID == record.libraryID,
                      catalog.libraries.contains(where: { $0.id == record.libraryID && $0.identity == state.identity }),
                      let remoteID = state.noteBindings.first(where: { $0.value == record.noteID })?.key else { continue }
                let scope = CloudCacheScope(disk: disk, map: map, journalDirectory: directory)
                try scope.clean(&state)
                try JSONEncoder().encode(state).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                for target in [directory.appendingPathComponent("replica/\(remoteID.uuidString)/revisions"),
                               directory.appendingPathComponent("assets/\(remoteID.uuidString).json")] {
                    if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
                }
            }
        }
    }
}
