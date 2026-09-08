import Foundation

struct CloudDecodedNote: Sendable {
    let note: NoteRecord
    let sources: [NoteRevision]
    let isLegacy: Bool
    let isReadOnly: Bool
}

struct CloudSnapshotDecoder {
    let map: CloudIdentityMap
    let remoteNoteID: UUID
    let localNoteID: UUID

    func decode(_ snapshot: CloudJSON, revisionID: UUID, generation: UUID, savedAt: Date, ink: Data) throws -> CloudDecodedNote {
        if snapshot["legacyMeeting"] != nil { return try legacy(snapshot, revisionID: revisionID, generation: generation, savedAt: savedAt) }
        var note = NoteRecord()
        note.id = localNoteID
        note.createdAt = try date(snapshot.requiredString("createdAt"))
        note.updatedAt = savedAt
        note.title = try snapshot.requiredString("title")
        note.text = try snapshot.requiredString("text")
        guard let language = SpokenLanguage(rawValue: try snapshot.requiredString("language")),
              let sourceRows = snapshot["sourceVersions"]?.list, sourceRows.count <= 100,
              let summaryRows = snapshot["summaries"]?.list, summaryRows.count <= 100,
              ["note", "meeting"].contains(snapshot["kind"]?.string ?? "") else { throw CloudSyncFailure.unsupported }
        note.language = language
        note.captureState = .idle
        note.ink = ink
        note.metadata = NoteMetadata(libraryID: map.localLibraryID, lifecycleGeneration: generation,
                                     revisionID: try snapshot.requiredUUID("sourceRevisionId"))
        if let status = snapshot["transcriptStatus"]?.string {
            guard let completion = TranscriptCompletion(rawValue: status) else { throw CloudSyncFailure.unsupported }
            note.metadata?.cloudTranscriptStatus = completion
        } else {
            note.metadata?.cloudTranscriptStatus = snapshot["kind"]?.string == "meeting" ? .partial : TranscriptCompletion.none
        }
        try content(snapshot, into: &note)
        let summaries = try summaryRows.map(summary)
        note.metadata?.summaries = try ordered(summaries)
        if let selected = snapshot["selectedSummaryId"]?.string {
            guard let id = UUID(uuidString: selected), summaries.contains(where: { $0.id == id }) else { throw CloudSyncFailure.invalidResponse }
            note.metadata?.selectedSummaryID = id
        }
        if let event = snapshot["event"], event != .null {
            note.metadata?.event = EventOccurrenceKey(provider: try event.requiredString("provider"),
                accountID: try event.requiredString("accountId"), calendarID: try event.requiredString("calendarId"),
                eventID: try event.requiredString("eventId"), occurrenceID: try event.requiredString("occurrenceId"))
        }
        let sources = try sourceRows.map { row -> NoteRevision in
            var source = note
            source.metadata?.revisionID = try row.requiredUUID("id")
            source.title = try row.requiredString("title")
            source.text = try row.requiredString("text")
            try content(row, into: &source)
            return NoteRevision(source)
        }
        guard Set(sources.map(\.id)).count == sources.count,
              sources.contains(where: { $0.id == note.metadata?.revisionID && $0.title == note.title && $0.text == note.text
                  && $0.passages == note.passages && $0.speakerAnnotations == note.speakerAnnotations }) else {
            throw CloudSyncFailure.invalidResponse
        }
        return CloudDecodedNote(note: note, sources: sources, isLegacy: false, isReadOnly: !knownSchema(snapshot))
    }

    /// Unknown fields remain in the raw replica. Disable edits rather than projecting them away.
    private func knownSchema(_ value: CloudJSON) -> Bool {
        func keys(_ value: CloudJSON, _ allowed: Set<String>) -> Bool {
            guard case .object(let row) = value else { return false }
            return Set(row.keys).isSubset(of: allowed)
        }
        func content(_ row: CloudJSON) -> Bool {
            (row["passages"]?.list ?? []).allSatisfy { keys($0, ["id", "sourceId", "startMs", "endMs", "text", "speakerId", "isFinal", "isUserEdited"]) }
                && (row["speakers"]?.list ?? []).allSatisfy { keys($0, ["id", "displayName", "sessionId", "slot"]) }
                && (row["speakerTurns"]?.list ?? []).allSatisfy { keys($0, ["speakerId", "startMs", "endMs", "isFinal"]) }
        }
        guard keys(value, ["title", "kind", "createdAt", "language", "text", "passages", "speakers", "summaries", "inkAttachments",
                           "sourceRevisionId", "sourceVersions", "selectedSummaryId", "folderId", "event", "speakerTurns", "transcriptStatus"]),
              content(value) else { return false }
        for source in value["sourceVersions"]?.list ?? [] {
            guard keys(source, ["id", "title", "text", "passages", "speakers", "speakerTurns"]), content(source) else { return false }
        }
        for summary in value["summaries"]?.list ?? [] {
            guard keys(summary, ["id", "parentId", "createdAt", "origin", "format", "language", "markdown", "sources"]),
                  (summary["sources"]?.list ?? []).allSatisfy({ keys($0, ["libraryId", "noteId", "revisionId", "kind", "paragraphIndex", "passageId", "summaryId"]) }) else { return false }
        }
        if let event = value["event"], !keys(event, ["provider", "accountId", "calendarId", "eventId", "occurrenceId"]) { return false }
        return (value["inkAttachments"]?.list ?? []).allSatisfy { keys($0, ["id", "versionId"]) }
    }

    private func content(_ row: CloudJSON, into note: inout NoteRecord) throws {
        guard let passages = row["passages"]?.list, passages.count <= 20_000,
              let speakers = row["speakers"]?.list, speakers.count <= 100 else { throw CloudSyncFailure.unsupported }
        var names: [UUID: String] = [:]
        var keys: [UUID: (UUID, Int)] = [:]
        var annotations = SpeakerAnnotations()
        annotations.order = []
        for speaker in speakers {
            let id = try speaker.requiredUUID("id")
            guard names[id] == nil else { throw CloudSyncFailure.invalidResponse }
            names[id] = try speaker.requiredString("displayName")
            let session = try speaker["sessionId"] == nil ? id : speaker.requiredUUID("sessionId")
            let slot = speaker["slot"]?.number ?? 0
            guard slot.rounded() == slot, (0...3).contains(slot) else { throw CloudSyncFailure.invalidResponse }
            keys[id] = (session, Int(slot))
            let key = "\(session.uuidString):\(Int(slot))"
            annotations.names[key] = names[id]
            if annotations.order?.contains(key) == false { annotations.order?.append(key) }
        }
        for turn in row["speakerTurns"]?.list ?? [] {
            guard let key = keys[try turn.requiredUUID("speakerId")], let isFinal = turn["isFinal"]?.boolean else {
                throw CloudSyncFailure.invalidResponse
            }
            let start = try seconds(turn, "startMs"), end = try seconds(turn, "endMs")
            guard end > start else { throw CloudSyncFailure.invalidResponse }
            annotations.turns.append(.init(sessionID: key.0, slot: key.1, start: start, end: end, isFinal: isFinal))
        }
        note.passages = try passages.map { passage in
            let start = try seconds(passage, "startMs"), end = try seconds(passage, "endMs")
            guard end >= start else { throw CloudSyncFailure.invalidResponse }
            var value = TranscriptPassage(id: try passage.requiredUUID("id"), start: start, end: end,
                text: try passage.requiredString("text"), isFinal: passage["isFinal"]?.boolean ?? false)
            if let edited = passage["isUserEdited"] {
                guard let marker = edited.boolean else { throw CloudSyncFailure.invalidResponse }
                value.isUserEdited = marker
            }
            if let id = passage["speakerId"]?.string {
                guard let speaker = UUID(uuidString: id), let name = names[speaker] else { throw CloudSyncFailure.invalidResponse }
                value.speakerName = name
            }
            return value
        }
        guard Set(note.passages.map(\.id)).count == note.passages.count else { throw CloudSyncFailure.invalidResponse }
        note.speakerAnnotations = annotations.turns.isEmpty && annotations.names.isEmpty ? nil : annotations
    }

    private func summary(_ row: CloudJSON) throws -> SummaryVersion {
        guard let origin = SummaryVersion.Origin(rawValue: try row.requiredString("origin")),
              let language = SpokenLanguage(rawValue: try row.requiredString("language")),
              let anchors = row["sources"]?.list else { throw CloudSyncFailure.unsupported }
        let parent = try row["parentId"] == nil ? nil : row.requiredUUID("parentId")
        return SummaryVersion(id: try row.requiredUUID("id"), parentID: parent, createdAt: try date(row.requiredString("createdAt")),
            origin: origin, format: try row.requiredString("format"), language: language,
            text: try row.requiredString("markdown"), sources: try anchors.map(anchor))
    }
    private func anchor(_ row: CloudJSON) throws -> SourceAnchor {
        guard try row.requiredUUID("libraryId") == map.remoteLibraryID, try row.requiredUUID("noteId") == remoteNoteID else {
            throw LibraryDataError.invalidOwnership
        }
        let content: CloudJSON
        switch try row.requiredString("kind") {
        case "personalParagraph":
            guard let index = row["paragraphIndex"]?.number, index >= 0, index.rounded() == index else { throw CloudSyncFailure.invalidResponse }
            content = .object(["personalParagraph": .object(["_0": .number(index)])])
        case "transcript": content = .object(["transcript": .object(["_0": .uuid(try row.requiredUUID("passageId"))])])
        case "title": content = .object(["title": .object([:])])
        case "summary":
            let id = try row.requiredUUID("summaryId")
            guard id == (try row.requiredUUID("revisionId")) else { throw CloudSyncFailure.invalidResponse }
            content = .object(["summary": .object(["_0": .uuid(id)])])
        default: throw CloudSyncFailure.unsupported
        }
        return SourceAnchor(libraryID: map.localLibraryID, noteID: localNoteID, revisionID: try row.requiredUUID("revisionId"),
            content: try JSONDecoder().decode(SourceAnchor.Content.self, from: content.data()))
    }
    private func ordered(_ summaries: [SummaryVersion]) throws -> [SummaryVersion] {
        var remaining = summaries, result: [SummaryVersion] = []
        guard Set(summaries.map(\.id)).count == summaries.count else { throw CloudSyncFailure.invalidResponse }
        while !remaining.isEmpty {
            guard let index = remaining.firstIndex(where: { $0.parentID == nil || result.map(\.id).contains($0.parentID!) }) else {
                throw CloudSyncFailure.invalidResponse
            }
            result.append(remaining.remove(at: index))
        }
        return result
    }
    private func seconds(_ row: CloudJSON, _ field: String) throws -> Double {
        guard let value = row[field]?.number, value.isFinite, value >= 0, value <= 9_007_199_254_740_991, value.rounded() == value else { throw CloudSyncFailure.invalidResponse }
        return value / 1000
    }
    private func date(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: value) else { throw CloudSyncFailure.invalidResponse }
        return date
    }
    private func legacy(_ row: CloudJSON, revisionID: UUID, generation: UUID, savedAt: Date) throws -> CloudDecodedNote {
        guard let meeting = row["legacyMeeting"], let segments = row["legacySegments"]?.list else { throw CloudSyncFailure.unsupported }
        var note = NoteRecord()
        note.id = localNoteID
        note.createdAt = (try? date(meeting.requiredString("created_at"))) ?? savedAt
        note.updatedAt = savedAt
        note.title = try meeting.requiredString("title")
        note.text = row["legacyNotes"]?["raw_content"]?["markdown"]?.string ?? ""
        note.captureState = .idle
        note.metadata = NoteMetadata(libraryID: map.localLibraryID, lifecycleGeneration: generation, revisionID: revisionID)
        note.metadata?.cloudTranscriptStatus = .partial
        if let enhanced = row["legacyNotes"]?["enhanced_content"]?["markdown"]?.string, !enhanced.isEmpty {
            // Existing desktop push stores AI-generated notes in this markdown envelope. No citations are invented.
            let summary = SummaryVersion(id: revisionID, parentID: nil, createdAt: savedAt, origin: .generated,
                format: "Imported desktop notes", language: note.language, text: enhanced, sources: [])
            note.metadata?.summaries = [summary]
            note.metadata?.selectedSummaryID = summary.id
        }
        note.passages = try segments.map { segment in
            let id = try segment.requiredUUID("id")
            return TranscriptPassage(id: id, start: try seconds(segment, "start_ms"), end: try seconds(segment, "end_ms"),
                text: try segment.requiredString("text"), isFinal: false, speakerName: segment["speaker"]?.string)
        }
        return CloudDecodedNote(note: note, sources: [NoteRevision(note)], isLegacy: true, isReadOnly: true)
    }
}
