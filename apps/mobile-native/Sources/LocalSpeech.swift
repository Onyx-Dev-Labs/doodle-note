import AVFoundation
import Observation
import Speech

@MainActor @Observable
final class LocalSpeech {
    enum Readiness: Equatable { case checking, unavailable, downloadNeeded, ready, downloading, running, failed }
    private(set) var readiness = Readiness.checking
    private(set) var detail = "Checking on-device speech…"
    private var analyzer: SpeechAnalyzer?
    private var resultTask: Task<Void, Never>?
    private var selectedLocale: Locale?
    private var generation = UUID()
    private var downloading = false

    func check(_ language: SpokenLanguage) async {
        guard analyzer == nil, !downloading else { return }
        let request = UUID()
        generation = request
        readiness = .checking
        let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: language.rawValue))
        guard request == generation else { return }
        guard SpeechTranscriber.isAvailable, let locale else {
            selectedLocale = nil
            readiness = .unavailable
            detail = "On-device speech is unavailable here for this language. You can still record and write notes."
            return
        }
        selectedLocale = locale
        let module = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
        let status = await AssetInventory.status(forModules: [module])
        guard request == generation else { return }
        readiness = status == .installed ? .ready : .downloadNeeded
        detail = status == .installed ? "Speech model ready on this device." : "Download the speech model before recording with live text."
    }

    func download(_ language: SpokenLanguage) async {
        guard let selectedLocale, readiness == .downloadNeeded else { return }
        downloading = true
        readiness = .downloading
        detail = "Downloading the speech model…"
        do {
            let module = SpeechTranscriber(locale: selectedLocale, preset: .timeIndexedProgressiveTranscription)
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                try await request.downloadAndInstall()
            }
            downloading = false
            await check(language)
        } catch { downloading = false; fail("Speech model download failed. \(error.localizedDescription)") }
    }

    func start(language: SpokenLanguage, offset: TimeInterval,
               onPassage: @escaping @MainActor (TranscriptPassage) -> Void) async
        -> (AVAudioFormat, AsyncStream<AnalyzerInput>.Continuation)? {
        await check(language)
        guard readiness == .ready, let selectedLocale else { return nil }
        let module = SpeechTranscriber(locale: selectedLocale, preset: .timeIndexedProgressiveTranscription)
        let analyzer = SpeechAnalyzer(modules: [module])
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingOldest(128))
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
            fail("A compatible speech audio format is unavailable.")
            return nil
        }
        self.analyzer = analyzer
        do {
            try await analyzer.prepareToAnalyze(in: format)
            resultTask = Task { [weak self] in
                do {
                    for try await result in module.results {
                        guard !Task.isCancelled else { return }
                        onPassage(TranscriptPassage(start: offset + result.range.start.seconds,
                            end: offset + CMTimeRangeGetEnd(result.range).seconds,
                            text: String(result.text.characters), isFinal: result.isFinal))
                    }
                } catch { self?.fail("Live transcription stopped. Audio is preserved. \(error.localizedDescription)") }
            }
            try await analyzer.start(inputSequence: stream)
            readiness = .running
            detail = "Transcribing on this device."
            return (format, continuation)
        } catch {
            continuation.finish()
            await analyzer.cancelAndFinishNow()
            resultTask?.cancel()
            self.analyzer = nil
            fail("Live transcription could not start. Audio can still be recorded. \(error.localizedDescription)")
            return nil
        }
    }

    func finish() async {
        if let analyzer {
            let timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
                self?.fail("Transcription finalization timed out. Saved audio and text are retained.")
                await analyzer.cancelAndFinishNow()
            }
            defer { timeout.cancel() }
            do { try await analyzer.finalizeAndFinishThroughEndOfInput() }
            catch { fail("Transcription finalization failed. The saved audio is retained. \(error.localizedDescription)") }
        }
        await resultTask?.value
        resultTask = nil
        analyzer = nil
        if readiness == .running { readiness = .ready; detail = "Speech model ready on this device." }
    }

    func fail(_ message: String) { readiness = .failed; detail = message }
}
