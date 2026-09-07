import AVFoundation
import Observation
import Speech

@MainActor protocol SavedSpeechTranscribing {
    func transcribe(group: SavedSpeechGroup) async throws -> [TranscriptPassage]
}

enum TranscriptFailure: LocalizedError {
    case unavailable, incomplete, stale
    var errorDescription: String? {
        switch self {
        case .unavailable: "The speech model is unavailable for this recording language. Check model readiness before retrying."
        case .incomplete: "Transcription is incomplete. Saved audio and corrections are preserved."
        case .stale: "The recording changed during processing. Retry from its saved audio."
        }
    }
}

/// A contiguous recording session shares one analyzer across every CAF chunk. No remote fallback.
@MainActor final class AppleSavedSpeech: SavedSpeechTranscribing {
    func transcribe(group: SavedSpeechGroup) async throws -> [TranscriptPassage] {
        guard SpeechTranscriber.isAvailable,
              let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: group.language.rawValue)) else {
            throw TranscriptFailure.unavailable
        }
        let module = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
        guard await AssetInventory.status(forModules: [module]) == .installed else { throw TranscriptFailure.unavailable }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else { throw TranscriptFailure.unavailable }
        let analyzer = SpeechAnalyzer(modules: [module])
        let results = Task { () throws -> [TranscriptPassage] in
            var note = NoteRecord()
            for try await result in module.results {
                try Task.checkCancellation()
                guard note.apply(.init(start: result.range.start.seconds, end: CMTimeRangeGetEnd(result.range).seconds,
                    text: String(result.text.characters), isFinal: result.isFinal)) else { throw TranscriptFailure.incomplete }
            }
            guard note.passages.allSatisfy(\.isFinal) else { throw TranscriptFailure.incomplete }
            return note.passages
        }
        let reader = SavedAudioInput(group: group, outputFormat: format)
        let input = AsyncThrowingStream<AnalyzerInput, Error>(unfolding: { try await reader.next() })
        var timedOut = false
        let deadline = Task {
            do { try await Task.sleep(for: .seconds(max(120, (group.end - group.start) * 3))) } catch { return }
            timedOut = true
            results.cancel()
            await analyzer.cancelAndFinishNow()
        }
        defer { deadline.cancel() }
        do {
            return try await withTaskCancellationHandler {
                try await analyzer.prepareToAnalyze(in: format)
                guard let end = try await analyzer.analyzeSequence(input) else { throw TranscriptFailure.incomplete }
                try Task.checkCancellation()
                try await analyzer.finalizeAndFinish(through: end)
                let passages = try await results.value
                try Task.checkCancellation()
                guard !timedOut else { throw TranscriptFailure.incomplete }
                return passages
            } onCancel: {
                results.cancel()
                Task { await analyzer.cancelAndFinishNow() }
            }
        } catch {
            results.cancel()
            await analyzer.cancelAndFinishNow()
            throw error
        }
    }
}

@MainActor @Observable final class SavedTranscription {
    private(set) var busy = false
    private(set) var cancelling = false
    private(set) var completed = 0
    private(set) var total = 0
    private(set) var problem: String?
    private var task: Task<Void, Never>?
    private var attempt = UUID()
    private let recognizer: any SavedSpeechTranscribing
    init(recognizer: any SavedSpeechTranscribing = AppleSavedSpeech()) { self.recognizer = recognizer }

    func cancel(noteID: UUID, library: NoteLibrary) {
        guard busy else { return }
        cancelling = true
        task?.cancel()
        problem = "Transcription canceled. Saved audio and corrections are preserved."
        library.update(noteID) { $0.metadata?.cloudTranscriptStatus = .interrupted }
    }

    func retry(noteID: UUID, library: NoteLibrary) {
        guard !busy, !library.storageBusy, let note = library.note(noteID), note.captureState != .recording else { return }
        let token = UUID(), auth = library.authenticationGeneration
        attempt = token; busy = true; cancelling = false; problem = nil; completed = 0; total = 0
        task = Task { [weak self] in
            guard let self else { return }
            defer { if attempt == token { busy = false; cancelling = false; task = nil } }
            @MainActor func valid() throws {
                try Task.checkCancellation()
                guard attempt == token, auth == library.authenticationGeneration, !library.storageBusy,
                      let current = library.note(noteID), current.captureState != .recording, current.speechSessions == note.speechSessions else { throw TranscriptFailure.stale }
            }
            do {
                guard await library.flush(noteID: noteID), let disk = library.disk else { throw TranscriptFailure.incomplete }
                try valid()
                let plan = try await Task.detached { try disk.playbackTimeline(for: noteID) }.value
                try valid()
                guard !plan.segments.isEmpty else { throw TranscriptFailure.incomplete }
                let sessions = note.speechSessions ?? []
                total = plan.segments.count
                library.update(noteID) { $0.metadata?.cloudTranscriptStatus = .partial }
                guard await library.flush(noteID: noteID) else { throw TranscriptFailure.incomplete }
                var complete = plan.origin == 0
                var endpoint = plan.origin
                for segment in plan.segments {
                    if !segment.available || segment.start > endpoint + 0.001 { complete = false }
                    endpoint = segment.end
                }
                let groups = try SavedSpeechGroup.make(plan: plan, sessions: sessions, fallback: note.language)
                for group in groups {
                    try valid()
                    let passages = try await recognizer.transcribe(group: group)
                    try valid()
                    // Revalidate source identity/receipt after inference. A removed/replaced file is not a valid result source.
                    let currentPlan = try await Task.detached { try disk.playbackTimeline(for: noteID) }.value
                    try valid()
                    guard currentPlan.segments.count == plan.segments.count,
                          zip(currentPlan.segments, plan.segments).allSatisfy({ $0.url == $1.url && $0.start == $1.start && $0.duration == $1.duration && $0.available == $1.available }) else { throw TranscriptFailure.stale }
                    guard passages.allSatisfy({ $0.start.isFinite && $0.end.isFinite && $0.start >= 0 && $0.end > $0.start && $0.end <= group.end - group.start + 0.05 && $0.isFinal && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { throw TranscriptFailure.incomplete }
                    library.update(noteID) { current in
                        let shifted = passages.map { value in
                            var passage = value
                            passage.start += group.start; passage.end += group.start
                            return passage
                        }
                        if !current.replaceTranscript(start: group.start, end: group.end, with: shifted) { complete = false }
                    }
                    completed += group.segments.count
                    guard await library.flush(noteID: noteID) else { throw TranscriptFailure.incomplete }
                }
                try valid()
                library.update(noteID) { current in
                    current.metadata?.cloudTranscriptStatus = complete && current.transcriptNeedsReview != true && current.passages.allSatisfy(\.isFinal) ? .complete : .partial
                }
                guard await library.flush(noteID: noteID) else { throw TranscriptFailure.incomplete }
                if library.note(noteID)?.metadata?.cloudTranscriptStatus != .complete { problem = TranscriptFailure.incomplete.localizedDescription }
            } catch {
                guard attempt == token, auth == library.authenticationGeneration else { return }
                problem = Task.isCancelled ? "Transcription canceled. Saved audio and corrections are preserved." : error.localizedDescription
                library.update(noteID) { $0.metadata?.cloudTranscriptStatus = .interrupted }
                _ = await library.flush(noteID: noteID)
            }
        }
    }

    func waitUntilFinished() async { await task?.value }
}
