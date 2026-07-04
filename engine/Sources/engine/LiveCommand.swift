import AVFoundation
import CoreMedia
import FluidAudio
import Foundation
import ScreenCaptureKit

/// Live two-channel meeting transcription:
///   "mic"    — the local user (AVAudioEngine input tap; Microphone permission)
///   "system" — everyone else on the call (ScreenCaptureKit audio; Screen & System
///              Audio Recording permission)
///
/// Each channel runs its own streaming ASR pipeline, so speaker separation between
/// you and the far side falls out of the capture topology — no diarization needed.
/// Runs until --seconds elapses or SIGINT/SIGTERM (what the desktop app sends).
enum LiveCommand {
    static func run(_ options: CLIOptions) async throws {
        let source = options.values["source"] ?? "both"
        let wantMic = source == "mic" || source == "both"
        let wantSystem = source == "system" || source == "both"
        guard wantMic || wantSystem else {
            throw EngineError.usage("--source must be mic | system | both")
        }
        let seconds = options.values["seconds"].flatMap(Double.init)

        // Load pipelines sequentially: the first load may download models, and the
        // second then hits the local cache instead of racing the same download.
        var micPipeline: ChannelPipeline?
        var systemPipeline: ChannelPipeline?
        if wantMic { micPipeline = try await ChannelPipeline(channel: "mic") }
        if wantSystem { systemPipeline = try await ChannelPipeline(channel: "system") }

        var micCapture: MicCapture?
        var systemCapture: SystemAudioCapture?

        if let pipeline = systemPipeline {
            // Constructed before starting: this is where the screen/system-audio
            // permission prompt fires on first run.
            systemCapture = try await SystemAudioCapture(into: pipeline)
        }
        if let pipeline = micPipeline {
            // AEC on by default; `--aec off` for A/B comparison.
            micCapture = MicCapture(into: pipeline, enableAEC: options.values["aec"] != "off")
        }

        micPipeline?.begin()
        systemPipeline?.begin()

        try micCapture?.start()
        try await systemCapture?.start()

        var ready: [String: Any] = ["event": "ready", "mode": "live"]
        ready["channels"] = [wantMic ? "mic" : nil, wantSystem ? "system" : nil].compactMap { $0 }
        Events.emit(ready)

        await StopController.shared.wait(timeoutSeconds: seconds)
        Events.emit(["event": "status", "stage": "finishing"])

        micCapture?.stop()
        await systemCapture?.stop()
        await micPipeline?.finish()
        await systemPipeline?.finish()
        Events.emit(["event": "done"])
    }
}

// MARK: - Per-channel streaming pipeline

/// Owns one StreamingUnifiedAsrManager and a serial ingest queue bridging capture
/// callbacks (arbitrary threads) into the actor. Capture stays realtime even if
/// ASR hiccups — buffers queue in the AsyncStream.
final class ChannelPipeline {
    let channel: String
    private let manager: StreamingUnifiedAsrManager
    private let bufferStream: AsyncStream<AVAudioPCMBuffer>
    private let bufferContinuation: AsyncStream<AVAudioPCMBuffer>.Continuation
    private var consumeTask: Task<Void, Never>?
    private let startedAt = Date()
    private let epochLock = NSLock()
    private var epochEmitted = false

    init(channel: String) async throws {
        self.channel = channel
        Events.emit(["event": "status", "stage": "loading_models", "channel": channel, "model": "parakeet-unified-en-0.6b"])
        self.manager = StreamingUnifiedAsrManager()
        try await manager.loadModels()
        (self.bufferStream, self.bufferContinuation) = AsyncStream.makeStream(of: AVAudioPCMBuffer.self)
        let ch = channel
        await manager.setPartialTranscriptCallback { text in
            Events.emit(["event": "partial", "channel": ch, "text": text])
        }
    }

    /// Called from capture callbacks on arbitrary threads.
    func ingest(_ buffer: AVAudioPCMBuffer) {
        // Anchor this channel's token timeline (startSec = 0) to wall-clock time
        // on the first real buffer, so consumers can interleave channels whose
        // captures started at slightly different moments.
        epochLock.lock()
        if !epochEmitted {
            epochEmitted = true
            epochLock.unlock()
            Events.emit([
                "event": "channel_start",
                "channel": channel,
                "epochMs": Int(Date().timeIntervalSince1970 * 1000),
            ])
        } else {
            epochLock.unlock()
        }
        bufferContinuation.yield(buffer)
    }

    func begin() {
        consumeTask = Task { [manager, bufferStream, channel] in
            for await buffer in bufferStream {
                do {
                    try await manager.appendAudio(buffer)
                    try await manager.processBufferedAudio()
                    let timings = await manager.consumeTokenTimings()
                    if !timings.isEmpty {
                        Events.emit(["event": "timings", "channel": channel, "tokens": Timings.payload(timings)])
                    }
                } catch {
                    Events.log("(\(channel)) dropped buffer: \(error)")
                }
            }
        }
    }

    func finish() async {
        bufferContinuation.finish()
        await consumeTask?.value
        do {
            let text = try await manager.finish()
            let tail = await manager.consumeTokenTimings()
            if !tail.isEmpty {
                Events.emit(["event": "timings", "channel": channel, "tokens": Timings.payload(tail)])
            }
            Events.emit([
                "event": "final",
                "channel": channel,
                "text": text,
                "sessionSeconds": Date().timeIntervalSince(startedAt),
            ])
        } catch {
            Events.emit(["event": "error", "channel": channel, "message": "finish failed: \(error)"])
        }
    }
}

// MARK: - Microphone capture

final class MicCapture {
    private let engine = AVAudioEngine()
    private let pipeline: ChannelPipeline
    private let enableAEC: Bool

    init(into pipeline: ChannelPipeline, enableAEC: Bool) {
        self.pipeline = pipeline
        self.enableAEC = enableAEC
    }

    func start() throws {
        Events.emit(["event": "status", "stage": "requesting_permission", "permission": "microphone"])
        let input = engine.inputNode

        // Acoustic echo cancellation (Apple's Voice Processing I/O — the FaceTime
        // AEC): subtracts whatever the Mac is playing through its speakers from
        // the mic signal, so the far side of a speakered call doesn't bleed into
        // the "You" channel. Must be configured before the tap/format queries.
        if enableAEC {
            do {
                try input.setVoiceProcessingEnabled(true)
                if #available(macOS 14.0, *) {
                    // Don't let voice processing lower the meeting audio the user is hearing.
                    input.voiceProcessingOtherAudioDuckingConfiguration =
                        AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
                            enableAdvancedDucking: false,
                            duckingLevel: .min
                        )
                }
                // VPIO is a full-duplex unit; give the engine a live-but-silent output pair.
                engine.mainMixerNode.outputVolume = 0
                Events.emit(["event": "status", "stage": "aec_enabled", "channel": "mic"])
            } catch {
                Events.emit(["event": "status", "stage": "aec_unavailable", "channel": "mic"])
                Events.log("voice processing unavailable — mic may pick up speaker audio: \(error)")
            }
        }

        // Query the format AFTER enabling voice processing — it changes the I/O format.
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw EngineError.internalError("no microphone input available")
        }
        // Tap buffers are only guaranteed valid during the callback — copy before queueing.
        input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [pipeline] buffer, _ in
            if let copy = AudioSupport.copy(buffer) {
                pipeline.ingest(copy)
            }
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: - System audio capture (ScreenCaptureKit)

final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let pipeline: ChannelPipeline
    private var stream: SCStream?
    private let converter = AudioConverter()
    private let sampleQueue = DispatchQueue(label: "engine.system-audio")

    init(into pipeline: ChannelPipeline) async throws {
        self.pipeline = pipeline
        super.init()

        Events.emit(["event": "status", "stage": "requesting_permission", "permission": "screen_system_audio"])
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw EngineError.internalError("no display available for system audio capture")
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 16_000
        config.channelCount = 1
        // SCStream always produces video; make it as close to free as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 3

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        self.stream = stream
    }

    func start() async throws {
        try await stream?.startCapture()
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        // extractAVAudioPCMBuffer allocates a fresh buffer — safe to queue as-is.
        if let pcm = try? converter.extractAVAudioPCMBuffer(from: sampleBuffer) {
            pipeline.ingest(pcm)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Events.emit(["event": "error", "channel": "system", "message": "system capture stopped: \(error.localizedDescription)"])
        StopController.shared.stop()
    }
}

// MARK: - Stop coordination (signals / timeout)

final class StopController: @unchecked Sendable {
    static let shared = StopController()

    private let lock = NSLock()
    private var stopped = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var signalSources: [DispatchSourceSignal] = []

    func stop() {
        lock.lock()
        let resumable = waiters
        waiters = []
        stopped = true
        lock.unlock()
        resumable.forEach { $0.resume() }
    }

    func wait(timeoutSeconds: Double?) async {
        installSignalHandlers()
        if let timeoutSeconds {
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                self.stop()
            }
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if stopped {
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
    }

    private func installSignalHandlers() {
        lock.lock()
        defer { lock.unlock() }
        guard signalSources.isEmpty else { return }
        for sig in [SIGINT, SIGTERM] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
            source.setEventHandler { [weak self] in self?.stop() }
            source.resume()
            signalSources.append(source)
        }
    }
}
