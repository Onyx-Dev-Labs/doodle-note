import Foundation

struct CloudSyncReport: Sendable {
    var uploaded = 0
    var downloaded = 0
    var conflicts: Set<UUID> = []
    var deferred: Set<UUID> = []
    var unsupported: Set<UUID> = []
    var hasMore = false
    var needsFollowup = false
}

/// Owns one explicitly selected account/library. A persisted page is replayed before fetching
/// another page; a request completion never chooses a different account's storage partition.
actor CloudSyncEngine {
    let connection: CloudConnection
    let connections: CloudConnectionStore
    let repository: LibraryRepository
    let transport: any CloudTransport
    let map: CloudIdentityMap
    let journal: CloudJournal
    let replica: CloudReplica
    let assets: CloudInkTransfer
    let cacheScope: CloudCacheScope
    typealias ImportCommit = @Sendable (CloudDecodedNote?, CloudRemoteNote, UUID, UUID?) async throws -> Void
    private let commit: ImportCommit?
    private var running = false

    init(connection: CloudConnection, connections: CloudConnectionStore, repository: LibraryRepository,
         transport: any CloudTransport, root: URL, commit: ImportCommit? = nil) throws {
        guard let library = connection.selectedLibraryID, connection.authenticated, !connection.paused else {
            throw CloudSyncFailure.signedOut
        }
        self.connection = connection
        self.connections = connections
        self.repository = repository
        self.transport = transport
        self.commit = commit
        map = CloudIdentityMap(identity: connection.account.identity, remoteLibraryID: library)
        journal = try CloudJournal(root: root, identity: connection.account.identity, libraryID: library)
        cacheScope = CloudCacheScope(disk: repository.disk, map: map, journalDirectory: journal.directory)
        replica = try CloudReplica(root: journal.directory.appendingPathComponent("replica"), cacheScope: cacheScope)
        assets = try CloudInkTransfer(root: journal.directory.appendingPathComponent("assets"), libraryID: library, cacheScope: cacheScope)
    }

    private func checkedSecret() async throws -> CloudSecret {
        guard let current = try await connections.load(), current.generation == connection.generation,
              current.authenticated, !current.paused, current.account.identity == map.identity,
              current.selectedLibraryID == map.remoteLibraryID else { throw CloudSyncFailure.signedOut }
        let secret = try await connections.credential(expectedGeneration: connection.generation)
        guard !secret.identityOnly else { throw CloudSyncFailure.subscription }
        return secret
    }
    private func check() async throws { _ = try await checkedSecret(); try Task.checkCancellation() }

    func synchronize(maxPages: Int = 25) async throws -> CloudSyncReport {
        guard !running, (1...100).contains(maxPages) else { throw CloudSyncFailure.changed }
        running = true
        defer { running = false }
        try await check()
        try await journal.protectCaches(cacheScope)
        var report = CloudSyncReport()
        try await sendAdoptions()
        // Persist current device edits before importing a remote head that may have changed offline.
        try await stageLocalChanges(report: &report)
        try await sendOutbox(report: &report)
        for _ in 0..<maxPages {
            try await check()
            var state = try await journal.load()
            if state.pendingPage == nil {
                var query = [URLQueryItem(name: "libraryId", value: map.remoteLibraryID.uuidString.lowercased()),
                             URLQueryItem(name: "limit", value: "1")]
                if let cursor = state.cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
                let response = try await transport.json(path: "api/sync/v2", query: query, secret: checkedSecret())
                try await check()
                try await journal.stage(CloudPage(response))
                state = try await journal.load()
            }
            guard let page = state.pendingPage else { throw CloudSyncFailure.invalidResponse }
            for change in page.changes {
                try await check()
                let remote = try await replica.accept(change)
                if remote.state == .purged {
                    try await journal.discardPurgedPayload(noteID: remote.id)
                    try await assets.purge(noteID: remote.id)
                }
            }
            // Metadata may point at a head in a later page; retained revisions allow importing it once present.
            try await importAvailable(report: &report)
            try await check()
            // Purge deliberately redacts pendingPage. Finish exactly the durable, redacted page,
            // not an earlier in-memory copy containing deleted payloads.
            guard let applied = try await journal.load().pendingPage else { throw CloudSyncFailure.changed }
            try await journal.finishPage(expected: applied)
            report.hasMore = applied.hasMore
            if !applied.hasMore { break }
        }
        return report
    }

    func keepDeviceVersion(localNoteID: UUID) async throws {
        try await check()
        guard let remoteID = try await journal.load().noteBindings.first(where: { $0.value == localNoteID })?.key else {
            throw CloudSyncFailure.changed
        }
        try await replica.permitDeviceResolution(noteID: remoteID)
    }
    func useCloudVersion(localNoteID: UUID, expectedPreviewRevision: UUID) async throws {
        try await check()
        guard let remoteID = try await journal.load().noteBindings.first(where: { $0.value == localNoteID })?.key,
              let remote = try await replica.note(remoteID), remote.state == .active, let head = remote.headRevision,
              head == expectedPreviewRevision,
              let local = try await repository.cloudNote(noteID: localNoteID, libraryID: map.localLibraryID, identity: map.identity),
              local.metadata?.revisionID == remote.uploadedLocalRevisionID, remote.uploadConflict else {
            // The current device draft must already exist as an immutable cloud conflict before choosing another version.
            throw CloudSyncFailure.changed
        }
        let operation = CloudOperation(id: UUID(), noteID: remoteID, libraryID: map.remoteLibraryID, kind: .choose,
            expectedRevision: head, expectedGeneration: remote.generation, deletionID: nil,
            localRevisionID: local.metadata?.revisionID, snapshot: nil, selectedRevision: head)
        try await journal.enqueue(operation)
    }

    func adopt(noteIDs: [UUID]) async throws {
        try await check()
        guard noteIDs.count <= 50 else { throw CloudSyncFailure.unsupported }
        for id in noteIDs { try await journal.enqueueAdoption(noteID: id) }
    }
    private func sendAdoptions() async throws {
        for adoption in try await journal.load().adoptions ?? [] {
            let response = try await transport.json(path: "api/sync/legacy", method: "POST", body: .object([
                "libraryId": .uuid(map.remoteLibraryID), "noteId": .uuid(adoption.noteID), "operationId": .uuid(adoption.id)]),
                secret: checkedSecret())
            try await check()
            guard ["ok", "already_adopted", "purged"].contains(response["status"]?.string ?? ""),
                  try response.requiredUUID("noteId") == adoption.noteID else { throw CloudSyncFailure.changed }
            if response["status"]?.string == "purged" { try await journal.discardPurgedPayload(noteID: adoption.noteID) }
            try await journal.finishAdoption(id: adoption.id)
        }
    }

    private func stageLocalChanges(report: inout CloudSyncReport) async throws {
        let notes = try await repository.cloudReload().filter { $0.metadata?.libraryID == map.localLibraryID }
        var states = try await repository.cloudLifecycles(libraryID: map.localLibraryID, identity: map.identity)
        for note in notes where !states.contains(where: { $0.noteID == note.id }) {
            states.append(.initial(noteID: note.id, libraryID: map.localLibraryID))
        }
        for local in states {
            try await check()
            let state = try await journal.load()
            var remoteID = state.noteBindings.first(where: { $0.value == local.noteID })?.key
            if remoteID == nil {
                guard local.state == .active else { continue }
                remoteID = UUID()
                _ = try await journal.bind(remoteNoteID: remoteID!, localNoteID: local.noteID)
            }
            let id = remoteID!
            guard !state.purgedNoteIDs.contains(id), !state.outbox.contains(where: { $0.noteID == id }) else { continue }
            let remote = try await replica.note(id)
            if remote?.state == .purged { continue }
            let note = notes.first { $0.id == local.noteID }
            if note?.captureState == .recording { report.deferred.insert(local.noteID); continue }
            let retained = try await replica.content(id)?.snapshot
            let references = retained?["inkAttachments"]?.list ?? []
            let inkChanged: Bool
            if let note { inkChanged = try await !assets.matches(noteID: id, ink: note.ink, references: references) }
            else { inkChanged = false }
            let kind: CloudOperation.Kind
            if local.state != (remote?.state ?? .active) {
                if local.state == .trashed { kind = .trash }
                else if local.state == .purged { kind = remote?.state == .active ? .trash : .purge }
                else { kind = .restore }
            } else {
                guard local.state == .active, let note, note.metadata?.cloudReadOnly != true,
                      inkChanged || (note.metadata?.revisionID != remote?.uploadedLocalRevisionID
                        && note.metadata?.revisionID != remote?.importedLocalRevisionID) else { continue }
                kind = .upsert
            }
            if kind != .upsert, remote?.headRevision == nil { report.deferred.insert(local.noteID); continue }
            if remote?.uploadConflict == true { report.conflicts.insert(local.noteID); continue }
            var snapshot: CloudJSON?
            if kind == .upsert {
                let (export, history) = try await repository.cloudExport(noteID: local.noteID,
                    libraryID: map.localLibraryID, identities: [map.identity])
                var inkReferences = references
                if export.ink.isEmpty { inkReferences = [] }
                else if inkChanged, let head = remote?.headRevision, let generation = remote?.generation {
                    let plan = try await assets.prepare(noteID: id, ink: export.ink, head: head, generation: generation)
                    inkReferences = [try await assets.upload(plan, transport: transport, authorize: { try await self.checkedSecret() })]
                    try await check()
                } else if inkChanged {
                    // The server requires an existing note before reserving private assets. First send
                    // its text revision; the next pass adds the preserved local drawing to that note.
                    inkReferences = []
                    report.needsFollowup = true
                    report.deferred.insert(local.noteID)
                }
                let sources = retained?["sourceVersions"]?.list ?? []
                let original = try Dictionary(uniqueKeysWithValues: sources.map { (try $0.requiredUUID("id"), $0) })
                snapshot = try CloudProjection(map: map, remoteNoteID: id).snapshot(note: export,
                    retained: history, inkReferences: inkReferences, retainedWireSources: original,
                    remoteFolderID: retained?["folderId"]?.string.flatMap(UUID.init(uuidString:)))
            }
            let operation = CloudOperation(id: UUID(), noteID: id, libraryID: map.remoteLibraryID, kind: kind,
                expectedRevision: remote?.headRevision, expectedGeneration: remote?.generation,
                deletionID: kind == .trash ? local.deletionID : remote?.deletionID,
                localRevisionID: note?.metadata?.revisionID, snapshot: snapshot, localGeneration: local.generation)
            try await check()
            try await journal.enqueue(operation)
        }
    }

    private func sendOutbox(report: inout CloudSyncReport) async throws {
        for operation in try await journal.load().outbox {
            try await check()
            if (operation.kind == .upsert || operation.kind == .restore), try cacheScope.locallyPurged(operation.noteID) { continue }
            let response = try await transport.json(path: operation.kind == .choose ? "api/sync/reader" : "api/sync/v2", method: "POST",
                body: operation.kind == .choose ? operation.wire : .object(["operations": .array([operation.wire])]), secret: checkedSecret())
            try await check()
            let receipt: CloudJSON
            if operation.kind == .choose { receipt = response }
            else {
                guard response["protocolVersion"]?.number == 2,
                      let results = response["results"]?.list, results.count == 1,
                      let value = results[0]["receipt"] else { throw CloudSyncFailure.changed }
                receipt = value
            }
            // Save replica receipt first. A crash before acknowledgement replays the same server operation.
            try await replica.uploaded(operation, receipt: receipt)
            try await journal.acknowledge(operationID: operation.id, receipt: receipt)
            if receipt["status"]?.string == "conflict" {
                let local = try await journal.bind(remoteNoteID: operation.noteID)
                report.conflicts.insert(local)
            }
            report.uploaded += 1
        }
    }

    private func importNote(_ decoded: CloudDecodedNote?, remote: CloudRemoteNote, localID: UUID, expected: UUID?) async throws {
        if let commit { try await commit(decoded, remote, localID, expected) }
        else {
            try await repository.cloudImport(decoded: decoded, remote: remote, localNoteID: localID,
                libraryID: map.localLibraryID, identity: map.identity,
                expectedLocalRevisionID: expected, readOnly: decoded?.isReadOnly ?? true)
        }
    }

    private func importAvailable(report: inout CloudSyncReport) async throws {
        for remote in try await replica.notes() {
            try await check()
            let localID = try await journal.bind(remoteNoteID: remote.id)
            let local = try await repository.cloudNote(noteID: localID, libraryID: map.localLibraryID, identity: map.identity)
            let pending = try await journal.load().outbox.contains { $0.noteID == remote.id }
            if remote.state == .purged {
                try await journal.discardPurgedPayload(noteID: remote.id)
                try await importNote(nil, remote: remote, localID: localID, expected: local?.metadata?.revisionID)
                continue
            }
            guard !pending else { continue }
            let localLifecycle = try await repository.cloudLifecycles(libraryID: map.localLibraryID, identity: map.identity)
                .first { $0.noteID == localID }
            if let localLifecycle, localLifecycle.state != remote.state,
               localLifecycle.generation != remote.importedLocalGeneration,
               localLifecycle.generation != remote.uploadedLocalGeneration {
                // A newer offline Trash/restore/purge action must reach the server before its older receipt can be imported.
                report.needsFollowup = true
                report.deferred.insert(localID)
                continue
            }
            if localLifecycle?.state == .purged {
                report.needsFollowup = true
                report.deferred.insert(localID)
                continue
            }
            if remote.uploadConflict || (local != nil && local?.metadata?.revisionID != remote.importedLocalRevisionID
                && local?.metadata?.revisionID != remote.uploadedLocalRevisionID) {
                report.conflicts.insert(localID)
                continue
            }
            guard let content = try await replica.content(remote.id), let snapshot = content.snapshot else { continue }
            do {
                let references = snapshot["inkAttachments"]?.list ?? []
                let ink: Data
                if references.isEmpty {
                    let preparingInitialInk = remote.uploadedHeadID == remote.headRevision
                        && local?.metadata?.revisionID == remote.uploadedLocalRevisionID
                    ink = preparingInitialInk ? local?.ink ?? Data() : Data()
                }
                else { ink = try await assets.download(noteID: remote.id, revisionID: content.id,
                    references: references, transport: transport, secret: checkedSecret()) }
                try await check()
                let decoder = CloudSnapshotDecoder(map: map, remoteNoteID: remote.id, localNoteID: localID)
                let decoded = try decoder.decode(snapshot, revisionID: content.id, generation: remote.generation,
                    savedAt: content.createdAt, ink: ink)
                try await check()
                try await importNote(decoded, remote: remote, localID: localID, expected: local?.metadata?.revisionID)
                try await replica.imported(noteID: remote.id, localRevision: decoded.note.metadata!.revisionID, generation: remote.generation)
                report.downloaded += 1
            } catch CloudSyncFailure.unsupported {
                // Retain the complete raw revision and advance the page so other notes still sync.
                report.unsupported.insert(localID)
            }
        }
    }
}
