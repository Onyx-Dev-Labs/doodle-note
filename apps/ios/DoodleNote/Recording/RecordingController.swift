import Foundation
import AVFoundation
import SwiftData
import SwiftUI

/// Owns one recording session: audio session config, the mic tap, the chosen
/// transcription provider, and persistence of finalized segments into the
/// meeting. One instance per MeetingView.
///
/// Hardened after the first real-device test bricked a session: every await
/// in `start` is generation-guarded so a stop during preparation can never
/// be resurrected by a resuming continuation, and `stop` bounds the
/// provider drain with a timeout so the controller ALWAYS returns to idle —
/// a hung SpeechAnalyzer finalize must never leave the UI in a dead state
/// with the mic held open.
@MainActor
@Observable
final class RecordingController {
    enum State: Equatable {
        case idle
        case preparing(String)
        case recording
        case stopping
        case failed(String)
    }

    private(set) var state: State = .idle
    /// Live, still-changing hypothesis shown under the transcript.
    private(set) var livePartial: String = ""
    private(set) var recordingStartedAt: Date?

    private let engine = AVAudioEngine()
    private var provider: TranscriptionProvider?
    private var eventsTask: Task<Void, Never>?

    /// Bumped by stop(); awaits inside start() abort when it moves past them.
    private var generation = 0

    var isActive: Bool {
        switch state {
        case .preparing, .recording, .stopping: true
        case .idle, .failed: false
        }
    }

    func start(meeting: Meeting, context: ModelContext) async {
        guard state == .idle || !isActive else { return }
        let gen = generation

        state = .preparing("Requesting microphone…")
        guard await AVAudioApplication.requestRecordPermission() else {
            if gen == generation {
                state = .failed("Microphone access is off. Enable it in Settings → Privacy → Microphone.")
            }
            return
        }
        guard gen == generation else { return } // stopped while prompting

        let engineChoice = TranscriptionEngine(
            rawValue: UserDefaults.standard.string(forKey: "transcriptionEngine") ?? "apple"
        ) ?? .apple
        let provider = engineChoice.makeProvider()
        self.provider = provider

        do {
            state = .preparing(engineChoice == .parakeet
                ? "Loading Parakeet models (first run downloads ~440 MB)…"
                : "Preparing transcription (first run downloads speech assets)…")
            try await provider.prepare()
            guard gen == generation else { // stopped mid-download — stay dead
                await provider.finish()
                return
            }

            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP, .defaultToSpeaker])
            try session.setActive(true)

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            try await provider.start(inputFormat: format)
            guard gen == generation else {
                teardownAudio()
                await provider.finish()
                return
            }

            input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
                provider.ingest(buffer)
            }
            engine.prepare()
            try engine.start()

            let startDate = Date()
            recordingStartedAt = startDate
            if meeting.startedAt == nil { meeting.startedAt = startDate }
            state = .recording

            let meetingID = meeting.persistentModelID
            eventsTask = Task { [weak self] in
                for await event in provider.events {
                    guard let self else { return }
                    self.handle(event: event, meetingID: meetingID, context: context)
                }
            }
        } catch {
            teardownAudio()
            if gen == generation {
                state = .failed("Could not start recording: \(error.localizedDescription)")
            }
        }
    }

    func stop(meeting: Meeting, context: ModelContext) async {
        guard state == .recording || isPreparing else { return }
        // Invalidate any in-flight start continuation FIRST — whatever it was
        // waiting on (asset download, engine spin-up) aborts at its next guard.
        generation += 1
        state = .stopping
        teardownAudio()

        // The provider drain is best-effort with a hard bound: a wedged
        // SpeechAnalyzer finalize loses the tail of the transcript, never
        // the ability to stop. (The first device test hung here forever.)
        if let provider {
            await withTimeout(seconds: 5) { await provider.finish() }
        }
        if let eventsTask {
            await withTimeout(seconds: 2) { await eventsTask.value }
            eventsTask.cancel()
        }
        eventsTask = nil
        provider = nil
        livePartial = ""
        meeting.endedAt = .now
        try? context.save()
        state = .idle
    }

    private var isPreparing: Bool {
        if case .preparing = state { return true }
        return false
    }

    private func teardownAudio() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func handle(event: TranscriptionEvent, meetingID: PersistentIdentifier, context: ModelContext) {
        switch event {
        case .partial(let text):
            livePartial = text
        case .final(let text, let startMs, let endMs):
            livePartial = ""
            guard let meeting = context.model(for: meetingID) as? Meeting else { return }
            let segment = Segment(text: text, startMs: startMs, endMs: endMs)
            segment.meeting = meeting
            context.insert(segment)
            try? context.save()
        case .error(let message):
            // Non-fatal: capture continues; surface the most recent problem.
            if state == .recording {
                livePartial = ""
                print("[recording] \(message)")
            }
        }
    }
}

/// Run an async operation but give up waiting after `seconds`. The operation
/// itself is cancelled on timeout; either way this function returns.
func withTimeout(seconds: Double, _ operation: @escaping @Sendable () async -> Void) async {
    await withTaskGroup(of: Void.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }
        await group.next() // whichever finishes first
        group.cancelAll()
    }
}
