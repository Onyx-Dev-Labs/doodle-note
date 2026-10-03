import Foundation

struct CloudImportIntent: Codable, Sendable {
    let identity: LibraryIdentity
    let note: NoteRecord?
    let sources: [NoteRevision]
    let lifecycle: NoteLifecycle
    let expectedLocalRevisionID: UUID?
}

extension LibraryRepository {
    func finishRevokedCapture(noteID: UUID, libraryID: UUID, identity: LibraryIdentity) throws {
        try authorize(libraryID, identities: [identity])
        guard var note = try cloudNote(noteID: noteID, libraryID: libraryID, identity: identity) else { throw LifecycleError.unavailable }
        guard note.captureState == .recording else { return }
        note.captureState = .interrupted
        note.updatedAt = Date()
        note.metadata?.revisionID = UUID()
        try disk.save(note)
    }
    func cloudLifecycles(libraryID: UUID, identity: LibraryIdentity) throws -> [NoteLifecycle] {
        try authorize(libraryID, identities: [identity])
        return try disk.lifecycleRecords().filter { $0.libraryID == libraryID }
    }
    func cloudNote(noteID: UUID, libraryID: UUID, identity: LibraryIdentity) throws -> NoteRecord? {
        try authorize(libraryID, identities: [identity])
        let file = disk.directory(for: noteID).appendingPathComponent("note.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let note = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
        guard note.id == noteID, note.metadata?.libraryID == libraryID else { throw LibraryDataError.invalidOwnership }
        return note
    }
    func cloudReload() throws -> [NoteRecord] { try disk.load(recoverRecording: false).notes }
    func cloudExport(noteID: UUID, libraryID: UUID, identities: Set<LibraryIdentity>) throws -> (NoteRecord, [NoteRevision]) {
        try authorize(libraryID, identities: identities)
        let note = try retainedNote(noteID, libraryID: libraryID, identities: identities)
        guard note.captureState != .recording else { throw LifecycleError.recordingActive }
        let directory = disk.directory(for: noteID).appendingPathComponent("revisions")
        let paths = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let sources = try paths.map { path in
            let source = try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: path))
            guard source.libraryID == libraryID, source.noteID == noteID else { throw LibraryDataError.invalidOwnership }
            return source
        }
        return (note, sources)
    }
    private func cloudIntentURL(_ noteID: UUID) -> URL {
        disk.root.appendingPathComponent("cloud-imports").appendingPathComponent(noteID.uuidString + ".json")
    }
    /// Recovery runs before account authentication exposes cached notes. Local-only notes are unaffected.
    func recoverCloudImports(identity: LibraryIdentity) throws {
        let directory = disk.root.appendingPathComponent("cloud-imports")
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            let intent = try JSONDecoder().decode(CloudImportIntent.self, from: Data(contentsOf: file))
            guard intent.identity == identity else { continue }
            guard file.lastPathComponent == intent.lifecycle.noteID.uuidString + ".json" else { throw LibraryDataError.invalidOwnership }
            try authorize(intent.lifecycle.libraryID, identities: [intent.identity])
            var current = try disk.lifecycle(noteID: intent.lifecycle.noteID, libraryID: intent.lifecycle.libraryID)
            if current.state == .purged {
                try finishPurge(&current)
                continue
            }
            try finishCloudImport(intent)
        }
    }
    func cloudImport(decoded: CloudDecodedNote?, remote: CloudRemoteNote, localNoteID: UUID, libraryID: UUID,
                     identity: LibraryIdentity, expectedLocalRevisionID: UUID?, readOnly: Bool) throws {
        try authorize(libraryID, identities: [identity])
        var lifecycle = try disk.lifecycle(noteID: localNoteID, libraryID: libraryID)
        if lifecycle.state == .purged, remote.state != .purged { throw LifecycleError.unavailable }
        let file = disk.directory(for: localNoteID).appendingPathComponent("note.json")
        if FileManager.default.fileExists(atPath: file.path) {
            let old = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
            guard old.metadata?.libraryID == libraryID, old.id == localNoteID else { throw LibraryDataError.invalidOwnership }
            guard old.captureState != .recording else { throw LifecycleError.recordingActive }
            guard old.metadata?.revisionID == expectedLocalRevisionID else { throw CloudSyncFailure.changed }
        } else if expectedLocalRevisionID != nil { throw CloudSyncFailure.changed }
        lifecycle.generation = remote.generation
        lifecycle.state = remote.state
        lifecycle.deletionID = remote.deletionID
        lifecycle.deletedAt = remote.deletedAt
        lifecycle.expiresAt = remote.expiresAt
        lifecycle.clock = .server
        lifecycle.restorePending = false
        lifecycle.cleanupPending = remote.state == .purged
        var note = decoded?.note
        if note != nil {
            note?.metadata?.cloudReadOnly = readOnly
            note?.metadata?.lifecycleGeneration = lifecycle.generation
        }
        guard remote.state == .purged || note != nil else { throw CloudSyncFailure.invalidResponse }
        let intent = CloudImportIntent(identity: identity, note: note, sources: decoded?.sources ?? [],
                                       lifecycle: lifecycle, expectedLocalRevisionID: expectedLocalRevisionID)
        try FileManager.default.createDirectory(at: cloudIntentURL(localNoteID).deletingLastPathComponent(), withIntermediateDirectories: true)
        try disk.write(intent, to: cloudIntentURL(localNoteID))
        try finishCloudImport(intent)
    }
    private func finishCloudImport(_ intent: CloudImportIntent) throws {
        let id = intent.lifecycle.noteID, libraryID = intent.lifecycle.libraryID
        try authorize(libraryID, identities: [intent.identity])
        var target = intent.lifecycle
        let current = try disk.lifecycle(noteID: id, libraryID: libraryID)
        // Preserve device-only audio safety receipts, including future local fields through saveLifecycle's merge policy.
        target.audioRemovalPending = current.audioRemovalPending
        target.audioRemovedAt = current.audioRemovedAt
        target.audioOperationID = current.audioOperationID
        target.audioTimelineStart = current.audioTimelineStart
        if current.state == .purged, target.state != .purged { throw LifecycleError.unavailable }
        if target.state == .purged {
            target.cleanupPending = true
            try disk.saveLifecycle(target)
            try finishPurge(&target)
        } else {
            guard var note = intent.note, note.id == id, note.metadata?.libraryID == libraryID else {
                throw LibraryDataError.invalidOwnership
            }
            var sources = intent.sources
            let file = disk.directory(for: id).appendingPathComponent("note.json")
            if FileManager.default.fileExists(atPath: file.path) {
                let old = try JSONDecoder().decode(NoteRecord.self, from: Data(contentsOf: file))
                guard old.captureState != .recording,
                      old.metadata?.revisionID == intent.expectedLocalRevisionID || old.metadata?.revisionID == note.metadata?.revisionID else {
                    throw CloudSyncFailure.changed
                }
                for summary in old.metadata?.summaries ?? [] {
                    if let received = note.metadata?.summaries.first(where: { $0.id == summary.id }) {
                        guard received == summary else { throw LibraryDataError.immutableHistory }
                    } else { note.metadata?.summaries.append(summary) }
                }
                let orderedSummaries = try orderCloudSummaries(note.metadata?.summaries ?? [])
                note.metadata?.summaries = orderedSummaries
                // Cloud payloads never change the local audio capture/recovery status or remove original audio.
                note.preserveLocalTranscript(from: old, sources: &sources)
                note.captureState = old.captureState
                note.metadata?.folderID = old.metadata?.folderID
            }
            let history = disk.directory(for: id).appendingPathComponent("revisions")
            try FileManager.default.createDirectory(at: history, withIntermediateDirectories: true)
            for source in sources {
                guard source.noteID == id, source.libraryID == libraryID else { throw LibraryDataError.invalidOwnership }
                let path = history.appendingPathComponent(source.id.uuidString + ".json")
                if FileManager.default.fileExists(atPath: path.path) {
                    let old = try JSONDecoder().decode(NoteRevision.self, from: Data(contentsOf: path))
                    guard old.id == source.id, old.noteID == id, old.libraryID == libraryID,
                          old.title == source.title, old.text == source.text,
                          old.passages.map(\.id) == source.passages.map(\.id),
                          old.passages.map(\.text) == source.passages.map(\.text),
                          old.passages.map({ ($0.start * 1000).rounded() }) == source.passages.map({ ($0.start * 1000).rounded() }),
                          old.passages.map({ ($0.end * 1000).rounded() }) == source.passages.map({ ($0.end * 1000).rounded() }) else { throw LibraryDataError.immutableHistory }
                    if source.id == note.metadata?.revisionID {
                        note.updatedAt = old.savedAt
                        note.passages = old.passages
                        note.speakerAnnotations = old.speakerAnnotations
                    }
                } else { try disk.write(source, to: path) }
            }
            if disk.audioFiles(for: id).isEmpty, target.audioTimelineStart == nil {
                target.audioTimelineStart = note.passages.map(\.end).max() ?? 0
            }
            var pending = target
            pending.state = .active
            pending.restorePending = true
            try disk.saveLifecycle(pending)
            try disk.save(note, restoring: true, cloudImport: true)
            target.restorePending = false
            try disk.saveLifecycle(target)
        }
        if FileManager.default.fileExists(atPath: cloudIntentURL(id).path) { try FileManager.default.removeItem(at: cloudIntentURL(id)) }
    }
    private func orderCloudSummaries(_ values: [SummaryVersion]) throws -> [SummaryVersion] {
        var remaining = values, ordered: [SummaryVersion] = []
        while !remaining.isEmpty {
            guard let index = remaining.firstIndex(where: { $0.parentID == nil || ordered.map(\.id).contains($0.parentID!) }) else {
                throw LibraryDataError.immutableHistory
            }
            ordered.append(remaining.remove(at: index))
        }
        return ordered
    }
}
