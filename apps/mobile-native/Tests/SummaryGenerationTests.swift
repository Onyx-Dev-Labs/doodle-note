import XCTest
@testable import DoodleNoteNative

private actor SummaryFixtureEngine: LocalGenerationEngine {
    enum Mode: Sendable { case grounded, unsupported, inventedQuote, unsupportedClaim, malformed, slow }
    let mode: Mode
    private(set) var requests: [(String, SpokenLanguage)] = []
    init(_ mode: Mode = .grounded) { self.mode = mode }
    func readiness(language: SpokenLanguage) -> GenerationReadiness {
        .init(available: mode != .unsupported, detail: "Fixture model unavailable")
    }
    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        if mode == .slow { try await Task.sleep(for: .seconds(30)) }
        requests.append((source, language))
        if mode == .malformed { return "not valid JSON" }
        let values = try JSONSerialization.jsonObject(with: Data(source.utf8)) as! [[String: Any]]
        let items = values.prefix(6).map { value -> [String: Any] in
            let text = value["text"] as! String
            return ["kind": mode == .unsupportedClaim ? "action" : "point", "text": mode == .unsupportedClaim ? "Alice will deliver Friday" : text, "source": value["id"]!,
                    "quote": mode == .inventedQuote ? "not in the supplied source" : text]
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: ["items": items]), as: UTF8.self)
    }
}

final class SummaryGenerationTests: XCTestCase {
    func testSixFormatsFiveLanguagesPreserveSourceAnchorsAndRequestedLanguage() async throws {
        var note = NoteRecord(); note.text = "The team discussed the launch."
        note.passages = [.init(start: 0, end: 2, text: "No owner or deadline was assigned.", isFinal: true)]
        for format in MeetingFormat.allCases {
            for language in SpokenLanguage.allCases {
                let engine = SummaryFixtureEngine()
                let draft = try await SummaryGenerator(engine: engine).generate(note: note, format: format, language: language) { _, _ in }
                XCTAssertEqual(draft.language, language)
                XCTAssertEqual(draft.format, format)
                XCTAssertEqual(draft.sources.count, 2)
                XCTAssertEqual(draft.sources[0].content, .personalParagraph(0))
                XCTAssertEqual(draft.sources[1].content, .transcript(note.passages[0].id))
                XCTAssertEqual(draft.sources[0].revisionID, note.metadata?.revisionID)
                let requests = await engine.requests
                XCTAssertTrue(requests.allSatisfy { $0.1 == language })
                XCTAssertEqual(note.language, .english)
            }
        }
    }

    func testLongInputVisitsEveryFragmentAndMarksUnfinishedTranscript() async throws {
        var note = NoteRecord()
        note.text = (0..<100).map { "Paragraph \($0): " + String(repeating: "source ", count: 40) }.joined(separator: "\n")
        note.passages = [.init(start: 0, end: 1, text: "Still provisional", isFinal: false)]
        let expected = try SummaryGenerator.sources(note)
        let engine = SummaryFixtureEngine()
        let draft = try await SummaryGenerator(engine: engine).generate(note: note, format: .general, language: .english) { _, _ in }
        let requests = await engine.requests
        let ids = try requests.flatMap { value -> [Int] in
            let input = try JSONSerialization.jsonObject(with: Data(value.0.utf8)) as! [[String: Any]]
            return input.map { $0["id"] as! Int }
        }
        XCTAssertEqual(ids, expected.map(\.id))
        XCTAssertTrue(requests.allSatisfy { $0.0.utf8.count <= 2_200 })
        XCTAssertEqual(draft.processedParts, draft.totalParts)
        XCTAssertTrue(draft.incomplete)
        XCTAssertTrue(draft.text.contains("Incomplete source"))
    }

    func testValidQuoteDoesNotValidateUnsupportedAction() async throws {
        var note = NoteRecord(); note.text = "No owner or deadline was assigned."
        let draft = try await SummaryGenerator(engine: SummaryFixtureEngine(.unsupportedClaim)).generate(note: note, format: .general, language: .english) { _, _ in }
        XCTAssertTrue(draft.text.contains("Draft. Review decisions, owners and dates against the sources."))
        XCTAssertTrue(draft.text.contains("Possible actions to verify"))
        XCTAssertTrue(draft.text.contains("> No owner or deadline was assigned."))
        XCTAssertFalse(draft.text.contains("## Action checklist"))
        // The structural quote validator does not prove entailment. Keep the contradictory
        // evidence visible and the model's candidate explicitly unverified for human review.
    }

    func testFinishedRecordingWithoutTranscriptWarnsEvenWithTypedNotes() async throws {
        var note = NoteRecord(); note.captureState = .finished; note.text = "My personal notes."
        let draft = try await SummaryGenerator(engine: SummaryFixtureEngine()).generate(note: note, format: .general, language: .english) { _, _ in }
        XCTAssertTrue(draft.incomplete)
        XCTAssertTrue(draft.text.contains("transcription is missing or not final"))
    }

    func testImportedTranscriptStatusDoesNotImplyLocalRecording() async throws {
        for status in [TranscriptCompletion.none, .partial, .interrupted, .complete] {
            var note = NoteRecord(); note.text = "Imported personal text."
            note.passages = [.init(start: 0, end: 1, text: "Saved passage.", isFinal: true)]
            note.metadata?.cloudTranscriptStatus = status
            let draft = try await SummaryGenerator(engine: SummaryFixtureEngine()).generate(note: note, format: .general, language: .english) { _, _ in }
            XCTAssertEqual(draft.incomplete, status == .partial || status == .interrupted)
            XCTAssertEqual(note.captureState, .idle)
        }
    }

    func testOnlyStableUnambiguousSpeakerContextEntersPrompt() async throws {
        var note = NoteRecord()
        let passage = TranscriptPassage(start: 0, end: 3, text: "I can help review.", isFinal: true)
        note.passages = [passage]
        let session = UUID()
        let turn = SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true)
        note.speakerAnnotations = .init(turns: [turn], names: [turn.key: "Morgan"])
        let engine = SummaryFixtureEngine()
        let draft = try await SummaryGenerator(engine: engine).generate(note: note, format: .general, language: .english) { _, _ in }
        let requests = await engine.requests
        XCTAssertTrue(requests[0].0.contains("Morgan"))
        XCTAssertTrue(draft.text.contains("> Morgan: I can help review."))
        note.speakerAnnotations?.turns[0].isFinal = false
        XCTAssertNil(try SummaryGenerator.sources(note).first?.speaker)
        note.speakerAnnotations?.turns[0].isFinal = true
        note.speakerAnnotations?.turns.append(.init(sessionID: session, slot: 1, start: 1, end: 2, isFinal: true))
        XCTAssertNil(try SummaryGenerator.sources(note).first?.speaker)
    }

    func testUnavailableModelAndInventedQuoteFailWithoutProducingDraft() async throws {
        var note = NoteRecord(); note.text = "The original fact."
        for mode in [SummaryFixtureEngine.Mode.unsupported, .inventedQuote, .malformed] {
            do {
                _ = try await SummaryGenerator(engine: SummaryFixtureEngine(mode)).generate(note: note, format: .general, language: .english) { _, _ in }
                XCTFail("Invalid or unavailable generation must fail")
            } catch {}
        }
        XCTAssertEqual(note.text, "The original fact.")
    }
}

@MainActor final class SummaryControllerTests: XCTestCase {
    private func finish(_ controller: SummaryController) async throws {
        for _ in 0..<500 where controller.busy { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertFalse(controller.busy)
    }
    func testEditedVersionNeedsConfirmationAndRemainsRetained() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let original = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated,
            format: "general", language: .english, text: "Original summary", sources: [])
        let previous = SummaryVersion(id: UUID(), parentID: original.id, createdAt: Date(), origin: .edited,
            format: "general", language: .english, text: "My carefully edited summary", sources: [])
        library.update(id) { $0.text = "Original meeting text"; $0.metadata?.summaries = [original, previous]; $0.metadata?.selectedSummaryID = previous.id }
        let saved = await library.flush(); XCTAssertTrue(saved)
        let controller = SummaryController(engine: SummaryFixtureEngine())
        controller.generate(noteID: id, library: library, format: .status, language: .french)
        try await finish(controller)
        XCTAssertNotNil(controller.draft)
        let refused = await controller.save(noteID: id, library: library, replaceEdited: false)
        XCTAssertFalse(refused)
        XCTAssertEqual(library.note(id)?.metadata?.selectedSummaryID, previous.id)
        let accepted = await controller.save(noteID: id, library: library, replaceEdited: true)
        XCTAssertTrue(accepted)
        let versions = try XCTUnwrap(library.note(id)?.metadata?.summaries)
        XCTAssertEqual(versions.count, 3); XCTAssertEqual(versions[1], previous)
        XCTAssertNil(versions.last?.parentID)
        XCTAssertEqual(versions.last?.language, .french)
        XCTAssertEqual(library.note(id)?.text, "Original meeting text")
        let reopened = NoteLibrary(root: root); await reopened.waitUntilLoaded()
        XCTAssertEqual(reopened.note(id)?.metadata?.summaries, versions)
    }

    func testCancellationAndChangedSourceCannotReplaceVersions() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); library.update(id) { $0.text = "Before edit" }
        let controller = SummaryController(engine: SummaryFixtureEngine(.slow))
        controller.generate(noteID: id, library: library, format: .general, language: .english)
        controller.cancel(); try await finish(controller)
        XCTAssertNil(controller.draft); XCTAssertTrue(library.note(id)?.metadata?.summaries.isEmpty == true)
        let fast = SummaryController(engine: SummaryFixtureEngine())
        fast.generate(noteID: id, library: library, format: .general, language: .english)
        try await finish(fast)
        library.update(id) { $0.text = "After edit" }
        let saved = await fast.save(noteID: id, library: library, replaceEdited: true)
        XCTAssertFalse(saved); XCTAssertTrue(library.note(id)?.metadata?.summaries.isEmpty == true)
    }
    func testAuthenticationChangeRejectsDraftAndOriginalCitationStillResolvesAfterEdits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); library.update(id) { $0.text = "Immutable original." }
        let controller = SummaryController(engine: SummaryFixtureEngine())
        controller.generate(noteID: id, library: library, format: .general, language: .english)
        try await finish(controller)
        let anchor = try XCTUnwrap(controller.draft?.sources.first)
        try await library.authenticate(.init(accountID: "fixture", workspaceID: "fixture"), name: "Fixture")
        let saved = await controller.save(noteID: id, library: library, replaceEdited: true)
        XCTAssertFalse(saved)
        XCTAssertTrue(library.note(id)?.metadata?.summaries.isEmpty == true)
        library.update(id) { $0.text = "Changed personal text." }
        let persisted = await library.flush(); XCTAssertTrue(persisted)
        let original = try await library.resolveSearchSource(anchor)
        XCTAssertEqual(original, "Immutable original.")
    }

    func testSaveFailureLeavesVersionPendingAndRetryPersistsItOnce() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); library.update(id) { $0.text = "Original content." }
        let controller = SummaryController(engine: SummaryFixtureEngine())
        controller.generate(noteID: id, library: library, format: .general, language: .english)
        try await finish(controller)
        let file = root.appendingPathComponent(id.uuidString).appendingPathComponent("note.json")
        let backup = file.appendingPathExtension("fixture-backup")
        try FileManager.default.moveItem(at: file, to: backup)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        let saved = await controller.save(noteID: id, library: library, replaceEdited: false)
        XCTAssertFalse(saved); XCTAssertNotNil(controller.problem)
        XCTAssertEqual(library.note(id)?.metadata?.summaries.count, 1)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: backup, to: file)
        library.retrySaving()
        let retried = await library.flush(); XCTAssertTrue(retried)
        await controller.refreshSaveState(noteID: id, library: library)
        XCTAssertNil(controller.problem)
        let reopened = NoteLibrary(root: root); await reopened.waitUntilLoaded()
        XCTAssertEqual(reopened.note(id)?.metadata?.summaries.count, 1)
        XCTAssertEqual(reopened.note(id)?.text, "Original content.")
    }

    func testUnrelatedUnsavedNoteDoesNotBlockSavedSourceOrSummary() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); library.update(id) { $0.text = "Saved summary source." }
        let other = try XCTUnwrap(library.create()); let initial = await library.flush(); XCTAssertTrue(initial)
        let file = root.appendingPathComponent(other.uuidString).appendingPathComponent("note.json")
        let backup = file.appendingPathExtension("fixture-backup")
        try FileManager.default.moveItem(at: file, to: backup)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        library.update(other) { $0.text = "Preserve this pending edit." }
        let controller = SummaryController(engine: SummaryFixtureEngine())
        controller.generate(noteID: id, library: library, format: .general, language: .english)
        try await finish(controller); XCTAssertNotNil(controller.draft)
        let saved = await controller.save(noteID: id, library: library, replaceEdited: false)
        XCTAssertTrue(saved)
        XCTAssertEqual(library.note(other)?.text, "Preserve this pending edit.")
        try FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: backup, to: file)
        library.retrySaving(); let retried = await library.flush(); XCTAssertTrue(retried)
    }

}
