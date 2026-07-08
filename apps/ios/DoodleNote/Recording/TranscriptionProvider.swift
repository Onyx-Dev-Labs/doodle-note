import Foundation
import AVFoundation

enum TranscriptionEvent {
    /// Live, still-changing hypothesis for the current utterance.
    case partial(String)
    /// A finalized utterance with audio-timeline positions.
    case final(text: String, startMs: Int, endMs: Int)
    case error(String)
}

enum TranscriptionEngine: String, CaseIterable, Identifiable {
    case apple
    case parakeet

    var id: String { rawValue }

    var label: String {
        switch self {
        case .apple: "Apple (built-in)"
        case .parakeet: "Parakeet (same as Mac)"
        }
    }

    var detail: String {
        switch self {
        case .apple: "Uses the on-device speech engine built into iOS. No download."
        case .parakeet: "The engine DoodleNote uses on the Mac. Downloads ~440 MB of models on first use."
        }
    }

    func makeProvider() -> TranscriptionProvider {
        switch self {
        case .apple: AppleSpeechProvider()
        case .parakeet: ParakeetProvider()
        }
    }
}

/// One live-transcription engine. Same abstraction the Mac engine uses: audio
/// buffers in from a capture tap on arbitrary threads, events out on an
/// AsyncStream. Providers must be safe to call `ingest` from the audio thread.
protocol TranscriptionProvider: AnyObject, Sendable {
    var events: AsyncStream<TranscriptionEvent> { get }

    /// Download/load models or assets. May be slow on first run.
    func prepare() async throws

    /// Begin a session. `inputFormat` is the mic tap's format.
    func start(inputFormat: AVAudioFormat) async throws

    /// Called from the capture tap for every audio buffer.
    func ingest(_ buffer: AVAudioPCMBuffer)

    /// Flush remaining audio, emit the last finals, and end the events stream.
    func finish() async
}
