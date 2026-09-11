import Foundation
import Observation

@MainActor @Observable final class AskController {
    private let generator: AskGenerator
    private var task: Task<Void, Never>?
    private var token = UUID()
    private(set) var busy = false
    private(set) var canceled = false
    private(set) var completed = 0
    private(set) var total = 0
    private(set) var answer: AskAnswer?
    private(set) var identity = ""
    private(set) var problem: String?

    init(engine: any LocalGenerationEngine = AppleLocalGeneration()) { generator = AskGenerator(engine: engine) }
    func ask(_ question: String, noteID: UUID?, language: SpokenLanguage, library: NoteLibrary) {
        guard !busy else { return }
        let request = UUID(); token = request
        busy = true; canceled = false; answer = nil; problem = nil; completed = 0; total = 0
        let startingLibrary = library.selectedLibraryID
        let authentication = library.authenticationGeneration
        task = Task {
            defer { busy = false; task = nil }
            do {
                if let noteID {
                    guard await library.flush(noteID: noteID) else { throw AskFailure.changed }
                } else {
                    // A failed save remains excluded and counted as unavailable by searchInput.
                    _ = await library.flush()
                }
                try Task.checkCancellation()
                guard library.selectedLibraryID == startingLibrary, library.authenticationGeneration == authentication else { throw AskFailure.changed }
                let snapshotIdentity = NoteSearchController.identity(library)
                var input = library.searchInput(generation: 0)
                if let noteID {
                    input = NoteSearchInput(libraryID: input.libraryID, authorized: input.authorized,
                        generation: 0, notes: input.notes.filter { $0.id == noteID },
                        unavailableCount: input.notes.contains { $0.id == noteID } ? 0 : 1,
                        incompleteReason: input.incompleteReason)
                }
                let value = try await generator.answer(question: question, input: input, language: language) { [weak self] done, count in
                    await self?.progress(done, count, request: request)
                }
                try Task.checkCancellation()
                guard token == request, snapshotIdentity == NoteSearchController.identity(library) else { throw AskFailure.changed }
                identity = snapshotIdentity; answer = value
            } catch is CancellationError { canceled = true }
            catch { if token == request { problem = error.localizedDescription } }
        }
    }
    private func progress(_ done: Int, _ count: Int, request: UUID) {
        guard token == request else { return }
        completed = done; total = count
    }
    func cancel() {
        token = UUID(); task?.cancel(); answer = nil; problem = nil
        if busy { canceled = true }
    }
}

@MainActor enum AskCitationAccess {
    static func resolve(_ anchor: SourceAnchor, library: NoteLibrary,
                        reader: (@MainActor (SourceAnchor) async throws -> String?)? = nil) async throws -> String? {
        let selection = library.selectedLibraryID
        let authentication = library.authenticationGeneration
        guard anchor.libraryID == selection else { throw NoteSearchError.unauthorized }
        let text: String?
        if let reader { text = try await reader(anchor) }
        else { text = try await library.resolveSearchSource(anchor) }
        try Task.checkCancellation()
        guard library.selectedLibraryID == selection, library.authenticationGeneration == authentication else { throw NoteSearchError.stale }
        return text
    }
}
