import Foundation

struct CloudRemoteRevision: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    let noteID: UUID
    let parentID: UUID?
    let kind: String
    let createdAt: Date
    var snapshot: CloudJSON?
}
struct CloudRemoteNote: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    var headRevision: UUID?
    var generation: UUID
    var state: NoteLifecycle.State
    var deletionID: UUID?
    var deletedAt: Date?
    var expiresAt: Date?
    var importedLocalRevisionID: UUID?
    var importedLocalGeneration: UUID?
    var uploadedLocalGeneration: UUID?
    var uploadedLocalRevisionID: UUID?
    var uploadedHeadID: UUID?
    var uploadedRevisionID: UUID?
    var uploadConflict = false
    var cleanupPending = false
}

/// Retained remote revisions are stored separately from editable notes and from device audio.
/// Purge intent is durable before payload cleanup and survives restarting the app.
actor CloudReplica {
    let root: URL
    let cacheScope: CloudCacheScope?
    init(root: URL, cacheScope: CloudCacheScope? = nil) throws {
        self.cacheScope = cacheScope
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }
    private func folder(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }
    private func metadata(_ id: UUID) -> URL { folder(id).appendingPathComponent("state.json") }
    private func write<T: Encodable>(_ value: T, to file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func note(_ id: UUID) throws -> CloudRemoteNote? {
        guard FileManager.default.fileExists(atPath: metadata(id).path) else { return nil }
        let value = try JSONDecoder().decode(CloudRemoteNote.self, from: Data(contentsOf: metadata(id)))
        guard value.id == id else { throw LibraryDataError.invalidOwnership }
        return value
    }
    func notes() throws -> [CloudRemoteNote] {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .compactMap { UUID(uuidString: $0.lastPathComponent) }.compactMap { try note($0) }
    }
    func revisions(_ noteID: UUID) throws -> [CloudRemoteRevision] {
        guard try note(noteID)?.state != .purged, try cacheScope?.locallyPurged(noteID) != true else { return [] }
        let directory = folder(noteID).appendingPathComponent("revisions")
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).map {
            let value = try JSONDecoder().decode(CloudRemoteRevision.self, from: Data(contentsOf: $0))
            guard value.noteID == noteID, value.id.uuidString + ".json" == $0.lastPathComponent else { throw LibraryDataError.invalidOwnership }
            return value
        }.sorted { $0.createdAt < $1.createdAt }
    }
    func content(_ id: UUID, revisionID: UUID? = nil) throws -> CloudRemoteRevision? {
        guard let state = try note(id), state.state != .purged, try cacheScope?.locallyPurged(id) != true else { return nil }
        let versions = try revisions(id)
        var current = revisionID ?? state.headRevision
        var seen: Set<UUID> = []
        while let target = current {
            guard seen.insert(target).inserted else { throw CloudSyncFailure.invalidResponse }
            guard let revision = versions.first(where: { $0.id == target }) else { return nil }
            if revision.snapshot != nil, revision.snapshot != .null { return revision }
            current = revision.parentID
        }
        return nil
    }
    func accept(_ input: CloudJSON) throws -> CloudRemoteNote {
        try CloudCacheScope.synchronized {
            try acceptProtected(cacheScope?.redact(input) ?? input)
        }
    }
    private func acceptProtected(_ change: CloudJSON) throws -> CloudRemoteNote {
        let id = try change.requiredUUID("note_id")
        guard let state = NoteLifecycle.State(rawValue: try change.requiredString("state")) else { throw CloudSyncFailure.invalidResponse }
        var value = try note(id) ?? CloudRemoteNote(id: id, headRevision: nil,
            generation: try change.requiredUUID("lifecycle_generation"), state: state)
        // A minimal purge receipt always wins over old pages and retries.
        if value.state == .purged { try clean(&value); return value }
        value.headRevision = try optionalUUID(change, "head_revision")
        value.generation = try change.requiredUUID("lifecycle_generation")
        value.state = state
        value.deletionID = try optionalUUID(change, "deletion_id")
        value.deletedAt = try optionalDate(change, "deleted_at")
        value.expiresAt = try optionalDate(change, "expires_at")
        if state == .purged {
            value.cleanupPending = true
            try write(value, to: metadata(id))
            try clean(&value)
        } else {
            let revision = CloudRemoteRevision(id: try change.requiredUUID("id"), noteID: id,
                parentID: try optionalUUID(change, "parent_id"), kind: try change.requiredString("kind"),
                createdAt: try parsedDate(change.requiredString("created_at")), snapshot: change["snapshot"])
            let file = folder(id).appendingPathComponent("revisions").appendingPathComponent(revision.id.uuidString + ".json")
            if FileManager.default.fileExists(atPath: file.path) {
                let old = try JSONDecoder().decode(CloudRemoteRevision.self, from: Data(contentsOf: file))
                guard old == revision else { throw LibraryDataError.immutableHistory }
            } else { try write(revision, to: file) }
            try write(value, to: metadata(id))
        }
        return value
    }
    func imported(noteID: UUID, localRevision: UUID, generation: UUID) throws {
        guard var value = try note(noteID), value.state != .purged else { throw LifecycleError.unavailable }
        value.importedLocalRevisionID = localRevision
        value.importedLocalGeneration = generation
        try write(value, to: metadata(noteID))
    }
    func uploaded(_ operation: CloudOperation, receipt: CloudJSON) throws {
        guard let status = receipt["status"]?.string, ["ok", "conflict", "purged"].contains(status) else {
            throw CloudSyncFailure.invalidResponse
        }
        if status == "purged" { return } // pull supplies authoritative generation/deletion receipt.
        var value = try note(operation.noteID) ?? CloudRemoteNote(id: operation.noteID, headRevision: nil,
            generation: try receipt.requiredUUID("lifecycleGeneration"), state: .active)
        value.uploadedLocalRevisionID = operation.localRevisionID
        value.uploadedLocalGeneration = operation.localGeneration
        value.uploadedHeadID = try optionalUUID(receipt, "headRevision")
        value.uploadedRevisionID = try optionalUUID(receipt, "revision")
        value.uploadConflict = status == "conflict"
        try write(value, to: metadata(operation.noteID))
    }
    func permitDeviceResolution(noteID: UUID) throws {
        guard var value = try note(noteID), value.state == .active else { throw LifecycleError.unavailable }
        value.uploadConflict = false
        value.uploadedLocalRevisionID = nil
        value.importedLocalRevisionID = nil
        try write(value, to: metadata(noteID))
    }
    private func clean(_ value: inout CloudRemoteNote) throws {
        let directory = folder(value.id).appendingPathComponent("revisions")
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        value.cleanupPending = false
        value.importedLocalRevisionID = nil
        value.uploadedLocalRevisionID = nil
        value.uploadedHeadID = nil
        value.uploadedRevisionID = nil
        value.uploadConflict = false
        try write(value, to: metadata(value.id))
    }
    private func optionalUUID(_ value: CloudJSON, _ key: String) throws -> UUID? {
        guard value[key] != nil, value[key] != .null else { return nil }
        return try value.requiredUUID(key)
    }
    private func optionalDate(_ value: CloudJSON, _ key: String) throws -> Date? {
        guard value[key] != nil, value[key] != .null else { return nil }
        return try parsedDate(value.requiredString(key))
    }
    private func parsedDate(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = formatter.date(from: value) { return result }
        formatter.formatOptions = [.withInternetDateTime]
        guard let result = formatter.date(from: value) else { throw CloudSyncFailure.invalidResponse }
        return result
    }
}
