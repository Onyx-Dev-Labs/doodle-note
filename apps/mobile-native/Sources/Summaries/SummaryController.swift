import Foundation
import Observation

@MainActor @Observable final class SummaryController {
    private let generator: SummaryGenerator
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private(set) var busy = false
    private(set) var draft: SummaryDraft?
    private(set) var problem: String?
    private(set) var completed = 0
    private(set) var total = 0
    private(set) var selectedAtStart: UUID?
    private var authentication: UUID?
    private var waitingForSave = false
    private static let saveProblem = "The new version is waiting to be saved. Keep the app open and retry saving."

    init(engine: any LocalGenerationEngine = AppleLocalGeneration()) { generator = SummaryGenerator(engine: engine) }

    func generate(noteID: UUID, library: NoteLibrary, format: MeetingFormat, language: SpokenLanguage) {
        guard !busy else { return }
        let token = UUID(); generation = token
        let identity = library.authenticationGeneration
        authentication = identity
        waitingForSave = false
        busy = true; draft = nil; problem = nil; completed = 0; total = 0
        task = Task {
            defer { if generation == token { busy = false; task = nil } }
            do {
                guard await library.flush(noteID: noteID), !Task.isCancelled,
                      library.authenticationGeneration == identity,
                      let note = library.note(noteID) else { throw SummaryFailure.changed }
                selectedAtStart = note.metadata?.selectedSummaryID
                let result = try await generator.generate(note: note, format: format, language: language) { [weak self] done, count in
                    await self?.progress(done, count, token: token)
                }
                guard generation == token, !Task.isCancelled, library.authenticationGeneration == identity,
                      library.note(noteID)?.metadata?.revisionID == result.sourceRevision else { throw SummaryFailure.changed }
                draft = result
            } catch is CancellationError {} catch {
                if generation == token { problem = error.localizedDescription }
            }
        }
    }

    private func progress(_ done: Int, _ count: Int, token: UUID) {
        guard generation == token else { return }
        completed = done; total = count
    }

    func cancel() {
        waitingForSave = false
        generation = UUID(); task?.cancel(); task = nil; busy = false; draft = nil
        problem = "Summary generation canceled. Your notes and previous versions are preserved."
    }

    func save(noteID: UUID, library: NoteLibrary, replaceEdited: Bool) async -> Bool {
        guard let draft, authentication == library.authenticationGeneration,
              let note = library.note(noteID), note.metadata?.revisionID == draft.sourceRevision,
              note.metadata?.selectedSummaryID == selectedAtStart else { problem = SummaryFailure.changed.localizedDescription; return false }
        let selected = note.metadata?.summaries.first { $0.id == selectedAtStart }
        guard selected?.origin != .edited || replaceEdited else { return false }
        let version = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated,
            format: draft.format.rawValue, language: draft.language, text: draft.text, sources: draft.sources)
        guard library.update(noteID, { note in
            note.metadata?.summaries.append(version)
            note.metadata?.selectedSummaryID = version.id
        }) else { problem = SummaryFailure.changed.localizedDescription; return false }
        self.draft = nil
        let token = generation, identity = authentication
        let saved = await library.flush(noteID: noteID)
        if !saved, generation == token, authentication == identity,
           library.authenticationGeneration == identity {
            waitingForSave = true; problem = Self.saveProblem
        }
        return saved
    }
    func refreshSaveState(noteID: UUID, library: NoteLibrary) async {
        guard waitingForSave else { return }
        let token = generation
        guard await library.flush(noteID: noteID), generation == token,
              authentication == library.authenticationGeneration else { return }
        waitingForSave = false
        if problem == Self.saveProblem { problem = nil }
    }

}
