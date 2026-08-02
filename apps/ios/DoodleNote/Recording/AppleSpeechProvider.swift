import Foundation
import AVFoundation
import Speech

/// Default engine: Apple's SpeechAnalyzer/SpeechTranscriber (iOS 26).
/// On-device, battery-friendly, no model management — language assets are
/// downloaded by the system on first use.
final class AppleSpeechProvider: TranscriptionProvider, @unchecked Sendable {
    let events: AsyncStream<TranscriptionEvent>
    private let eventsCont: AsyncStream<TranscriptionEvent>.Continuation

    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzerFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var resultsTask: Task<Void, Never>?
    private let ingestLock = NSLock()

    init() {
        (events, eventsCont) = AsyncStream.makeStream(of: TranscriptionEvent.self)
    }

    func prepare() async throws {
        // Fast path first: when this locale's assets are already on the
        // device, skip AssetInventory entirely — the install-request path
        // hung indefinitely on a real device and must only run when needed.
        let installed = await SpeechTranscriber.installedLocales
        let current = Locale.current
        let match: (Locale) -> Bool = {
            $0.identifier(.bcp47) == current.identifier(.bcp47)
                || $0.language.languageCode == current.language.languageCode
        }
        if let ready = installed.first(where: match) ?? installed.first(where: {
            $0.language.languageCode == Locale(identifier: "en-US").language.languageCode
        }) {
            self.transcriber = SpeechTranscriber(
                locale: ready,
                transcriptionOptions: [],
                reportingOptions: [.volatileResults],
                attributeOptions: [.audioTimeRange]
            )
            return
        }

        let supported = await SpeechTranscriber.supportedLocales
        let locale =
            supported.first(where: match)
            ?? Locale(identifier: "en-US")

        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: [.audioTimeRange]
        )
        self.transcriber = transcriber

        // First run on this device: the language assets must download. Hard
        // bound: surface a real error instead of pinning the session in
        // "preparing" forever (which is what bricked the first device test).
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await withThrowingTimeout(seconds: 120) {
                try await request.downloadAndInstall()
            }
        }
    }

    func start(inputFormat: AVAudioFormat) async throws {
        guard let transcriber else {
            throw TranscriptionError.notPrepared
        }
        analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        if let analyzerFormat, analyzerFormat != inputFormat {
            converter = AVAudioConverter(from: inputFormat, to: analyzerFormat)
        }

        let (inputSequence, inputBuilder) = AsyncStream.makeStream(of: AnalyzerInput.self)
        self.inputBuilder = inputBuilder

        resultsTask = Task { [eventsCont] in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { continue }
                    if result.isFinal {
                        let start = result.range.start.seconds
                        let end = result.range.end.seconds
                        eventsCont.yield(.final(
                            text: text,
                            startMs: Int((start * 1000).rounded()),
                            endMs: Int((end * 1000).rounded())
                        ))
                    } else {
                        eventsCont.yield(.partial(text))
                    }
                }
            } catch {
                eventsCont.yield(.error("transcription failed: \(error.localizedDescription)"))
            }
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer
        try await analyzer.start(inputSequence: inputSequence)
    }

    func ingest(_ buffer: AVAudioPCMBuffer) {
        ingestLock.lock()
        defer { ingestLock.unlock() }
        guard let inputBuilder else { return }

        guard let converter, let analyzerFormat else {
            inputBuilder.yield(AnalyzerInput(buffer: buffer))
            return
        }
        let ratio = analyzerFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else {
            return
        }
        var conversionError: NSError?
        let source = ConverterInput(buffer: buffer)
        converter.convert(to: converted, error: &conversionError) { _, status in
            source.next(status: status)
        }
        if conversionError == nil, converted.frameLength > 0 {
            inputBuilder.yield(AnalyzerInput(buffer: converted))
        }
    }

    func finish() async {
        ingestLock.withLock {
            inputBuilder?.finish()
            inputBuilder = nil
        }

        // Both awaits are bounded: SpeechAnalyzer's finalize has wedged on a
        // real device (assets mid-download), and a provider that can't finish
        // pins the whole controller in .stopping. Losing the transcript tail
        // beats losing the session.
        if let analyzer {
            await withTimeout(seconds: 4) { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
        }
        if let resultsTask {
            await withTimeout(seconds: 2) { await resultsTask.value }
            resultsTask.cancel()
        }
        eventsCont.finish()
        analyzer = nil
        converter = nil
    }
}

/// AVAudioConverter's input closure is `@Sendable`, while AVAudioPCMBuffer is
/// not. This synchronized ownership box makes the one-shot handoff explicit
/// and avoids capturing mutable local state across concurrency domains.
private final class ConverterInput: @unchecked Sendable {
    private let lock = NSLock()
    private let buffer: AVAudioPCMBuffer
    private var hasProvidedBuffer = false

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func next(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        lock.withLock {
            guard !hasProvidedBuffer else {
                status.pointee = .noDataNow
                return nil
            }
            hasProvidedBuffer = true
            status.pointee = .haveData
            return buffer
        }
    }
}

enum TranscriptionError: LocalizedError {
    case notPrepared
    case modelLoadFailed(String)

    var errorDescription: String? {
        switch self {
        case .notPrepared: "Transcription engine was not prepared before starting."
        case .modelLoadFailed(let detail): "Could not load the speech model: \(detail)"
        }
    }
}
