import Foundation
import CryptoKit

struct NoteSearchInput: Sendable {
    let libraryID: UUID
    let authorized: Bool
    /// Monotonically increases for this index instance, including account/scope invalidation.
    let generation: UInt64
    let notes: [NoteRecord]
    var unavailableCount = 0
    var incompleteReason: String? = nil
}

struct NoteSearchHit: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let text: String
    let source: SourceAnchor
}

struct NoteSearchResult: Sendable {
    let libraryID: UUID
    let generation: UInt64
    let hits: [NoteSearchHit]
    let matchedNoteIDs: [UUID]
    let countsAreComplete: Bool
    let matchedNoteCount: Int
    let matchedSourceCount: Int
    let eligibleNoteCount: Int
    let unavailableCount: Int
    let isExhaustive: Bool
    let incompleteReason: String?
}

enum NoteSearchError: LocalizedError {
    case stale, unauthorized, invalidSnapshot
    var errorDescription: String? {
        switch self {
        case .stale: "The library changed. Search again."
        case .unauthorized: "This library is no longer connected."
        case .invalidSnapshot: "Some notes could not be indexed. Their originals are preserved."
        }
    }
}

/// Rebuildable lexical cache. Every query reconciles the entire eligible source set first.
/// Audio, drawing bytes, voice profiles and credentials are never serialized into this cache.
actor NoteSearchIndex {
    private struct Document: Codable {
        let noteID: UUID
        let revisionID: UUID
        let selectedSummaryID: UUID?
        let hits: [NoteSearchHit]
        let checksum: String
    }
    private struct Cache: Codable {
        var schemaVersion = 1
        let libraryID: UUID
        var documents: [Document]
    }
    private let root: URL
    private var latestGeneration: UInt64 = 0
    private var caches: [UUID: Cache] = [:]

    init(root: URL) { self.root = root }

    func invalidate(generation: UInt64) {
        guard generation >= latestGeneration else { return }
        latestGeneration = generation
        caches = [:]
    }

    func search(_ query: String, input: NoteSearchInput, limit: Int? = 100) throws -> NoteSearchResult {
        guard input.generation >= latestGeneration else { throw NoteSearchError.stale }
        latestGeneration = input.generation
        guard input.authorized else { caches = [:]; throw NoteSearchError.unauthorized }
        guard Set(input.notes.map(\.id)).count == input.notes.count,
              input.notes.allSatisfy({ note in
                  note.schemaVersion == 2 && note.metadata?.libraryID == input.libraryID &&
                  Set(note.passages.map(\.id)).count == note.passages.count &&
                  Set(note.metadata!.summaries.map(\.id)).count == note.metadata!.summaries.count
              }) else { throw NoteSearchError.invalidSnapshot }
        try Task.checkCancellation()
        var cache = caches[input.libraryID] ?? load(input.libraryID)
        let old = Dictionary(cache.documents.map { ($0.noteID, $0) }, uniquingKeysWith: { first, _ in first })
        var updated: [Document] = []
        var changed = false
        for note in input.notes {
            try Task.checkCancellation()
            guard let metadata = note.metadata else { throw NoteSearchError.invalidSnapshot }
            if let existing = old[note.id], existing.revisionID == metadata.revisionID,
               existing.selectedSummaryID == metadata.selectedSummaryID {
                updated.append(existing)
            } else {
                updated.append(Self.document(note))
                changed = true
            }
        }
        // Removal is as important as addition: Trash/sign-out cannot survive as searchable cache rows.
        if Set(old.keys) != Set(updated.map(\.noteID)) { changed = true }
        cache.documents = updated
        caches[input.libraryID] = cache
        let missingSummaries = input.notes.filter { note in
            guard let metadata = note.metadata, let selected = metadata.selectedSummaryID else { return false }
            return !metadata.summaries.contains { $0.id == selected }
        }.count
        var warning = input.incompleteReason
        if missingSummaries > 0 { warning = "Some selected summary versions are unavailable. Search totals may be incomplete." }
        if changed {
            do { try persist(cache) }
            catch { warning = "The search cache could not be saved. Results are available now and will be rebuilt next time." }
        }
        let terms = Self.normalized(query).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var hits: [NoteSearchHit] = []
        var noteIDs = Set<UUID>()
        for document in updated {
            try Task.checkCancellation()
            let fullText = Self.normalized(document.hits.map { $0.title + " " + $0.text }.joined(separator: "\n"))
            guard terms.allSatisfy({ fullText.contains($0) }) else { continue }
            noteIDs.insert(document.noteID)
            for hit in document.hits {
                let searchable = Self.normalized(hit.title + " " + hit.text)
                if terms.isEmpty || terms.contains(where: { searchable.contains($0) }) { hits.append(hit) }
            }
        }
        hits.sort { ($0.title, $0.id) < ($1.title, $1.id) }
        let total = hits.count
        let visible = limit.map { Array(hits.prefix(max(0, $0))) } ?? hits
        let complete = input.unavailableCount == 0 && input.incompleteReason == nil && missingSummaries == 0
        return NoteSearchResult(libraryID: input.libraryID, generation: input.generation,
            hits: visible, matchedNoteIDs: noteIDs.sorted { $0.uuidString < $1.uuidString }, countsAreComplete: complete, matchedNoteCount: noteIDs.count, matchedSourceCount: total,
            eligibleNoteCount: input.notes.count, unavailableCount: input.unavailableCount + missingSummaries,
            isExhaustive: complete && visible.count == total, incompleteReason: warning)
    }

    private static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func document(_ note: NoteRecord) -> Document {
        let metadata = note.metadata!
        var hits: [NoteSearchHit] = []
        func append(_ text: String, kind: SourceAnchor.Content, key: String, sourceRevision: UUID? = nil) {
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            hits.append(NoteSearchHit(id: note.id.uuidString + "/" + metadata.revisionID.uuidString + "/" + key,
                title: note.title, text: text,
                source: SourceAnchor(libraryID: metadata.libraryID, noteID: note.id, revisionID: sourceRevision ?? metadata.revisionID, content: kind)))
        }
        append(note.title, kind: .title, key: "title")
        for (index, paragraph) in note.text.components(separatedBy: "\n").enumerated() {
            append(paragraph, kind: .personalParagraph(index), key: "p\(index)")
        }
        for passage in note.passages { append(passage.text, kind: .transcript(passage.id), key: "t" + passage.id.uuidString) }
        if let id = metadata.selectedSummaryID, let summary = metadata.summaries.first(where: { $0.id == id }) {
            append(summary.text, kind: .summary(id), key: "s" + id.uuidString, sourceRevision: id)
        }
        return Document(noteID: note.id, revisionID: metadata.revisionID, selectedSummaryID: metadata.selectedSummaryID, hits: hits, checksum: checksum(hits))
    }

    private static func checksum(_ hits: [NoteSearchHit]) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let bytes = (try? encoder.encode(hits)) ?? Data()
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private func load(_ id: UUID) -> Cache {
        let file = root.appendingPathComponent(id.uuidString + ".json")
        guard let bytes = try? Data(contentsOf: file), let value = try? JSONDecoder().decode(Cache.self, from: bytes),
              value.schemaVersion == 1, value.libraryID == id,
              Set(value.documents.map(\.noteID)).count == value.documents.count,
              value.documents.allSatisfy({ document in
                  document.checksum == Self.checksum(document.hits) && document.hits.allSatisfy { hit in
                      guard hit.source.libraryID == id && hit.source.noteID == document.noteID else { return false }
                      if case .summary(let summaryID) = hit.source.content { return hit.source.revisionID == summaryID }
                      return hit.source.revisionID == document.revisionID }
              }) else { return Cache(libraryID: id, documents: []) }
        return value
    }

    private func persist(_ cache: Cache) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var directory = root
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try JSONEncoder().encode(cache).write(to: root.appendingPathComponent(cache.libraryID.uuidString + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
