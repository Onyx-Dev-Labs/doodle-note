import Foundation
import Observation

@MainActor @Observable final class NoteSearchController {
    private let index: NoteSearchIndex
    private var generation: UInt64 = 0
    private(set) var result: NoteSearchResult?
    private(set) var resultIdentity = ""
    private(set) var searching = false
    private(set) var problem: String?

    init(root: URL) { index = NoteSearchIndex(root: root) }

    static func identity(_ library: NoteLibrary) -> String {
        let input = library.searchInput(generation: 0)
        return ([input.libraryID.uuidString, library.authenticationGeneration.uuidString,
                 String(input.unavailableCount), input.incompleteReason ?? ""] +
                input.notes.map { $0.id.uuidString + ":" + ($0.metadata?.revisionID.uuidString ?? "") }).joined(separator: "|")
    }

    func search(_ query: String, library: NoteLibrary, limit: Int = 100) async {
        generation += 1
        let request = generation
        defer { if request == generation { searching = false } }
        let identity = Self.identity(library)
        let input = library.searchInput(generation: request)
        searching = true
        result = nil
        problem = nil
        do {
            let value = try await index.search(query, input: input, limit: limit)
            guard request == generation, identity == Self.identity(library), !Task.isCancelled else { return }
            result = value
            resultIdentity = identity
        } catch is CancellationError {} catch {
            if request == generation && identity == Self.identity(library) { problem = error.localizedDescription }
        }
        if request == generation { searching = false }
    }

    func cancel() {
        generation += 1
        let value = generation
        result = nil
        searching = false
        Task { await index.invalidate(generation: value) }
    }
}
