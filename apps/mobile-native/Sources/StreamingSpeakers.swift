import FluidAudio
import Foundation
import Observation

struct SpeakerAudio: Sendable {
    let samples: [Float]
    let sampleRate: Double
}

/// Heavy Core ML work is isolated from capture and the UI. The input stream is bounded separately.
actor SpeakerWorker {
    private var diarizer: SortformerDiarizer?
    private var sessionID = UUID()
    private var offset = 0.0

    func prepare(modelURL: URL, sessionID: UUID, offset: Double) async throws {
        self.sessionID = sessionID
        self.offset = offset
        if let diarizer { diarizer.reset(); return }
        let config = SortformerConfig.fastV2_1
        var timeline = DiarizerTimelineConfig.sortformerDefault
        timeline.maxStoredFrames = 750
        let engine = SortformerDiarizer(config: config, timelineConfig: timeline)
        let models = try await SortformerModels.load(config: config, mainModelPath: modelURL)
        guard let embedded = models.embeddedConfig,
              embedded.chunkLen == config.chunkLen,
              embedded.chunkLeftContext == config.chunkLeftContext,
              embedded.chunkRightContext == config.chunkRightContext,
              embedded.fifoLen == config.fifoLen,
              embedded.spkcacheLen == config.spkcacheLen else { throw SpeakerModelError.integrity }
        engine.initialize(models: models)
        diarizer = engine
    }

    func consume(_ audio: SpeakerAudio) throws -> [SpeakerTurn]? {
        guard let diarizer else { throw SpeakerModelError.missing }
        try Task.checkCancellation()
        guard try diarizer.process(samples: audio.samples, sourceSampleRate: audio.sampleRate) != nil else { return nil }
        return snapshot(diarizer)
    }

    func finish() throws -> [SpeakerTurn] {
        guard let diarizer else { return [] }
        try diarizer.finalizeSession()
        return snapshot(diarizer)
    }

    func processedFrames() -> Int { diarizer?.numFramesProcessed ?? 0 }

    private func snapshot(_ engine: SortformerDiarizer) -> [SpeakerTurn] {
        engine.timeline.speakers.values.flatMap { speaker in
            (speaker.finalizedSegments + speaker.tentativeSegments).map { segment in
                SpeakerTurn(sessionID: sessionID, slot: segment.speakerIndex,
                    start: offset + Double(segment.startTime), end: offset + Double(segment.endTime),
                    isFinal: segment.isFinalized)
            }
        }
    }
}

@MainActor @Observable
final class StreamingSpeakers {
    enum State { case missing, downloading, ready, preparing, running, failed }
    var enabled = UserDefaults.standard.bool(forKey: "speakerLabelsEnabled") {
        didSet { UserDefaults.standard.set(enabled, forKey: "speakerLabelsEnabled") }
    }
    private(set) var state = State.missing
    private(set) var detail = "Download the speaker model to enable on-device labels."
    private let store = SpeakerModelStore.shared
    private(set) var downloadProgress = 0.0
    private let worker = SpeakerWorker()
    private var downloadTask: Task<Void, Never>?
    private var task: Task<Void, Never>?
    private var sessionID: UUID?

    var preparing: Bool { state == .downloading || state == .preparing }

    func check() async {
        guard task == nil, !preparing else { return }
        if await store.installed() { state = .ready; detail = "Speaker model available on this device." }
    }

    func download() {
        guard !preparing, task == nil else { return }
        state = .downloading
        downloadProgress = 0
        detail = "Downloading the speaker model (240 MB)…"
        downloadTask = Task {
            do {
                try await store.download { [weak self] value in
                    Task { @MainActor in self?.downloadProgress = value }
                }
                state = .ready
                enabled = true
                detail = "Speaker model downloaded. Labels will be checked when recording starts."
            } catch is CancellationError { state = .missing; detail = "Speaker model download canceled." }
            catch { fail(error.localizedDescription) }
            downloadTask = nil
        }
    }

    func cancelDownload() {
        guard downloadTask != nil else { return }
        detail = "Canceling download… Verified files will be kept for retry."
        downloadTask?.cancel()
    }

    func removeModel() async {
        guard task == nil, !preparing else { return }
        do {
            try await store.remove()
            state = .missing
            enabled = false
            detail = "Speaker model removed. Your notes and recordings are unchanged."
        } catch { fail(error.localizedDescription) }
    }

    func start(offset: Double, onUpdate: @escaping @MainActor (UUID, [SpeakerTurn]) -> Void) async
        -> AsyncStream<SpeakerAudio>.Continuation? {
        guard enabled, !preparing, task == nil else { return nil }
        let sessionID = UUID()
        self.sessionID = sessionID
        state = .preparing
        detail = "Preparing speaker labels…"
        do {
            let url = try await store.modelURL()
            try await worker.prepare(modelURL: url, sessionID: sessionID, offset: offset)
        } catch { fail("Speaker labels are unavailable. Audio and transcription can continue. \(error.localizedDescription)"); return nil }
        let (stream, input) = AsyncStream<SpeakerAudio>.makeStream(bufferingPolicy: .bufferingOldest(128))
        state = .running
        detail = "Live speaker labels are provisional. Confirm names only when you know who spoke."
        task = Task { [weak self, worker] in
            do {
                for await packet in stream {
                    try Task.checkCancellation()
                    if let turns = try await worker.consume(packet) { onUpdate(sessionID, turns) }
                }
                if !Task.isCancelled { onUpdate(sessionID, try await worker.finish()) }
            } catch is CancellationError { }
            catch { self?.fail("Speaker processing stopped. Audio and transcription are preserved. \(error.localizedDescription)") }
        }
        return input
    }

    func finish() async {
        let active = task
        let timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            self?.task?.cancel()
            self?.fail("Speaker finalization took too long. Saved audio and existing labels are retained.")
        }
        await active?.value
        timeout.cancel()
        task = nil
        sessionID = nil
        if state == .running { state = .ready; detail = "Speaker labels saved on this device." }
    }

    func fail(_ message: String) { state = .failed; detail = message }
}
