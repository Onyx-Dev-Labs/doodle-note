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

    func refresh() async {
        do {
            catalog = try await store.load()
            detail = catalog.profiles.isEmpty
                ? "Recording works without saved voices."
                : "Saved voices stay on this device. They are not synced or backed up."
            problem = nil
        } catch {
            problem = VoiceProfileError.storage.localizedDescription
        }
    }

    func remember(name: String, embedding: [Float], replacing id: UUID? = nil) async throws -> VoiceProfile {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw VoiceProfileError.enrollment }
        guard let vector = VoicePrint.normalize(embedding) else { throw VoiceProfileError.enrollment }
        var next = catalog
        let now = Date()
        let profile: VoiceProfile
        if let id, let index = next.profiles.firstIndex(where: { $0.id == id }) {
            profile = VoiceProfile(id: id, name: trimmed, embedding: vector,
                createdAt: next.profiles[index].createdAt, updatedAt: now)
            next.profiles[index] = profile
        } else {
            profile = VoiceProfile(id: UUID(), name: trimmed, embedding: vector, createdAt: now, updatedAt: now)
            next.profiles.append(profile)
        }
        if !next.selectedIDs.contains(profile.id) { next.selectedIDs.append(profile.id) }
        try await store.save(next)
        catalog = next
        detail = "This voice is remembered on this device only."
        problem = nil
        return profile
    }

    func remove(_ id: UUID) async throws {
        var next = catalog
        next.profiles.removeAll { $0.id == id }
        next.selectedIDs.removeAll { $0 == id }
        try await store.save(next)
        catalog = next
        detail = catalog.profiles.isEmpty
            ? "Recording works without saved voices."
            : "Saved voices stay on this device. They are not synced or backed up."
        problem = nil
    }

    func removeWithFeedback(_ id: UUID) async {
        do { try await remove(id) } catch { problem = VoiceProfileError.storage.localizedDescription }
    }

    func setSelected(_ id: UUID, enabled: Bool) async {
        guard catalog.profiles.contains(where: { $0.id == id }) else { return }
        var next = catalog
        if enabled {
            if !next.selectedIDs.contains(id) { next.selectedIDs.append(id) }
        } else {
            next.selectedIDs.removeAll { $0 == id }
        }
        do {
            try await store.save(next)
            catalog = next
            problem = nil
        } catch {
            problem = VoiceProfileError.storage.localizedDescription
        }
    }
}
