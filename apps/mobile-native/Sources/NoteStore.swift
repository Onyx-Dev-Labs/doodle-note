import Foundation
import CryptoKit
import Observation

struct NoteDiskStore: Sendable {
    let root: URL

    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }

    func directory(for id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }

    func audioDirectory(for id: UUID) throws -> URL {
        if FileManager.default.fileExists(atPath: lifecycleURL(id).path) {
            let record = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: lifecycleURL(id)))
            guard record.schemaVersion == 1, record.noteID == id, record.state == .active, !record.restorePending, !record.audioRemovalPending else { throw LifecycleError.unavailable }
        }
        let url = directory(for: id).appendingPathComponent("audio", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return url
    }

    func save(_ note: NoteRecord, migrationOriginal: Data? = nil, restoring: Bool = false) throws {
        if note.schemaVersion == 2 {
            if restoring {
                guard let metadata = note.metadata else { throw LibraryDataError.invalidDocument }
                let state = try lifecycle(noteID: note.id, libraryID: metadata.libraryID)
                guard state.state == .active, state.restorePending,
                      state.generation == metadata.lifecycleGeneration else { throw LifecycleError.stale }
            } else { try requireActive(note) }
        }
        let dir = directory(for: note.id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("note.json")
        if FileManager.default.fileExists(atPath: file.path), note.schemaVersion != 2 {
            throw LibraryDataError.unsupportedVersion
        }
        if note.schemaVersion == 2 {
            guard let metadata = note.metadata else { throw LibraryDataError.invalidDocument }
            let ids = Set(metadata.summaries.map(\.id))
            guard ids.count == metadata.summaries.count,
                  metadata.selectedSummaryID.map(ids.contains) ?? true,
                  metadata.summaries.allSatisfy({ version in
                      (version.parentID.map { $0 != version.id && ids.contains($0) } ?? (version.origin == .generated))
                        && version.sources.allSatisfy { $0.noteID == note.id && $0.libraryID == metadata.libraryID }
                  }) else { throw LibraryDataError.immutableHistory }
            var retainedIDs: Set<UUID> = []
            for version in metadata.summaries {
                if version.origin == .edited {
                    guard let parent = version.parentID, retainedIDs.contains(parent) else { throw LibraryDataError.immutableHistory }
                } else if version.parentID != nil { throw LibraryDataError.immutableHistory }
                retainedIDs.insert(version.id)
            }
            if FileManager.default.fileExists(atPath: file.path) {
                let existingBytes = try Data(contentsOf: file)
                let old = try JSONDecoder().decode(NoteRecord.self, from: existingBytes)
                guard (1...2).contains(old.schemaVersion) else { throw LibraryDataError.unsupportedVersion }
                if old.schemaVersion == 1 {
                    guard migrationOriginal == existingBytes,
                          try Data(contentsOf: dir.appendingPathComponent("note.schema1.original.json")) == existingBytes,
                          FileManager.default.fileExists(atPath: dir.appendingPathComponent("migration-1-to-2.json").path) else {
                        throw LibraryDataError.invalidDocument
                    }
                } else if old.metadata == nil { throw LibraryDataError.invalidDocument }
                guard old.id == note.id else { throw LibraryDataError.invalidDocument }
                if let previous = old.metadata, old.schemaVersion == 2 {
                    guard previous.libraryID == metadata.libraryID else { throw LibraryDataError.invalidOwnership }
                    for version in previous.summaries {
                        guard metadata.summaries.contains(version) else { throw LibraryDataError.immutableHistory }
                    }
                }
            }
            let revision = NoteRevision(note)
            let history = dir.appendingPathComponent("revisions", isDirectory: true)
            try FileManager.default.createDirectory(at: history, withIntermediateDirectories: true)
            let revisionFile = history.appendingPathComponent(revision.id.uuidString + ".json")
            if FileManager.default.fileExists(atPath: revisionFile.path) {
                let existing = try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: revisionFile))
                guard existing == revision else { throw LibraryDataError.immutableHistory }
            } else { try write(revision, to: revisionFile) }
        }
        try write(note, to: file)
    }

    func write<T: Encodable>(_ value: T, to file: URL) throws {
        try JSONEncoder().encode(value).write(to: file,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    struct MigrationRecord: Codable {
        let fromVersion: Int
        let toVersion: Int
        let noteID: UUID
        let originalFile: String
        let originalSHA256: String
    }

    func migrate(_ source: NoteRecord, data: Data, directory: URL,
                 beforeCommit: (() throws -> Void)? = nil) throws -> NoteRecord {
        guard source.id.uuidString == directory.lastPathComponent, source.schemaVersion == 1 else {
            throw LibraryDataError.invalidDocument
        }
        let backup = directory.appendingPathComponent("note.schema1.original.json")
        if FileManager.default.fileExists(atPath: backup.path) {
            guard try Data(contentsOf: backup) == data else { throw LibraryDataError.invalidDocument }
        } else { try data.write(to: backup, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        let record = MigrationRecord(fromVersion: 1, toVersion: 2, noteID: source.id,
            originalFile: backup.lastPathComponent, originalSHA256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
        try write(record, to: directory.appendingPathComponent("migration-1-to-2.json"))
        var note = source
        note.schemaVersion = 2
        note.metadata = NoteMetadata(revisionID: source.id)
        try beforeCommit?()
        try save(note, migrationOriginal: data)
        guard try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: directory.appendingPathComponent("note.json"))) == note else {
            throw LibraryDataError.invalidDocument
        }
        return note
    }

    func revision(_ anchor: SourceAnchor) throws -> NoteRevision {
        let file = directory(for: anchor.noteID).appendingPathComponent("revisions")
            .appendingPathComponent(anchor.revisionID.uuidString + ".json")
        let revision = try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: file))
        guard revision.libraryID == anchor.libraryID, revision.noteID == anchor.noteID,
              revision.id == anchor.revisionID else { throw LibraryDataError.invalidOwnership }
        return revision
    }

    func load(persistRecovery: ((NoteRecord) throws -> Void)? = nil, beforeMigrationCommit: (() throws -> Void)? = nil) throws
        -> (notes: [NoteRecord], unreadable: [String], audioProblems: [String], recoveryWriteProblems: [String], migrationProblems: [String]) {
        let dirs = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var notes: [NoteRecord] = []
        var unreadable: [String] = []
        var audioProblems: [String] = []
        var recoveryWriteProblems: [String] = []
        var migrationProblems: [String] = []
        for dir in dirs where UUID(uuidString: dir.lastPathComponent) != nil {
            do {
                if let id = UUID(uuidString: dir.lastPathComponent), FileManager.default.fileExists(atPath: lifecycleURL(id).path) {
                    let state = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: lifecycleURL(id)))
                    guard state.schemaVersion == 1, state.noteID == id else { throw LibraryDataError.invalidDocument }
                    if state.state == .purged { continue }
                }
                let data = try Data(contentsOf: dir.appendingPathComponent("note.json"))
                var note = try JSONDecoder().decode(NoteRecord.self, from: data)
                guard (1...2).contains(note.schemaVersion), note.id.uuidString == dir.lastPathComponent else {
                    unreadable.append(dir.lastPathComponent)
                    continue
                }
                if note.schemaVersion == 1 {
                    do { note = try migrate(note, data: data, directory: dir, beforeCommit: beforeMigrationCommit) }
                    catch {
                        // A failed write must not hide readable source data or allow bypassing migration.
                        note.metadata = NoteMetadata(revisionID: note.id)
                        notes.append(note)
                        migrationProblems.append(dir.lastPathComponent)
                        continue
                    }
                }
                guard let metadata = note.metadata else { throw LibraryDataError.invalidDocument }
                _ = try lifecycle(noteID: note.id, libraryID: metadata.libraryID)
                let recovery = AudioRecovery.recover(directory: dir.appendingPathComponent("audio"))
                audioProblems.append(contentsOf: recovery.unreadable)
                audioProblems.append(contentsOf: recovery.incompleteCaptures)
                if recovery.discardedBytes > 0 {
                    audioProblems.append("Audio recovery could not use \(recovery.discardedBytes) trailing bytes. Original audio is preserved.")
                }
                if note.captureState == .recording {
                    note.captureState = .interrupted
                    do {
                        if let persistRecovery { try persistRecovery(note) }
                        else { try save(note) }
                    } catch { recoveryWriteProblems.append(dir.lastPathComponent) }
                }
                notes.append(note)
            } catch { unreadable.append(dir.lastPathComponent) }
        }
        return (notes.sorted { $0.updatedAt > $1.updatedAt }, unreadable, audioProblems, recoveryWriteProblems, migrationProblems)
    }

    func audioFiles(for id: UUID) -> [URL] {
        if FileManager.default.fileExists(atPath: lifecycleURL(id).path) {
            guard let record = try? JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: lifecycleURL(id))),
                  record.schemaVersion == 1, record.noteID == id, record.state != .purged, !record.audioRemovalPending else { return [] }
        }
        let dir = directory(for: id).appendingPathComponent("audio", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "caf" && !$0.lastPathComponent.hasSuffix(".recovered.caf") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .map { original in
                let recovered = AudioRecovery.recoveredURL(for: original)
                return FileManager.default.fileExists(atPath: recovered.path) ? recovered : original
            }
    }
}

@MainActor @Observable
final class NoteLibrary {
    private(set) var notes: [NoteRecord] = []
    private(set) var catalog = LibraryCatalog()
    private(set) var selectedLibraryID = LibraryRecord.localID
    private(set) var identities: Set<LibraryIdentity> = []
    private(set) var pendingSaves = 0
    private(set) var loading = true
    private(set) var completedWrites = 0
    private var queued: [UUID: (NoteRecord, Set<LibraryIdentity>)] = [:]
    private var loadTask: Task<Void, Never>?
    private var unsavedIDs: Set<UUID> = []
    var problem: String?
    private(set) var saveProblem: String?
    private(set) var disk: NoteDiskStore?
    private var repository: LibraryRepository?
    private(set) var lifecycle: [UUID: NoteLifecycle] = [:]
    private(set) var lifecycleReadable = false
    private(set) var storage: StorageUsage?
    private(set) var storageBusy = false
    private(set) var storageProblem: String?
    private var invalidating: Set<UUID> = []
    var trashNotes: [NoteRecord] {
        notes.filter { lifecycleReadable && $0.metadata?.libraryID == selectedLibraryID && lifecycle[$0.id]?.state == .trashed }
            .sorted { (lifecycle[$0.id]?.deletedAt ?? .distantPast) > (lifecycle[$1.id]?.deletedAt ?? .distantPast) }
    }
    var cleanupPending: Bool { lifecycle.values.contains { $0.cleanupPending || $0.restorePending || $0.audioRemovalPending } }

    private var saveTask: Task<Void, Never>?

    var libraries: [LibraryRecord] {
        catalog.libraries.filter { $0.id == LibraryRecord.localID || $0.identity.map(identities.contains) == true }
    }
    var visibleNotes: [NoteRecord] {
        notes.filter { lifecycleReadable && $0.metadata?.libraryID == selectedLibraryID && !invalidating.contains($0.id) && (lifecycle[$0.id]?.state ?? .active) == .active && lifecycle[$0.id]?.restorePending != true }
            .sorted { $0.updatedAt > $1.updatedAt }
    }
    var folders: [NoteFolder] { catalog.folders.filter { $0.libraryID == selectedLibraryID } }

    init(root: URL) {
        do {
            let disk = try NoteDiskStore(root: root)
            self.disk = disk
            repository = LibraryRepository(disk: disk)
            loadTask = Task {
                do {
                    guard let repository else { return }
                    let result = try await repository.load()
                    notes = result.notes
                    await refreshLifecycle()
                    await processRetention(captureActive: false)
                    if !result.migrationProblems.isEmpty {
                        problem = "Some notes are read-only until their storage upgrade can finish. Free device storage and reopen the app. Original files are preserved."
                    } else if !result.unreadable.isEmpty {
                        problem = "Some saved notes could not be opened. Their files have been preserved."
                    } else if !result.audioProblems.isEmpty {
                        problem = "Some interrupted audio needs recovery. Original files and notes are preserved. " + result.audioProblems.prefix(3).joined(separator: " ")
                    } else if !result.recoveryWriteProblems.isEmpty {
                        problem = "Recovered notes are available, but recovery status could not be saved. Free device storage before continuing."
                    }
                    await refreshCatalog()
                } catch { problem = "Local storage could not be opened. \(error.localizedDescription)" }
                loading = false
            }
        } catch { loading = false; problem = "Local storage could not be opened. \(error.localizedDescription)" }
    }

    func waitUntilLoaded() async { await loadTask?.value }

    func refreshCatalog() async {
        do { if let repository { catalog = try await repository.catalog() } }
        catch { problem = error.localizedDescription }
    }

    /// Call only after explicit identity authentication; signing in never moves a note.
    func authenticate(_ identity: LibraryIdentity, name: String) async throws {
        guard let repository else { throw LibraryDataError.invalidDocument }
        _ = try await repository.addLibrary(name: name, identity: identity)
        identities.insert(identity)
        await refreshCatalog()
        await refreshLifecycle()
    }

    /// Caller must stop active capture first; transport offline/paused is NOT sign-out.
    func signOut(_ identity: LibraryIdentity, captureActive: Bool) async -> Bool {
        guard !captureActive else { problem = "Stop recording before signing out."; return false }
        await flush()
        guard pendingSaves == 0, unsavedIDs.isEmpty else { return false }
        identities.remove(identity)
        selectedLibraryID = LibraryRecord.localID
        await refreshLifecycle()
        storage = nil
        return true
    }

    func selectLibrary(_ id: UUID) {
        guard libraries.contains(where: { $0.id == id }) else { return }
        selectedLibraryID = id
    }

    @discardableResult func create() -> UUID? {
        var note = NoteRecord()
        note.metadata?.libraryID = selectedLibraryID
        guard disk != nil, !loading, lifecycleReadable else { return nil }
        notes.insert(note, at: 0)
        enqueue(note)
        return note.id
    }

    func note(_ id: UUID) -> NoteRecord? {
        notes.first { note in
            lifecycleReadable && note.id == id && !invalidating.contains(id) && (lifecycle[id]?.state ?? .active) == .active
                && lifecycle[id]?.restorePending != true && libraries.contains(where: { $0.id == note.metadata?.libraryID })
        }
    }

    @discardableResult func update(_ id: UUID, _ change: (inout NoteRecord) -> Void) -> Bool {
        guard let original = note(id), let i = notes.firstIndex(where: { $0.id == id }) else { return false }
        var note = original
        change(&note)
        guard note.id == original.id, note.metadata?.libraryID == original.metadata?.libraryID,
              note.metadata?.lifecycleGeneration == original.metadata?.lifecycleGeneration,
              note.schemaVersion == 2 else { problem = LibraryDataError.invalidOwnership.localizedDescription; return false }
        if let folder = note.metadata?.folderID,
           !catalog.folders.contains(where: { $0.id == folder && $0.libraryID == note.metadata?.libraryID }) {
            problem = LibraryDataError.invalidOwnership.localizedDescription
            return false
        }
        note.updatedAt = Date()
        note.metadata?.revisionID = UUID()
        notes[i] = note
        enqueue(note)
        return true
    }

    private func enqueue(_ note: NoteRecord) {
        queued[note.id] = (note, identities)
        unsavedIDs.insert(note.id)
        pendingSaves = queued.count + (saveTask == nil ? 0 : 1)
        guard saveTask == nil, let repository else { return }
        saveTask = Task {
            while let id = queued.keys.first, let (snapshot, authorized) = queued.removeValue(forKey: id) {
                pendingSaves = queued.count + 1
                do {
                    try await repository.save(snapshot, identities: authorized)
                    completedWrites += 1
                    if notes.first(where: { $0.id == id })?.metadata?.revisionID == snapshot.metadata?.revisionID {
                        unsavedIDs.remove(id)
                        if unsavedIDs.isEmpty { saveProblem = nil }
                    }
                } catch {
                    unsavedIDs.insert(id)
                    saveProblem = "Changes could not be saved. Keep the app open and free device storage. \(error.localizedDescription)"
                }
            }
            pendingSaves = 0
            saveTask = nil
        }
    }

    @discardableResult func flush() async -> Bool {
        await saveTask?.value
        return unsavedIDs.isEmpty
    }

    func retrySaving() {
        for id in unsavedIDs {
            if let note = note(id) { enqueue(note) }
        }
    }

    func addFolder(_ name: String) async {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let repository else { return }
        do {
            _ = try await repository.addFolder(name: name, libraryID: selectedLibraryID, identities: identities)
            await refreshCatalog()
        } catch { problem = error.localizedDescription }
    }

    func saveSummaryEdit(noteID: UUID, parent: SummaryVersion, text: String) {
        update(noteID) { note in
            let version = SummaryVersion(id: UUID(), parentID: parent.id, createdAt: Date(), origin: .edited,
                format: parent.format, language: parent.language, text: text, sources: parent.sources)
            note.metadata?.summaries.append(version)
            note.metadata?.selectedSummaryID = version.id
        }
    }
    func refreshLifecycle() async {
        guard let repository else { return }
        do {
            lifecycle = Dictionary(uniqueKeysWithValues: try await repository.lifecycleEvents(identities: identities).map { ($0.noteID, $0) })
            lifecycleReadable = true
        }
        catch { lifecycleReadable = false; storageProblem = "Storage state could not be read. \(error.localizedDescription)" }
    }

    func refreshStorage() async {
        guard let repository else { return }
        let scope = selectedLibraryID
        do {
            let usage = try await repository.storageUsage(libraryID: scope, identities: identities)
            if selectedLibraryID == scope { storage = usage }
        }
        catch { problem = error.localizedDescription }
    }

    func processRetention(captureActive: Bool) async {
        guard !captureActive, !storageBusy, let repository else { return }
        storageBusy = true
        storageProblem = nil
        defer { storageBusy = false }
        do {
            _ = try await repository.processRetention(now: Date(), identities: identities)
            await refreshLifecycle()
            notes.removeAll { lifecycle[$0.id]?.state == .purged }
            for record in lifecycle.values where record.state == .active && !record.restorePending {
                if let index = notes.firstIndex(where: { $0.id == record.noteID }),
                   !unsavedIDs.contains(record.noteID),
                   notes[index].metadata?.lifecycleGeneration != record.generation {
                    let revision = notes[index].metadata?.revisionID
                    let restored = try await repository.retainedNote(record.noteID, libraryID: record.libraryID, identities: identities)
                    if let current = notes.firstIndex(where: { $0.id == record.noteID }),
                       !unsavedIDs.contains(record.noteID), notes[current].metadata?.revisionID == revision {
                        notes[current] = restored
                    }
                }
            }
        } catch {
            await refreshLifecycle()
            storageProblem = "Storage cleanup is incomplete. Retry when device storage is available. \(error.localizedDescription)"
        }
    }

    enum StorageAction { case trash, restore, purge, removeAudio }
    func performStorage(_ action: StorageAction, id: UUID, confirmed: Bool = false, captureActive: Bool) async {
        guard !captureActive, !storageBusy, let repository else {
            problem = LifecycleError.recordingActive.localizedDescription
            return
        }
        guard let source = notes.first(where: { $0.id == id }), let libraryID = source.metadata?.libraryID,
              libraries.contains(where: { $0.id == libraryID }) else { return }
        storageBusy = true
        storageProblem = nil
        invalidating.insert(id)
        defer { invalidating.remove(id); storageBusy = false }
        await flush()
        // Freeing audio or confirmed Trash payload must remain possible when another save hit ENOSPC.
        if action == .trash && unsavedIDs.contains(id) { return }
        do {
            let state = lifecycle[id] ?? .initial(noteID: id, libraryID: libraryID)
            switch action {
            case .trash:
                _ = try await repository.trash(noteID: id, libraryID: libraryID, expectedGeneration: state.generation,
                    operationID: UUID(), now: Date(), identities: identities)
            case .restore:
                guard let deletionID = state.deletionID else { throw LifecycleError.stale }
                _ = try await repository.restore(noteID: id, libraryID: libraryID, deletionID: deletionID,
                    expectedGeneration: state.generation, operationID: UUID(), now: Date(), identities: identities)
            case .purge:
                _ = try await repository.permanentlyDelete(noteID: id, libraryID: libraryID, expectedGeneration: state.generation,
                    operationID: UUID(), confirmed: confirmed, identities: identities)
            case .removeAudio:
                _ = try await repository.removeAudio(noteID: id, libraryID: libraryID, expectedGeneration: state.generation,
                    operationID: UUID(), confirmed: confirmed, now: Date(), identities: identities)
            }
            await refreshLifecycle()
            if lifecycle[id]?.state == .purged {
                notes.removeAll { $0.id == id }
                unsavedIDs.remove(id)
                if unsavedIDs.isEmpty { saveProblem = nil }
            }
            else if action == .restore {
                let restored = try await repository.retainedNote(id, libraryID: libraryID, identities: identities)
                if let index = notes.firstIndex(where: { $0.id == id }) { notes[index] = restored }
            }
            await refreshStorage()
        } catch {
            await refreshLifecycle()
            storageProblem = "Storage change is incomplete. \(error.localizedDescription)"
        }
    }

}
