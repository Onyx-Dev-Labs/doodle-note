import Foundation
import AVFoundation

extension LibraryRepository {
    private func storedNote(_ id: UUID, libraryID: UUID) throws -> NoteRecord {
        let note = try JSONDecoder().decode(NoteRecord.self,
            from: Data(contentsOf: disk.directory(for: id).appendingPathComponent("note.json")))
        guard note.schemaVersion == 2, note.id == id, note.metadata?.libraryID == libraryID else {
            throw LibraryDataError.invalidOwnership
        }
        return note
    }

    func retainedNote(_ id: UUID, libraryID: UUID, identities: Set<LibraryIdentity>) throws -> NoteRecord {
        try authorize(libraryID, identities: identities)
        guard try disk.lifecycle(noteID: id, libraryID: libraryID).state != .purged else { throw LifecycleError.unavailable }
        return try storedNote(id, libraryID: libraryID)
    }

    func lifecycleEvents(identities: Set<LibraryIdentity>) throws -> [NoteLifecycle] {
        let allowed = try readCatalog().libraries.filter {
            $0.id == LibraryRecord.localID || $0.identity.map(identities.contains) == true
        }.map(\.id)
        let records = try disk.lifecycleRecords()
        for record in records where record.state != .purged {
            _ = try storedNote(record.noteID, libraryID: record.libraryID)
        }
        return records.filter { allowed.contains($0.libraryID) }
    }

    func trash(noteID: UUID, libraryID: UUID, expectedGeneration: UUID, operationID: UUID,
               now: Date, identities: Set<LibraryIdentity>) throws -> NoteLifecycle {
        try authorize(libraryID, identities: identities)
        var record = try disk.lifecycle(noteID: noteID, libraryID: libraryID)
        if record.operationID == operationID, record.state == .trashed { return record }
        guard record.state == .active, !record.restorePending, record.generation == expectedGeneration else { throw LifecycleError.stale }
        let note = try storedNote(noteID, libraryID: libraryID)
        guard note.captureState != .recording else { throw LifecycleError.recordingActive }
        record.state = .trashed
        record.generation = UUID()
        record.operationID = operationID
        record.deletionID = operationID
        record.deletedAt = now
        record.expiresAt = now.addingTimeInterval(30 * 24 * 60 * 60)
        try disk.saveLifecycle(record)
        return record
    }

    func restore(noteID: UUID, libraryID: UUID, deletionID: UUID, expectedGeneration: UUID,
                 operationID: UUID, now: Date, identities: Set<LibraryIdentity>,
                 beforeRestore: (@Sendable () throws -> Void)? = nil) throws -> NoteRecord {
        try authorize(libraryID, identities: identities)
        var record = try disk.lifecycle(noteID: noteID, libraryID: libraryID)
        if record.operationID == operationID, record.state == .active {
            if record.restorePending { try finishRestore(&record) }
            return try storedNote(noteID, libraryID: libraryID)
        }
        guard record.state == .trashed, record.deletionID == deletionID,
              record.generation == expectedGeneration else { throw LifecycleError.stale }
        if record.clock == .device, let expiresAt = record.expiresAt, now >= expiresAt { throw LifecycleError.expired }
        record.state = .active
        record.generation = UUID()
        record.operationID = operationID
        record.restorePending = true
        try disk.saveLifecycle(record)
        try beforeRestore?()
        try finishRestore(&record)
        return try storedNote(noteID, libraryID: libraryID)
    }

    private func finishRestore(_ record: inout NoteLifecycle) throws {
        var note = try storedNote(record.noteID, libraryID: record.libraryID)
        note.metadata?.lifecycleGeneration = record.generation
        if let folder = note.metadata?.folderID,
           !(try readCatalog().folders.contains { $0.id == folder && $0.libraryID == record.libraryID }) {
            note.metadata?.folderID = nil
        }
        try disk.save(note, restoring: true)
        record.restorePending = false
        try disk.saveLifecycle(record)
    }

    func permanentlyDelete(noteID: UUID, libraryID: UUID, expectedGeneration: UUID, operationID: UUID,
                           confirmed: Bool, identities: Set<LibraryIdentity>,
                           beforeRemoval: (@Sendable () throws -> Void)? = nil) throws -> NoteLifecycle {
        guard confirmed else { throw LifecycleError.confirmationRequired }
        try authorize(libraryID, identities: identities)
        var record = try disk.lifecycle(noteID: noteID, libraryID: libraryID)
        if record.state == .purged {
            if record.cleanupPending { try finishPurge(&record, beforeRemoval: beforeRemoval) }
            return record
        }
        guard record.state == .trashed, record.generation == expectedGeneration else { throw LifecycleError.stale }
        record.state = .purged
        record.operationID = operationID
        record.generation = UUID()
        record.cleanupPending = true
        // Commit irreversible intent before touching payload; this receipt blocks old saves forever.
        try disk.saveLifecycle(record)
        try finishPurge(&record, beforeRemoval: beforeRemoval)
        return record
    }

    func finishPurge(_ record: inout NoteLifecycle, beforeRemoval: (@Sendable () throws -> Void)? = nil) throws {
        try beforeRemoval?()
        var catalog = try readCatalog()
        catalog.jobs.removeAll { $0.noteID == record.noteID && $0.libraryID == record.libraryID }
        try saveCatalog(catalog)
        try CloudCacheScope.purgeCaches(disk: disk, record: record, catalog: catalog)
        let directory = disk.directory(for: record.noteID)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        let cloudIntent = disk.root.appendingPathComponent("cloud-imports/" + record.noteID.uuidString + ".json")
        if FileManager.default.fileExists(atPath: cloudIntent.path) { try FileManager.default.removeItem(at: cloudIntent) }
        record.cleanupPending = false
        record.restorePending = false
        record.audioRemovalPending = false
        try disk.saveLifecycle(record)
    }

    func removeAudio(noteID: UUID, libraryID: UUID, expectedGeneration: UUID, operationID: UUID,
                     confirmed: Bool, now: Date, identities: Set<LibraryIdentity>,
                     beforeRemoval: (@Sendable () throws -> Void)? = nil) throws -> NoteLifecycle {
        guard confirmed else { throw LifecycleError.confirmationRequired }
        try authorize(libraryID, identities: identities)
        var record = try disk.lifecycle(noteID: noteID, libraryID: libraryID)
        guard record.state == .active, !record.restorePending, record.generation == expectedGeneration else { throw LifecycleError.stale }
        let note = try storedNote(noteID, libraryID: libraryID)
        guard note.captureState != .recording else { throw LifecycleError.recordingActive }
        if record.audioOperationID == operationID, !record.audioRemovalPending { return record }
        if !record.audioRemovalPending {
            let audioEnd: TimeInterval
            do { audioEnd = try disk.recordingOffset(for: noteID) }
            catch {
                // Cleanup must remain available when corrupt audio cannot establish its endpoint.
                record.audioTimelineUncertain = true
                audioEnd = record.audioTimelineStart ?? 0
            }
            record.audioTimelineStart = max(audioEnd, note.passages.map(\.end).max() ?? 0)
        }
        record.audioOperationID = operationID
        record.audioRemovalPending = true
        record.audioRemovedAt = now
        try disk.saveLifecycle(record)
        try beforeRemoval?()
        try finishAudioRemoval(&record)
        return record
    }

    private func finishAudioRemoval(_ record: inout NoteLifecycle) throws {
        let directory = disk.directory(for: record.noteID).appendingPathComponent("audio")
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        record.audioRemovalPending = false
        try disk.saveLifecycle(record)
    }

    /// Local-only expiry. Account receipts need the future sync adapter's authoritative server decision.
    func processRetention(now: Date, identities: Set<LibraryIdentity>) throws -> [NoteLifecycle] {
        var results: [NoteLifecycle] = []
        for var record in try lifecycleEvents(identities: identities) {
            if record.restorePending { try finishRestore(&record) }
            if record.audioRemovalPending && record.state == .active { try finishAudioRemoval(&record) }
            if record.state == .purged && record.cleanupPending { try finishPurge(&record) }
            if record.state == .trashed, record.clock == .device, let expiresAt = record.expiresAt, now >= expiresAt {
                record = try permanentlyDelete(noteID: record.noteID, libraryID: record.libraryID,
                    expectedGeneration: record.generation, operationID: UUID(), confirmed: true, identities: identities)
            }
            results.append(record)
        }
        return results
    }

    func storageUsage(libraryID: UUID, identities: Set<LibraryIdentity>) throws -> StorageUsage {
        try authorize(libraryID, identities: identities)
        var noteBytes: Int64 = 0
        var audioBytes: Int64 = 0
        let directories = try FileManager.default.contentsOfDirectory(at: disk.root, includingPropertiesForKeys: nil)
        for directory in directories {
            guard let id = UUID(uuidString: directory.lastPathComponent) else { continue }
            if FileManager.default.fileExists(atPath: disk.lifecycleURL(id).path) {
                let receipt = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: disk.lifecycleURL(id)))
                guard receipt.schemaVersion == 1, receipt.noteID == id else { throw LibraryDataError.invalidDocument }
                guard receipt.libraryID == libraryID else { continue }
            } else {
                guard let note = try? JSONDecoder().decode(NoteRecord.self,
                    from: Data(contentsOf: directory.appendingPathComponent("note.json"))),
                    note.id == id, note.metadata?.libraryID == libraryID else { continue }
            }
            guard let files = FileManager.default.enumerator(at: directory,
                includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey], options: [.skipsHiddenFiles]) else { continue }
            for case let file as URL in files {
                let values = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard values.isRegularFile == true else { continue }
                let size = Int64(values.fileSize ?? 0)
                if file.path.hasPrefix(directory.appendingPathComponent("audio").path + "/") { audioBytes += size }
                else { noteBytes += size }
            }
        }
        let volume = try? disk.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return StorageUsage(notesBytes: noteBytes, audioBytes: audioBytes,
                            availableBytes: volume?.volumeAvailableCapacityForImportantUsage)
    }
}
