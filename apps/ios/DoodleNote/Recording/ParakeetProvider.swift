import Foundation
import AVFoundation
import FluidAudio

/// Optional engine: NVIDIA Parakeet via FluidAudio — the same models the Mac
/// engine uses (engine/Sources/engine/LiveCommand.swift ChannelPipeline).
/// Heavier than Apple's engine (~440 MB download on first use) but gives
/// transcript quality consistent with desktop recordings.
///
/// v1 limitation: partials stream live, but the transcript is stored as one
/// final segment covering the whole session (token-timing segmentation like
/// the desktop SegmentAssembler is a follow-up).
final class ParakeetProvider: TranscriptionProvider, @unchecked Sendable {
    let events: AsyncStream<TranscriptionEvent>
    private let eventsCont: AsyncStream<TranscriptionEvent>.Continuation

    /// Capture hands each buffer off exactly once and never touches it again,
    /// so moving it across the actor boundary is safe despite AVAudioPCMBuffer
    /// not being Sendable.
    private struct BufferEnvelope: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
    }

    private let manager = StreamingUnifiedAsrManager()
    private let bufferStream: AsyncStream<BufferEnvelope>
    private let bufferCont: AsyncStream<BufferEnvelope>.Continuation
    private var consumeTask: Task<Void, Never>?
    private var startedAt = Date()

    init() {
        (events, eventsCont) = AsyncStream.makeStream(of: TranscriptionEvent.self)
        (bufferStream, bufferCont) = AsyncStream.makeStream(of: BufferEnvelope.self)
    }

    func prepare() async throws {
        do {
            try await manager.loadModels()
        } catch {
            throw TranscriptionError.modelLoadFailed(error.localizedDescription)
        }
        await manager.setPartialTranscriptCallback { [eventsCont] text in
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                eventsCont.yield(.partial(trimmed))
            }
        }
    }

    func start(inputFormat: AVAudioFormat) async throws {
        startedAt = Date()
        consumeTask = Task { [manager, bufferStream, eventsCont] in
            for await envelope in bufferStream {
                do {
                    try await manager.appendAudio(envelope.buffer)
                    try await manager.processBufferedAudio()
                } catch {
                    eventsCont.yield(.error("dropped buffer: \(error.localizedDescription)"))
                }
            }
        }
    }

    func ingest(_ buffer: AVAudioPCMBuffer) {
        bufferCont.yield(BufferEnvelope(buffer: buffer))
    }

    func finish() async {
        bufferCont.finish()
        await consumeTask?.value
        do {
            let text = try await manager.finish()
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                let sessionMs = Int(Date().timeIntervalSince(startedAt) * 1000)
                eventsCont.yield(.final(text: trimmed, startMs: 0, endMs: sessionMs))
            }
        } catch {
            eventsCont.yield(.error("finish failed: \(error.localizedDescription)"))
        }
        eventsCont.finish()
    }
}
