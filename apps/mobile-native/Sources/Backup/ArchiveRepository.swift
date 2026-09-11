import Foundation

extension LibraryRepository {
    func exportArchive(libraryID: UUID, identities: Set<LibraryIdentity>, includeTrash: Bool,
                       password: String, to output: URL) throws {
        try authorize(libraryID, identities: identities)
        // Read without startup migration/recovery: exporting must never mutate its source.
        let unpublished = try disk.unpublishedArchiveIDs()
        var sourceMetadataBytes = 0, sourceNoteCount = 0
        let notes = try FileManager.default.contentsOfDirectory(at: disk.root, includingPropertiesForKeys: nil)
            .filter { UUID(uuidString: $0.lastPathComponent).map { !unpublished.contains($0) } == true }
            .compactMap { directory -> NoteRecord? in
                try ArchiveSourcePaths.directory(directory, root: disk.root)
                let file = directory.appendingPathComponent("note.json")
                if !FileManager.default.fileExists(atPath: file.path) { return nil } // Purged tombstone.
                let size = try ArchiveSourcePaths.file(file, root: disk.root, maximum: EncryptedArchive.manifestLimit)
                let note = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
                guard note.schemaVersion == 2, note.id.uuidString == directory.lastPathComponent else { throw EncryptedArchive.Failure.unsupported }
                guard note.metadata?.libraryID == libraryID else { return nil }
                guard sourceNoteCount < 1000, sourceMetadataBytes <= EncryptedArchive.manifestLimit - size else { throw EncryptedArchive.Failure.limits }
                sourceNoteCount += 1; sourceMetadataBytes += size
                return note
            }
        var documents: [EncryptedArchive.Document] = [], entries: [EncryptedArchive.Entry] = []
        for note in notes where note.metadata?.libraryID == libraryID {
            try Task.checkCancellation()
            let lifecycle = try disk.lifecycle(noteID: note.id, libraryID: libraryID)
            if lifecycle.state == .purged || (lifecycle.state == .trashed && !includeTrash) { continue }
            guard note.captureState != .recording else { throw EncryptedArchive.Failure.busy }
            let directory = disk.directory(for: note.id)
            let history = directory.appendingPathComponent("revisions")
            try ArchiveSourcePaths.directory(history, root: disk.root)
            let revisionFiles = try FileManager.default.contentsOfDirectory(at: history, includingPropertiesForKeys: nil)
            guard revisionFiles.count <= 100_000 else { throw EncryptedArchive.Failure.limits }
            let revisions = try revisionFiles.filter { $0.pathExtension == "json" }.map { file in
                let size = try ArchiveSourcePaths.file(file, root: disk.root, maximum: EncryptedArchive.manifestLimit)
                guard sourceMetadataBytes <= EncryptedArchive.manifestLimit - size else { throw EncryptedArchive.Failure.limits }
                sourceMetadataBytes += size
                let revision = try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: file))
                guard revision.id.uuidString + ".json" == file.lastPathComponent else { throw EncryptedArchive.Failure.invalid }
                return revision
            }
            documents.append(.init(note: note, revisions: revisions, lifecycle: lifecycle))
            let audio = directory.appendingPathComponent("audio")
            if FileManager.default.fileExists(atPath: audio.path) {
                try ArchiveSourcePaths.directory(audio, root: disk.root)
                let values: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
                for file in try FileManager.default.contentsOfDirectory(at: audio, includingPropertiesForKeys: Array(values)).sorted(by: { $0.path < $1.path }) {
                    let properties = try file.resourceValues(forKeys: values)
                    let path = "audio/" + file.lastPathComponent
                    guard properties.isSymbolicLink != true, properties.isRegularFile == true,
                          EncryptedArchive.validPath(path), let size = properties.fileSize else { throw EncryptedArchive.Failure.invalid }
                    entries.append(.init(noteID: note.id, path: path, size: Int64(size)))
                }
            }
        }
        try EncryptedArchive.write(manifest: .init(documents: documents, entries: entries), disk: disk, password: password, to: output)
    }

    /// Serial repository ownership prevents writes between snapshot and export or during restore.
    /// Unique IDs preserve every existing copy. No credential/catalog/cloud journal is imported.
    func restoreArchive(from input: URL, password: String,
                        beforePublish: (@Sendable () throws -> Void)? = nil) throws -> Int {
        try disk.recoverArchiveRestore()
        let stageURL = disk.root.appendingPathComponent(".archive-staging", isDirectory: true)
        let stage = try NoteDiskStore(root: stageURL)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: stageURL.path)
        var published = false
        defer {
            if !published { try? disk.recoverArchiveRestore() }
            try? FileManager.default.removeItem(at: stageURL)
        }
        var mapping: [UUID: UUID] = [:]
        var handles: [String: FileHandle] = [:]
        defer { for handle in handles.values { try? handle.close() } }
        // First pass validates full archive integrity before any cleartext is materialized.
        _ = try EncryptedArchive.read(from: input, password: password, prepare: { _ in }, consume: { _, _ in })
        let manifest = try EncryptedArchive.read(from: input, password: password, prepare: { manifest in
            for document in manifest.documents {
                var id = UUID()
                while FileManager.default.fileExists(atPath: disk.directory(for: id).path) || mapping.values.contains(id) { id = UUID() }
                mapping[document.note.id] = id
            }
            try disk.write(ArchiveRestoreJournal(noteIDs: Array(mapping.values), published: false), to: disk.archiveJournalURL)
            for document in manifest.documents {
                let id = mapping[document.note.id]!
                let libraryID = document.note.metadata!.libraryID
                var note: NoteRecord = try ArchiveRemapping.copy(document.note, oldNoteID: document.note.id,
                    newNoteID: id, oldLibraryID: libraryID)
                note.id = id
                note.metadata?.libraryID = LibraryRecord.localID
                note.metadata?.folderID = nil
                note.metadata?.event = nil
                note.metadata?.cloudReadOnly = nil
                note.metadata?.lifecycleGeneration = id
                try stage.save(note)
                let history = stage.directory(for: id).appendingPathComponent("revisions")
                for revision in document.revisions {
                    let mapped: NoteRevision = try ArchiveRemapping.copy(revision, oldNoteID: document.note.id,
                        newNoteID: id, oldLibraryID: libraryID)
                    let destination = history.appendingPathComponent(mapped.id.uuidString + ".json")
                    if FileManager.default.fileExists(atPath: destination.path) {
                        guard try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: destination)) == mapped else {
                            throw EncryptedArchive.Failure.invalid
                        }
                    } else { try stage.write(mapped, to: destination) }
                }
                var lifecycle = NoteLifecycle.initial(noteID: id, libraryID: LibraryRecord.localID)
                lifecycle.audioTimelineStart = document.lifecycle.audioTimelineStart
                lifecycle.audioTimelineUncertain = document.lifecycle.audioTimelineUncertain
                lifecycle.audioRemovedAt = document.lifecycle.audioRemovedAt
                if document.lifecycle.state == .trashed {
                    lifecycle.state = .trashed; lifecycle.deletionID = UUID()
                    // Deliberate restore grants a fresh local recovery window; old backup copies remain unchanged.
                    lifecycle.deletedAt = Date(); lifecycle.expiresAt = Date().addingTimeInterval(30 * 86400)
                }
                try stage.saveLifecycle(lifecycle)
            }
        }, consume: { entry, data in
            let key = entry.noteID.uuidString + "/" + entry.path
            let handle: FileHandle
            if let existing = handles[key] { handle = existing }
            else {
                // Close previous file: descriptor and memory use are bounded independently of archive size.
                for existing in handles.values { try existing.close() }; handles.removeAll()
                guard let id = mapping[entry.noteID] else { throw EncryptedArchive.Failure.invalid }
                let file = stage.directory(for: id).appendingPathComponent(entry.path)
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                       attributes: [.protectionKey: FileProtectionType.complete])
                guard !FileManager.default.fileExists(atPath: file.path), FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete]) else {
                    throw EncryptedArchive.Failure.invalid
                }
                handle = try FileHandle(forWritingTo: file); handles[key] = handle
            }
            try handle.write(contentsOf: data)
        })
        for handle in handles.values { try handle.synchronize(); try handle.close() }; handles.removeAll()
        try Task.checkCancellation()
        for id in mapping.values {
            guard !FileManager.default.fileExists(atPath: disk.directory(for: id).path) else { throw EncryptedArchive.Failure.invalid }
            try FileManager.default.moveItem(at: stage.directory(for: id), to: disk.directory(for: id))
            try FileManager.default.createDirectory(at: disk.lifecycleURL(id).deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: stage.lifecycleURL(id), to: disk.lifecycleURL(id))
        }
        try beforePublish?(); try Task.checkCancellation()
        // Atomic publication of the entire batch. Startup rolls back only unpublished unique IDs.
        try disk.write(ArchiveRestoreJournal(noteIDs: Array(mapping.values), published: true), to: disk.archiveJournalURL)
        published = true
        try? FileManager.default.removeItem(at: disk.archiveJournalURL)
        return manifest.documents.count
    }
}

private enum ArchiveRemapping {
    static func copy<T: Codable>(_ source: T, oldNoteID: UUID, newNoteID: UUID, oldLibraryID: UUID) throws -> T {
        func rewrite(_ value: Any, key: String? = nil) -> Any {
            if let object = value as? [String: Any] { return Dictionary(uniqueKeysWithValues: object.map { ($0.key, rewrite($0.value, key: $0.key)) }) }
            if let array = value as? [Any] { return array.map { rewrite($0) } }
            if let string = value as? String, let key, ["noteID", "libraryID"].contains(key) {
                if key == "noteID", string == oldNoteID.uuidString { return newNoteID.uuidString }
                if key == "libraryID", string == oldLibraryID.uuidString { return LibraryRecord.localID.uuidString }
            }
            return value
        }
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(source))
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: rewrite(json)))
    }
}

struct ArchiveRestoreJournal: Codable {
    let noteIDs: [UUID]
    let published: Bool
}
extension NoteDiskStore {
    var archiveJournalURL: URL { root.appendingPathComponent(".archive-restore.json") }
    func unpublishedArchiveIDs() throws -> Set<UUID> {
        guard FileManager.default.fileExists(atPath: archiveJournalURL.path) else { return [] }
        let journal = try JSONDecoder().decode(ArchiveRestoreJournal.self, from: Data(contentsOf: archiveJournalURL))
        guard journal.noteIDs.count <= 1000, Set(journal.noteIDs).count == journal.noteIDs.count else { throw EncryptedArchive.Failure.invalid }
        return journal.published ? [] : Set(journal.noteIDs)
    }
    func recoverArchiveRestore() throws {
        if FileManager.default.fileExists(atPath: archiveJournalURL.path) {
            let journal = try JSONDecoder().decode(ArchiveRestoreJournal.self, from: Data(contentsOf: archiveJournalURL))
            guard journal.noteIDs.count <= 1000, Set(journal.noteIDs).count == journal.noteIDs.count else {
                throw EncryptedArchive.Failure.invalid
            }
            if !journal.published {
                for id in journal.noteIDs {
                    for path in [directory(for: id), lifecycleURL(id)] where FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
                }
            }
            try FileManager.default.removeItem(at: archiveJournalURL)
        }
        let stage = root.appendingPathComponent(".archive-staging")
        if FileManager.default.fileExists(atPath: stage.path) { try FileManager.default.removeItem(at: stage) }
    }
}

private enum ArchiveSourcePaths {
    static func contained(_ url: URL, root: URL) throws {
        let prefix = root.standardizedFileURL.path + "/"
        guard url.standardizedFileURL.path.hasPrefix(prefix) else { throw EncryptedArchive.Failure.invalid }
        let relative = String(url.standardizedFileURL.path.dropFirst(prefix.count))
        let expected = root.resolvingSymlinksInPath().appendingPathComponent(relative).standardizedFileURL.path
        guard url.resolvingSymlinksInPath().path == expected else { throw EncryptedArchive.Failure.invalid }
    }
    static func directory(_ url: URL, root: URL) throws {
        try contained(url, root: root)
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw EncryptedArchive.Failure.invalid }
    }
    static func file(_ url: URL, root: URL, maximum: Int) throws -> Int {
        try contained(url, root: root)
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize else { throw EncryptedArchive.Failure.invalid }
        guard size <= maximum else { throw EncryptedArchive.Failure.limits }
        return size
    }
}
