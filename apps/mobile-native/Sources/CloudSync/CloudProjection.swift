import CryptoKit
import Foundation

/// Explicit allowlist. Audio files, voice profiles, model configuration and account credentials
/// have no representation here and cannot be included by encoding NoteRecord accidentally.
struct CloudProjection {
    let map: CloudIdentityMap
    let remoteNoteID: UUID

    func snapshot(note: NoteRecord, retained: [NoteRevision], inkReferences: [CloudJSON],
                  retainedWireSources: [UUID: CloudJSON] = [:], remoteFolderID: UUID? = nil) throws -> CloudJSON {
        guard let metadata = note.metadata, metadata.libraryID == map.localLibraryID,
              note.passages.count <= 20_000, note.text.utf16.count <= 500_000, metadata.summaries.count <= 100, inkReferences.count <= 1000 else {
            throw CloudSyncFailure.unsupported
        }
        let current = NoteRevision(note)
        var needed = Set([current.id])
        for summary in metadata.summaries {
            for anchor in summary.sources {
                let wire = try source(anchor, localNoteID: note.id)
                if wire["kind"]?.string != "summary" { needed.insert(anchor.revisionID) }
            }
        }
        guard needed.count <= 100 else { throw CloudSyncFailure.unsupported }
        var revisions = Dictionary(uniqueKeysWithValues: retained.map { ($0.id, $0) })
        revisions[current.id] = current
        let sources = try needed.sorted { $0.uuidString < $1.uuidString }.map { id -> CloudJSON in
            guard let revision = revisions[id], revision.libraryID == map.localLibraryID, revision.noteID == note.id else {
                throw LibraryDataError.immutableHistory
            }
            // Retained wire versions retain exact original speaker identifiers and fields.
            if let original = retainedWireSources[id] { return original }
            return try sourceVersion(revision)
        }
        let head = try sources.first(where: { $0["id"]?.string == current.id.uuidString.lowercased() })
            .unwrapCloud()
        let summaries = try metadata.summaries.map { summary -> CloudJSON in
            var row: [String: CloudJSON] = ["id": .uuid(summary.id), "createdAt": .string(date(summary.createdAt)),
                "origin": .string(summary.origin.rawValue), "format": .string(summary.format),
                "language": .string(summary.language.rawValue), "markdown": .string(summary.text),
                "sources": .array(try summary.sources.map { try source($0, localNoteID: note.id) })]
            if let parent = summary.parentID { row["parentId"] = .uuid(parent) }
            return .object(row)
        }
        var value: [String: CloudJSON] = ["title": .string(note.title),
            "kind": .string(note.captureState == .idle && note.passages.isEmpty ? "note" : "meeting"),
            "transcriptStatus": .string(transcriptStatus(note)),
            "createdAt": .string(date(note.createdAt)), "language": .string(note.language.rawValue), "text": .string(note.text),
            "sourceRevisionId": .uuid(current.id), "sourceVersions": .array(sources),
            "selectedSummaryId": metadata.selectedSummaryID.map(CloudJSON.uuid) ?? .null,
            "passages": try head["passages"].unwrapCloud(), "speakers": try head["speakers"].unwrapCloud(),
            "speakerTurns": head["speakerTurns"] ?? .array([]), "summaries": .array(summaries),
            "inkAttachments": .array(inkReferences)]
        if let event = metadata.event {
            value["event"] = .object(["provider": .string(event.provider), "accountId": .string(event.accountID),
                "calendarId": .string(event.calendarID), "eventId": .string(event.eventID), "occurrenceId": .string(event.occurrenceID)])
        }
        // Preserve existing remote folder membership without sending local UUIDs as remote ownership.
        if let remoteFolderID { value["folderId"] = .uuid(remoteFolderID) }
        let result = CloudJSON.object(value)
        guard try result.data().count < 1_990_000 else { throw CloudSyncFailure.unsupported }
        return result
    }

    private func transcriptStatus(_ note: NoteRecord) -> String {
        if let imported = note.metadata?.cloudTranscriptStatus { return imported.rawValue }
        if note.captureState == .interrupted { return "interrupted" }
        if note.captureState == .idle && note.passages.isEmpty { return "none" }
        return "partial"
    }

    private func sourceVersion(_ revision: NoteRevision) throws -> CloudJSON {
        let annotations = revision.speakerAnnotations ?? SpeakerAnnotations()
        let keys = annotations.speakerKeys
        let identifiers = Dictionary(uniqueKeysWithValues: keys.map { ($0, speakerID($0)) })
        var speakers = try keys.map { key -> CloudJSON in
            let parts = key.split(separator: ":")
            guard parts.count == 2, let session = UUID(uuidString: String(parts[0])),
                  let slot = Int(parts[1]), (0..<4).contains(slot) else { throw CloudSyncFailure.invalidResponse }
            return .object(["id": .uuid(identifiers[key]!), "displayName": .string(annotations.name(for: key)),
                "sessionId": .uuid(session), "slot": .number(Double(slot))])
        }
        let namedPassages = Set(revision.passages.compactMap(\.speakerName).filter { !$0.isEmpty })
        for name in namedPassages.sorted() {
            speakers.append(.object(["id": .uuid(speakerID("label:" + name)), "displayName": .string(name)]))
        }
        let turns = try annotations.turns.map { turn -> CloudJSON in
            guard let id = identifiers[turn.key] else { throw CloudSyncFailure.invalidResponse }
            return .object(["speakerId": .uuid(id), "startMs": .number(try milliseconds(turn.start)),
                "endMs": .number(try milliseconds(turn.end)), "isFinal": .bool(turn.isFinal)])
        }
        let passages = try revision.passages.map { passage -> CloudJSON in
            var row: [String: CloudJSON] = ["id": .uuid(passage.id), "sourceId": .uuid(passage.id),
                "text": .string(passage.text), "isFinal": .bool(passage.isFinal), "startMs": .number(try milliseconds(passage.start)),
                "endMs": .number(try milliseconds(passage.end))]
            if let key = assignedSpeaker(passage, annotations: annotations), let id = identifiers[key] {
                row["speakerId"] = .uuid(id)
            } else if let name = passage.speakerName, !name.isEmpty {
                row["speakerId"] = .uuid(speakerID("label:" + name))
            }
            return .object(row)
        }
        return .object(["id": .uuid(revision.id), "title": .string(revision.title), "text": .string(revision.text),
                        "passages": .array(passages), "speakers": .array(speakers), "speakerTurns": .array(turns)])
    }

    private func source(_ anchor: SourceAnchor, localNoteID: UUID) throws -> CloudJSON {
        guard anchor.noteID == localNoteID, anchor.libraryID == map.localLibraryID else { throw LibraryDataError.invalidOwnership }
        let content = try JSONDecoder().decode(CloudJSON.self, from: JSONEncoder().encode(anchor.content))
        var row: [String: CloudJSON] = ["libraryId": .uuid(map.remoteLibraryID), "noteId": .uuid(remoteNoteID),
                                      "revisionId": .uuid(anchor.revisionID)]
        if let paragraph = content["personalParagraph"]?["_0"]?.number {
            row["kind"] = .string("personalParagraph"); row["paragraphIndex"] = .number(paragraph)
        } else if let passage = content["transcript"]?["_0"]?.string, let id = UUID(uuidString: passage) {
            row["kind"] = .string("transcript"); row["passageId"] = .uuid(id)
        } else if content["title"] != nil { row["kind"] = .string("title") }
        else if let summary = content["summary"]?["_0"]?.string, let id = UUID(uuidString: summary), id == anchor.revisionID {
            row["kind"] = .string("summary"); row["summaryId"] = .uuid(id)
        } else { throw CloudSyncFailure.unsupported }
        return .object(row)
    }
    private func milliseconds(_ seconds: Double) throws -> Double {
        guard seconds.isFinite, seconds >= 0, seconds * 1000 < 9_007_199_254_740_991 else { throw CloudSyncFailure.invalidResponse }
        return (seconds * 1000).rounded()
    }
    private func speakerID(_ key: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data(("doodlenote-speaker:" + (key.hasPrefix("label:") ? key : key.lowercased())).utf8)).prefix(16))
        bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80
        return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],
                           bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
    }
    private func assignedSpeaker(_ passage: TranscriptPassage, annotations: SpeakerAnnotations) -> String? {
        let duration = passage.end - passage.start
        guard duration > 0 else { return nil }
        let grouped = Dictionary(grouping: annotations.turns.filter { $0.start < passage.end && $0.end > passage.start }, by: \.key)
        let coverage = grouped.mapValues { turns -> Double in
            var end = passage.start
            return turns.sorted { $0.start < $1.start }.reduce(0) { total, turn in
                let contribution = max(0, min(turn.end, passage.end) - max(end, max(turn.start, passage.start)))
                end = max(end, min(turn.end, passage.end))
                return total + contribution
            }
        }
        let active = coverage.filter { $0.value / duration >= 0.1 }
        guard active.count == 1, let candidate = active.first, candidate.value / duration >= 0.65 else { return nil }
        return candidate.key
    }
    private func date(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: value)
    }
}

private extension Optional {
    func unwrapCloud() throws -> Wrapped {
        guard let self else { throw CloudSyncFailure.invalidResponse }
        return self
    }
}
