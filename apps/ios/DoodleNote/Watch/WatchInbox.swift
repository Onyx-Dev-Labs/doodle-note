import AVFoundation
import Speech
import SwiftData
import SwiftUI
import WatchConnectivity

@MainActor @Observable
final class WatchInbox: NSObject, WCSessionDelegate {
    static let shared: WatchInbox = {
        if ProcessInfo.processInfo.arguments.contains("-uiTesting") {
            return WatchInbox(store: WatchRecordingStore(directory:
                FileManager.default.temporaryDirectory.appendingPathComponent("WatchUITest-" + UUID().uuidString)))
        }
        return WatchInbox()
    }()
    nonisolated let store: WatchRecordingStore

    init(store: WatchRecordingStore = WatchRecordingStore()) {
        self.store = store
        super.init()
    }
    private(set) var recordings: [WatchRecording] = []
    private(set) var processingID: UUID?
    var error: String?

    func activate() {
        guard AppFeatures.watchRecording, WCSession.isSupported(),
              !ProcessInfo.processInfo.arguments.contains("-uiTesting") else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        refresh()
    }

    func refresh() {
        do { recordings = try store.recordings() }
        catch { self.error = "Could not load watch recordings. Audio files are still saved on this iPhone." }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        do {
            let recording = try WatchRecording(metadata: file.metadata ?? [:])
            let audio = try AVAudioFile(forReading: file.fileURL)
            guard audio.length > 0 else { throw CocoaError(.fileReadCorruptFile) }
            try store.receive(recording, from: file.fileURL)
            // Copy and manifest are durable before acknowledging. A failed copy
            // leaves the watch's original queued for an explicit retry.
            session.transferUserInfo(["receivedRecordingID": recording.id.uuidString])
            Task { @MainActor in self.refresh() }
        } catch {
            Task { @MainActor in self.error = "A watch recording could not be saved. Retry transfer from your watch." }
        }
    }

    func transcribe(_ recording: WatchRecording, container: ModelContainer) async {
        guard processingID == nil else { return }
        processingID = recording.id
        error = nil
        defer { processingID = nil }
        do {
            let segments = try await WatchFileTranscriber.transcribe(url: store.audioURL(recording.id))
            guard !segments.isEmpty else { throw WatchTranscriptionError.noSpeech }
            try saveTranscript(segments, for: recording, container: container)
            refresh()
        } catch {
            self.error = "Could not transcribe: \(error.localizedDescription) Audio is saved. You can retry."
        }
    }

    /// Isolated transaction: partial results never become a partial meeting, and
    /// retries cannot append the same transcript twice after a crash.
    func saveTranscript(_ segments: [WatchTranscriptSegment], for recording: WatchRecording, container: ModelContainer) throws {
        let context = ModelContext(container)
        context.autosaveEnabled = false
        let id = recording.id
        let existing = try context.fetch(FetchDescriptor<Meeting>(predicate: #Predicate { $0.id == id })).first
        if existing == nil {
            let meeting = Meeting(id: id, title: "Watch recording", createdAt: recording.startedAt, origin: "watch")
            meeting.startedAt = recording.startedAt
            meeting.endedAt = recording.startedAt.addingTimeInterval(recording.duration)
            context.insert(meeting)
            for part in segments {
                let segment = Segment(text: part.text, startMs: part.startMs, endMs: part.endMs)
                segment.meeting = meeting
                context.insert(segment)
            }
            try context.save()
        }
        var completed = recording
        completed.status = .transcribed
        try store.save(completed)
    }
}

struct WatchTranscriptSegment: Sendable {
    let text: String
    let startMs: Int
    let endMs: Int
}

/// File-based analysis supplies bounded audio directly to SpeechAnalyzer instead
/// of feeding an entire meeting into the live provider's unbounded input stream.
enum WatchFileTranscriber {
    static func transcribe(url: URL) async throws -> [WatchTranscriptSegment] {
        let supported = await SpeechTranscriber.supportedLocales
        guard let locale = supported.first(where: { $0.language.languageCode == Locale.current.language.languageCode })
                ?? supported.first(where: { $0.identifier(.bcp47) == "en-US" }) else {
            throw TranscriptionError.modelLoadFailed("On-device speech is unavailable on this device.")
        }
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await withThrowingTimeout(seconds: 120) { try await request.downloadAndInstall() }
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let results = Task<[WatchTranscriptSegment], Error> {
            var segments: [WatchTranscriptSegment] = []
            for try await result in transcriber.results {
                let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                guard result.isFinal, !text.isEmpty else { continue }
                segments.append(WatchTranscriptSegment(text: text,
                    startMs: Int(result.range.start.seconds * 1000),
                    endMs: Int(result.range.end.seconds * 1000)))
            }
            return segments
        }
        do {
            return try await withThrowingTimeout(seconds: 1800) {
                let file = try AVAudioFile(forReading: url)
                _ = try await analyzer.analyzeSequence(from: file)
                try await analyzer.finalizeAndFinishThroughEndOfInput()
                return try await results.value
            }
        } catch {
            results.cancel()
            await analyzer.cancelAndFinishNow()
            throw error
        }
    }
}


private enum WatchTranscriptionError: LocalizedError {
    case noSpeech
    var errorDescription: String? { "No speech was recognized. Export the audio to check the recording." }
}
