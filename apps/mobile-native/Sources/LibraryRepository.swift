import Foundation

/// One serial owner for catalog/job transactions and immutable output writes.
/// No network calls or credentials; authentication is supplied explicitly by the caller.
actor LibraryRepository {
    let disk: NoteDiskStore
    init(disk: NoteDiskStore) { self.disk = disk }

    func catalog() throws -> LibraryCatalog { try readCatalog() }
    func load() throws -> (notes: [NoteRecord], unreadable: [String], audioProblems: [String], recoveryWriteProblems: [String], migrationProblems: [String]) {
        try disk.load()
    }

    func readCatalog() throws -> LibraryCatalog {
        let url = disk.root.appendingPathComponent("libraries.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return LibraryCatalog() }
        let value = try JSONDecoder().decode(LibraryCatalog.self, from: Data(contentsOf: url))
        guard value.schemaVersion == 1 else { throw LibraryDataError.unsupportedVersion }
        guard value.libraries.first(where: { $0.id == LibraryRecord.localID }) == .local,
              Set(value.libraries.map(\.id)).count == value.libraries.count,
              value.libraries.allSatisfy({ $0.id == LibraryRecord.localID || $0.identity != nil }) else {
            throw LibraryDataError.invalidOwnership
        }
        let libraryIDs = Set(value.libraries.map(\.id))
        guard Set(value.folders.map(\.id)).count == value.folders.count,
              value.folders.allSatisfy({ libraryIDs.contains($0.libraryID) }),
              Set(value.jobs.map(\.id)).count == value.jobs.count,
              Set(value.jobs.map { [$0.libraryID.uuidString, $0.kind.rawValue, $0.idempotencyKey] }).count == value.jobs.count,
              value.jobs.allSatisfy({ libraryIDs.contains($0.libraryID) }) else {
            throw LibraryDataError.invalidDocument
        }
        return value
    }

    func saveCatalog(_ value: LibraryCatalog) throws {
        try disk.write(value, to: disk.root.appendingPathComponent("libraries.json"))
    }

    func addLibrary(name: String, identity: LibraryIdentity) throws -> LibraryRecord {
        guard !identity.accountID.isEmpty, !identity.workspaceID.isEmpty else { throw LibraryDataError.invalidOwnership }
        var catalog = try readCatalog()
        if let existing = catalog.libraries.first(where: { $0.identity == identity }) { return existing }
        let library = LibraryRecord(id: UUID(), name: name, identity: identity)
        catalog.libraries.append(library)
        try saveCatalog(catalog)
        return library
    }

    /// Attach an explicitly chosen cloud library without moving or relabeling existing local notes.
    func attachLibrary(id: UUID, name: String, identity: LibraryIdentity) throws -> LibraryRecord {
        guard id != LibraryRecord.localID, !identity.accountID.isEmpty, !identity.workspaceID.isEmpty else {
            throw LibraryDataError.invalidOwnership
        }
        var catalog = try readCatalog()
        if let existing = catalog.libraries.first(where: { $0.id == id }) {
            guard existing.identity == identity else { throw LibraryDataError.invalidOwnership }
            return existing
        }
        let library = LibraryRecord(id: id, name: name, identity: identity)
        catalog.libraries.append(library)
        try saveCatalog(catalog)
        return library
    }

    func authorize(_ libraryID: UUID, identities: Set<LibraryIdentity>) throws {
        let catalog = try readCatalog()
        guard let library = catalog.libraries.first(where: { $0.id == libraryID }),
              library.id == LibraryRecord.localID || library.identity.map(identities.contains) == true else {
            throw LibraryDataError.invalidOwnership
        }
    }

    func addFolder(name: String, libraryID: UUID, identities: Set<LibraryIdentity>) throws -> NoteFolder {
        try authorize(libraryID, identities: identities)
        var catalog = try readCatalog()
        let folder = NoteFolder(id: UUID(), libraryID: libraryID, name: name)
        catalog.folders.append(folder)
        try saveCatalog(catalog)
        return folder
    }

    func save(_ note: NoteRecord, identities: Set<LibraryIdentity>) throws {
        guard let metadata = note.metadata else { throw LibraryDataError.invalidDocument }
        try authorize(metadata.libraryID, identities: identities)
        if let folderID = metadata.folderID {
            guard try readCatalog().folders.contains(where: { $0.id == folderID && $0.libraryID == metadata.libraryID }) else {
                throw LibraryDataError.invalidOwnership
            }
        }
        try disk.save(note)
    }

    func resolve(_ anchor: SourceAnchor, identities: Set<LibraryIdentity>) throws -> String? {
        try authorize(anchor.libraryID, identities: identities)
        let lifecycle = try disk.lifecycle(noteID: anchor.noteID, libraryID: anchor.libraryID)
        guard lifecycle.state == .active, !lifecycle.restorePending else { throw LifecycleError.unavailable }
        if case .summary(let versionID) = anchor.content {
            guard anchor.revisionID == versionID else { throw LibraryDataError.invalidDocument }
            let file = disk.directory(for: anchor.noteID).appendingPathComponent("note.json")
            let note = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
            guard note.id == anchor.noteID, note.metadata?.libraryID == anchor.libraryID else { throw LibraryDataError.invalidOwnership }
            // Summary versions are append-only and immutable under NoteDiskStore.save.
            return note.metadata?.summaries.first { $0.id == versionID }?.text
        }
        return try disk.revision(anchor).resolve(anchor)
    }

    func beginEventNote(libraryID: UUID, event: EventOccurrenceKey,
                        identities: Set<LibraryIdentity>) throws -> ProcessingJob {
        guard [event.provider, event.accountID, event.calendarID, event.eventID, event.occurrenceID].allSatisfy({ !$0.isEmpty }) else {
            throw LibraryDataError.invalidJob
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let key = try encoder.encode(event).base64EncodedString()
        return try beginJob(libraryID: libraryID, kind: .eventNote, key: key, identities: identities)
    }

    func beginJob(libraryID: UUID, kind: ProcessingJob.Kind, key: String,
                  noteID: UUID? = nil, identities: Set<LibraryIdentity>) throws -> ProcessingJob {
        try authorize(libraryID, identities: identities)
        guard !key.isEmpty else { throw LibraryDataError.invalidJob }
        var catalog = try readCatalog()
        if let existing = catalog.jobs.first(where: { $0.libraryID == libraryID && $0.kind == kind && $0.idempotencyKey == key }) {
            guard noteID == nil || existing.noteID == noteID else { throw LibraryDataError.invalidJob }
            return existing
        }
        if kind == .summary {
            guard let noteID else { throw LibraryDataError.invalidJob }
            let note = try JSONDecoder().decode(NoteRecord.self,
                from: Data(contentsOf: disk.directory(for: noteID).appendingPathComponent("note.json")))
            guard note.id == noteID, note.metadata?.libraryID == libraryID else { throw LibraryDataError.invalidOwnership }
        }
        let job = ProcessingJob(id: UUID(), libraryID: libraryID, kind: kind, idempotencyKey: key,
                                noteID: noteID ?? UUID(), versionID: UUID())
        catalog.jobs.append(job)
        try saveCatalog(catalog)
        return job
    }

    func transitionJob(_ id: UUID, to state: ProcessingJob.State, error: String? = nil,
                       identities: Set<LibraryIdentity>) throws -> ProcessingJob {
        var catalog = try readCatalog()
        guard let i = catalog.jobs.firstIndex(where: { $0.id == id }) else { throw LibraryDataError.invalidJob }
        try authorize(catalog.jobs[i].libraryID, identities: identities)
        guard catalog.jobs[i].state != .completed, catalog.jobs[i].state != .cancelled else { return catalog.jobs[i] }
        guard state != .completed else { throw LibraryDataError.invalidJob }
        catalog.jobs[i].state = state
        if state == .running { catalog.jobs[i].attempts += 1 }
        catalog.jobs[i].lastError = error
        try saveCatalog(catalog)
        return catalog.jobs[i]
    }

    /// Output is saved before completion. Replay returns the already committed output unchanged.
    func commit(_ output: NoteRecord, for jobID: UUID, identities: Set<LibraryIdentity>,
                afterOutput: (@Sendable () throws -> Void)? = nil) throws -> NoteRecord {
        var catalog = try readCatalog()
        guard let i = catalog.jobs.firstIndex(where: { $0.id == jobID }) else { throw LibraryDataError.invalidJob }
        let job = catalog.jobs[i]
        try authorize(job.libraryID, identities: identities)
        guard job.state != .cancelled, output.id == job.noteID, output.metadata?.libraryID == job.libraryID else {
            throw LibraryDataError.invalidJob
        }
        let file = disk.directory(for: job.noteID).appendingPathComponent("note.json")
        var result = output
        if FileManager.default.fileExists(atPath: file.path) {
            let existing = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
            guard existing.id == job.noteID, existing.metadata?.libraryID == job.libraryID else { throw LibraryDataError.invalidOwnership }
            if job.kind != .summary || existing.metadata?.summaries.contains(where: { $0.id == job.versionID }) == true {
                result = existing
            } else {
                guard let version = output.metadata?.summaries.first(where: { $0.id == job.versionID }) else {
                    throw LibraryDataError.invalidJob
                }
                result = existing
                result.metadata?.summaries.append(version)
                if result.metadata?.selectedSummaryID == nil { result.metadata?.selectedSummaryID = version.id }
                result.metadata?.revisionID = UUID()
                result.updatedAt = Date()
            }
        }
        if job.kind == .summary {
            guard result.metadata?.summaries.contains(where: { $0.id == job.versionID }) == true else { throw LibraryDataError.invalidJob }
        }
        try save(result, identities: identities)
        try afterOutput?()
        catalog.jobs[i].state = .completed
        catalog.jobs[i].lastError = nil
        try saveCatalog(catalog)
        return result
    }
}
