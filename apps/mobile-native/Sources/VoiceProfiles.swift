import Foundation
import Observation

struct VoiceProfile: Codable, Equatable, Identifiable, Sendable {
    var id: UUID
    var name: String
    var embedding: [Float]
    var createdAt: Date
    var updatedAt: Date
}

struct VoiceProfileCatalog: Codable, Equatable, Sendable {
    var profiles: [VoiceProfile] = []
    var selectedIDs: [UUID] = []
}

enum VoiceProfileError: LocalizedError {
    case storage, invalid, enrollment
    var errorDescription: String? {
        switch self {
        case .storage: "Could not save this voice. Notes and recordings are unchanged."
        case .invalid: "That saved voice is unavailable. Notes and recordings are unchanged."
        case .enrollment: "Need a clear finalized solo stretch before remembering this voice."
        }
    }
}

/// Device-local voice references. Not part of notes, sync, search, archive or AI payloads.
actor VoiceProfileStore {
    let root: URL
    private var file: URL { root.appendingPathComponent("profiles.json") }
    private var observationSequence: UInt64 = 0

    struct Snapshot: Sendable {
        let sequence: UInt64
        let catalog: VoiceProfileCatalog
    }

    private func snapshot(_ catalog: VoiceProfileCatalog) -> Snapshot {
        observationSequence += 1
        return Snapshot(sequence: observationSequence, catalog: catalog)
    }

    func current() throws -> Snapshot { snapshot(try load()) }

    /// The complete read-modify-write has no suspension point and one actor owner.
    func remember(name: String, embedding: [Float], replacing id: UUID? = nil) throws
        -> (profile: VoiceProfile, snapshot: Snapshot) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let vector = VoicePrint.normalize(embedding) else { throw VoiceProfileError.enrollment }
        var next = try load()
        let now = Date()
        let profile: VoiceProfile
        if let id {
            // A deleted replacement must not silently become a newly remembered voice.
            guard let index = next.profiles.firstIndex(where: { $0.id == id }) else { throw VoiceProfileError.invalid }
            profile = VoiceProfile(id: id, name: trimmed, embedding: vector,
                createdAt: next.profiles[index].createdAt, updatedAt: now)
            next.profiles[index] = profile
        } else {
            profile = VoiceProfile(id: UUID(), name: trimmed, embedding: vector, createdAt: now, updatedAt: now)
            next.profiles.append(profile)
        }
        if !next.selectedIDs.contains(profile.id) { next.selectedIDs.append(profile.id) }
        try save(next)
        return (profile, snapshot(next))
    }

    func remove(_ id: UUID) throws -> Snapshot {
        var next = try load()
        next.profiles.removeAll { $0.id == id }
        next.selectedIDs.removeAll { $0 == id }
        try save(next)
        return snapshot(next)
    }

    func setSelected(_ id: UUID, enabled: Bool) throws -> Snapshot {
        var next = try load()
        // A toggle queued after removal is a no-op, never a catalog replacement.
        guard next.profiles.contains(where: { $0.id == id }) else { return snapshot(next) }
        if enabled {
            if !next.selectedIDs.contains(id) { next.selectedIDs.append(id) }
        } else { next.selectedIDs.removeAll { $0 == id } }
        try save(next)
        return snapshot(next)
    }

    init(root: URL) { self.root = root }

    func load() throws -> VoiceProfileCatalog {
        guard FileManager.default.fileExists(atPath: file.path) else { return VoiceProfileCatalog() }
        let data = try Data(contentsOf: file)
        let catalog = try JSONDecoder().decode(VoiceProfileCatalog.self, from: data)
        return try validated(catalog)
    }

    func save(_ catalog: VoiceProfileCatalog) throws {
        let value = try validated(catalog)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var directory = root
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
        try JSONEncoder().encode(value).write(to: file,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var saved = file
        try saved.setResourceValues(resources)
    }

    func removeAll() throws {
        if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) }
    }

    private func validated(_ catalog: VoiceProfileCatalog) throws -> VoiceProfileCatalog {
        var seen = Set<UUID>()
        var profiles: [VoiceProfile] = []
        for profile in catalog.profiles {
            let name = profile.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard seen.insert(profile.id).inserted, !name.isEmpty, name.utf8.count <= 320,
                  profile.embedding.count == VoiceMatcher.embeddingDimension,
                  profile.embedding.allSatisfy({ $0.isFinite }) else { throw VoiceProfileError.invalid }
            var copy = profile
            copy.name = name
            profiles.append(copy)
        }
        let ids = Set(profiles.map(\.id))
        let selected = catalog.selectedIDs.filter { ids.contains($0) }
        guard selected.count == Set(selected).count else { throw VoiceProfileError.invalid }
        return VoiceProfileCatalog(profiles: profiles, selectedIDs: selected)
    }
}

enum LocalArchivePolicy {
    static let excludedDirectoryNames: Set<String> = ["VoiceProfiles", "SearchCache"]

    static func shouldInclude(_ url: URL, relativeTo root: URL) -> Bool {
        let relative = url.path.replacingOccurrences(of: root.path, with: "")
        let parts = relative.split(separator: "/").map(String.init)
        if parts.contains(where: { excludedDirectoryNames.contains($0) }) { return false }
        return true
    }

    static func bundledPaths(in root: URL) -> [URL] {
        let manager = FileManager.default
        guard let enumerator = manager.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]) else { return [] }
        var files: [URL] = []
        for case let file as URL in enumerator {
            let isFile = (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
            if isFile && shouldInclude(file, relativeTo: root) { files.append(file) }
        }
        return files
    }
}

@MainActor @Observable
final class VoiceProfiles {
    private let store: VoiceProfileStore
    private(set) var catalog = VoiceProfileCatalog()
    var detail = "Recording works without saved voices."
    var problem: String?

    var profiles: [VoiceProfile] { catalog.profiles }
    var selectedProfiles: [VoiceProfile] {
        let selected = Set(catalog.selectedIDs)
        return catalog.profiles.filter { selected.contains($0.id) }
    }

    init(root: URL = URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteNative/VoiceProfiles")) {
        store = VoiceProfileStore(root: root)
    }

    init(store: VoiceProfileStore) { self.store = store }

    private var acceptedSequence: UInt64 = 0
    private var requestSequence: UInt64 = 0

    private func beginRequest() -> UInt64 {
        requestSequence += 1
        return requestSequence
    }

    /// Awaited actor replies may resume out of order on MainActor. Refreshes and mutations
    /// share the actor's observation sequence so neither stale data nor status can regress.
    @discardableResult func apply(_ snapshot: VoiceProfileStore.Snapshot, detail message: String? = nil) -> Bool {
        guard snapshot.sequence > acceptedSequence else { return false }
        acceptedSequence = snapshot.sequence
        catalog = snapshot.catalog
        detail = message ?? (catalog.profiles.isEmpty
            ? "Recording works without saved voices."
            : "Saved voices stay on this device. They are not synced or backed up.")
        problem = nil
        return true
    }

    private func reportFailure(for request: UInt64) {
        guard request == requestSequence else { return }
        problem = VoiceProfileError.storage.localizedDescription
    }

    func refresh() async {
        let request = beginRequest()
        do { apply(try await store.current()) }
        catch { reportFailure(for: request) }
    }

    func remember(name: String, embedding: [Float], replacing id: UUID? = nil) async throws -> VoiceProfile {
        let request = beginRequest()
        do {
            let result = try await store.remember(name: name, embedding: embedding, replacing: id)
            apply(result.snapshot, detail: "This voice is remembered on this device only.")
            return result.profile
        } catch {
            reportFailure(for: request)
            throw error
        }
    }

    func remove(_ id: UUID) async throws {
        let request = beginRequest()
        do { apply(try await store.remove(id)) }
        catch { reportFailure(for: request); throw error }
    }

    func removeWithFeedback(_ id: UUID) async { try? await remove(id) }

    func setSelected(_ id: UUID, enabled: Bool) async {
        let request = beginRequest()
        do { apply(try await store.setSelected(id, enabled: enabled)) }
        catch { reportFailure(for: request) }
    }
}
