import AVFoundation
import XCTest
@testable import DoodleNoteNative

final class TranscriptMergeTests: XCTestCase {
    func testFiveLanguageCorrectionsSurviveFinalizationAndCodingWithStableAnchors() throws {
        for text in ["Reviewed English", "Rettet dansk æøå", "Español corregido", "Français corrigé", "Deutsch korrigiert"] {
            var note = NoteRecord()
            let passage = TranscriptPassage(start: 0, end: 2, text: "draft", isFinal: false)
            note.apply(passage)
            note.correctPassage(id: passage.id, text: text)
            XCTAssertTrue(note.apply(.init(start: 0, end: 2, text: "model final", isFinal: true)))
            let reopened = try JSONDecoder().decode(NoteRecord.self, from: JSONEncoder().encode(note))
            XCTAssertEqual(reopened.passages.count, 1)
            XCTAssertEqual(reopened.passages[0].id, passage.id)
            XCTAssertEqual(reopened.passages[0].text, text)
            XCTAssertTrue(reopened.passages[0].isFinal)
            XCTAssertEqual(reopened.passages[0].isUserEdited, true)
        }
    }
    func testProvisionalIDsRemainStableAndFinalOverlapNeverErasesUncoveredText() {
        var note = NoteRecord()
        let first = TranscriptPassage(start: 0, end: 10, text: "original words", isFinal: false)
        note.apply(first)
        note.apply(.init(start: 0, end: 10, text: "final words", isFinal: true))
        XCTAssertEqual(note.passages.first?.id, first.id)
        XCTAssertFalse(note.apply(.init(start: 0, end: 10, text: "changed final words", isFinal: true)))
        XCTAssertFalse(note.apply(.init(start: 8, end: 12, text: "overlapping final", isFinal: true)))
        XCTAssertEqual(note.passages.first?.text, "final words")
        XCTAssertEqual(note.transcriptNeedsReview, true)
        XCTAssertFalse(note.apply(.init(start: .nan, end: 12, text: "invalid", isFinal: true)))
    }
    func testRetryReplacesStaleHypothesesButRetainsCorrectionsAndPersonalFields() {
        var note = NoteRecord()
        note.text = "personal"; note.ink = Data([1, 2])
        let corrected = TranscriptPassage(start: 0, end: 1, text: "reviewed", isFinal: true, isUserEdited: true)
        let stale = TranscriptPassage(start: 1, end: 2, text: "stale", isFinal: true)
        note.passages = [corrected, stale]
        let output = [TranscriptPassage(start: 0, end: 1, text: "machine", isFinal: true), .init(start: 1, end: 2, text: "new", isFinal: true)]
        XCTAssertTrue(note.replaceTranscript(start: 0, end: 2, with: output))
        XCTAssertTrue(note.replaceTranscript(start: 0, end: 2, with: output))
        XCTAssertEqual(note.passages.map(\.id), [corrected.id, stale.id])
        XCTAssertEqual(note.passages.map(\.text), ["reviewed", "new"])
        XCTAssertEqual(note.text, "personal"); XCTAssertEqual(note.ink, Data([1, 2]))
        XCTAssertFalse(note.replaceTranscript(start: 0, end: 2, with: [.init(start: 0, end: 2, text: "changed boundary", isFinal: true)]))
        XCTAssertEqual(note.passages.map(\.text), ["reviewed", "new"])
        XCTAssertEqual(note.transcriptNeedsReview, true)
    }
    func testCorrectionReportsMissingOriginalAfterLiveMergeInsteadOfDiscardingDraft() {
        var note = NoteRecord()
        let original = TranscriptPassage(start: 2, end: 3, text: "edit opened here", isFinal: false)
        note.passages = [.init(start: 0, end: 2, text: "earlier", isFinal: false), original]
        note.apply(.init(start: 0, end: 4, text: "merged live hypothesis", isFinal: false))
        XCTAssertFalse(note.correctPassage(id: original.id, text: "unsaved user draft"))
        XCTAssertEqual(note.passages.count, 1)
    }
    func testLegacyOptionalFieldsDecodeWithoutClaimingCompletion() throws {
        let source = Data("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"start\":0,\"end\":1,\"text\":\"legacy\",\"isFinal\":true}".utf8)
        XCTAssertNil(try JSONDecoder().decode(TranscriptPassage.self, from: source).isUserEdited)
        let note = try JSONDecoder().decode(NoteRecord.self, from: JSONEncoder().encode(NoteRecord()))
        XCTAssertNil(note.speechSessions)
        XCTAssertNil(note.metadata?.cloudTranscriptStatus)
    }
}

@MainActor final class SavedTranscriptionTests: XCTestCase {
    private func audio(_ library: NoteLibrary, id: UUID, start: Double, filename: String) throws -> URL {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000))
        buffer.frameLength = 16_000
        memset(buffer.floatChannelData![0], 0, 16_000 * 4)
        let file = try library.disk!.audioDirectory(for: id).appendingPathComponent(filename)
        do { let output = try AVAudioFile(forWriting: file, settings: format.settings); try output.write(from: buffer) }
        try AudioTimeline.save(.init(filename: filename, start: start, frames: 16_000, sampleRate: 16_000, channels: 1), for: file)
        return file
    }
    func testCloudReviewBlocksRetryUntilAcknowledgedAndOnlySuccessfulRetryCompletes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        library.update(id) {
            $0.transcriptCloudReviewRequired = true; $0.transcriptNeedsReview = true
            $0.metadata?.cloudTranscriptStatus = .partial
        }
        _ = await library.flush(noteID: id)
        _ = try audio(library, id: id, start: 0, filename: "1.caf")
        let model = FixtureSavedSpeech(), retry = SavedTranscription(recognizer: FixtureSavedSpeech())
        retry.retry(noteID: id, library: library)
        XCTAssertFalse(retry.busy); XCTAssertNotNil(retry.problem)
        library.update(id) { $0.acknowledgeTranscriptCloudReview() }
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .partial)
        XCTAssertEqual(library.note(id)?.transcriptNeedsReview, true)
        let allowed = SavedTranscription(recognizer: model)
        allowed.retry(noteID: id, library: library); await allowed.waitUntilFinished()
        XCTAssertEqual(model.languages.count, 1)
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .complete)
        XCTAssertEqual(library.note(id)?.transcriptNeedsReview, false)
    }
    func testRetryUsesSavedSessionLanguagesAndMissingTimelineNeverCompressesOffsets() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        library.update(id) { note in
            note.text = "Personal notes"; note.captureState = .finished
            note.language = .german
            note.speechSessions = [.init(id: UUID(), start: 0, end: 1, language: .danish), .init(id: UUID(), start: 1, end: 2, language: .french)]
        }
        _ = await library.flush(noteID: id)
        let first = try audio(library, id: id, start: 0, filename: "1.caf")
        _ = try audio(library, id: id, start: 1, filename: "2.caf")
        let model = FixtureSavedSpeech()
        let retry = SavedTranscription(recognizer: model)
        retry.retry(noteID: id, library: library); await retry.waitUntilFinished()
        XCTAssertEqual(model.languages, [.danish, .french])
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .complete)
        let ids = library.note(id)!.passages.map(\.id)
        retry.retry(noteID: id, library: library); await retry.waitUntilFinished()
        XCTAssertEqual(library.note(id)?.passages.map(\.id), ids)
        try FileManager.default.removeItem(at: first)
        retry.retry(noteID: id, library: library); await retry.waitUntilFinished()
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .partial)
        XCTAssertEqual(library.note(id)?.passages.last?.start, 1)
        XCTAssertEqual(library.note(id)?.text, "Personal notes")
    }
    func testCancellationRejectsLateOutputAndKeepsConcurrentPersonalEdits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); _ = await library.flush(noteID: id)
        _ = try audio(library, id: id, start: 0, filename: "1.caf")
        let model = FixtureSavedSpeech(); model.pause = true
        let retry = SavedTranscription(recognizer: model)
        retry.retry(noteID: id, library: library)
        await fulfillment(of: [model.entered], timeout: 5)
        library.update(id) { $0.text = "Concurrent personal edit" }
        retry.cancel(noteID: id, library: library)
        XCTAssertTrue(retry.busy)
        XCTAssertTrue(retry.cancelling)
        model.resume()
        await retry.waitUntilFinished()
        _ = await library.flush(noteID: id)
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .interrupted)
        XCTAssertEqual(library.note(id)?.text, "Concurrent personal edit")
        XCTAssertTrue(library.note(id)!.passages.isEmpty)
        let reopened = try library.disk!.load().notes.first { $0.id == id }
        XCTAssertEqual(reopened?.metadata?.cloudTranscriptStatus, .interrupted)
    }
    func testLateInferenceCannotWriteAfterAccountChangeOrPermanentDeletion() async throws {
        for purge in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let library = NoteLibrary(root: root); await library.waitUntilLoaded()
            let id = try XCTUnwrap(library.create()); _ = await library.flush(noteID: id)
            _ = try audio(library, id: id, start: 0, filename: "1.caf")
            let model = FixtureSavedSpeech(); model.pause = true
            let retry = SavedTranscription(recognizer: model)
            retry.retry(noteID: id, library: library)
            await fulfillment(of: [model.entered], timeout: 5)
            if purge {
                await library.performStorage(.trash, id: id, captureActive: false)
                await library.performStorage(.purge, id: id, confirmed: true, captureActive: false)
            } else {
                try await library.authenticate(.init(accountID: "different", workspaceID: "fixture"), name: "Fixture account")
            }
            model.resume(); await retry.waitUntilFinished()
            if purge {
                XCTAssertFalse(FileManager.default.fileExists(atPath: library.disk!.directory(for: id).path))
            } else {
                let saved = try library.disk!.load().notes.first { $0.id == id }
                XCTAssertTrue(saved!.passages.isEmpty)
                XCTAssertNotEqual(saved?.metadata?.cloudTranscriptStatus, .complete)
            }
        }
    }

    func testContiguousChunksShareOneSessionAndConversionTimeline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); _ = await library.flush(noteID: id)
        for index in 0..<4 { _ = try audio(library, id: id, start: Double(index), filename: "\(index).caf") }
        let plan = try library.disk!.playbackTimeline(for: id)
        let groups = try SavedSpeechGroup.make(plan: plan, sessions: [], fallback: .spanish)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].segments.count, 4)
        let longPlan = AudioTimeline.Plan(segments: (0..<1440).map { .init(url: plan.segments[0].url, start: Double($0 * 5), duration: 5, available: true) }, origin: 0)
        XCTAssertEqual(try SavedSpeechGroup.make(plan: longPlan, sessions: [], fallback: .spanish).count, 1)
        let output = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 8_000, channels: 1))
        let reader = SavedAudioInput(group: groups[0], outputFormat: output)
        var frames: Int64 = 0
        while let input = try await reader.next() {
            XCTAssertEqual(input.bufferStartTime!.seconds, Double(frames) / 8_000, accuracy: 0.000001)
            XCTAssertLessThanOrEqual(input.buffer.frameLength, 8_064)
            frames += Int64(input.buffer.frameLength)
        }
        XCTAssertEqual(frames, 32_000)
        let gap = AudioTimeline.Plan(segments: [plan.segments[0], plan.segments[2]], origin: 0)
        XCTAssertEqual(try SavedSpeechGroup.make(plan: gap, sessions: [], fallback: .spanish).count, 2)
    }

    func testReadOnlyRefreshDuringRetryRejectsLateResult() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); _ = await library.flush(noteID: id)
        _ = try audio(library, id: id, start: 0, filename: "1.caf")
        let model = FixtureSavedSpeech(); model.pause = true
        let retry = SavedTranscription(recognizer: model)
        retry.retry(noteID: id, library: library)
        await fulfillment(of: [model.entered], timeout: 5)
        library.update(id) { $0.metadata?.cloudReadOnly = true }
        model.resume()
        await retry.waitUntilFinished()
        XCTAssertNotNil(retry.problem)
        XCTAssertEqual(retry.completed, 0)
        XCTAssertTrue(library.note(id)!.passages.isEmpty)
        XCTAssertNotEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .complete)
    }

    func testUnavailableInferenceKeepsAudioAndNeverClaimsComplete() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root); await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create()); _ = await library.flush(noteID: id)
        let source = try audio(library, id: id, start: 0, filename: "1.caf")
        let model = FixtureSavedSpeech(); model.unavailable = true
        let retry = SavedTranscription(recognizer: model)
        retry.retry(noteID: id, library: library); await retry.waitUntilFinished()
        XCTAssertNotNil(retry.problem)
        XCTAssertEqual(library.note(id)?.metadata?.cloudTranscriptStatus, .interrupted)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }
}

@MainActor private final class FixtureSavedSpeech: SavedSpeechTranscribing {
    var languages: [SpokenLanguage] = []
    var pause = false, unavailable = false
    let entered = XCTestExpectation(description: "Recognition entered")
    private var continuation: CheckedContinuation<Void, Never>?
    func resume() { continuation?.resume(); continuation = nil }
    func transcribe(group: SavedSpeechGroup) async throws -> [TranscriptPassage] {
        languages.append(group.language)
        if unavailable { throw TranscriptFailure.unavailable }
        if pause { await withCheckedContinuation { continuation = $0; entered.fulfill() } }
        return [.init(start: 0, end: 1, text: "Synthetic recognized words", isFinal: true)]
    }
}
