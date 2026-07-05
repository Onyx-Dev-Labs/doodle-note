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
        // Arm stop handling FIRST. A SIGTERM that arrives before the handlers
        // exist kills the process instantly and silently — which, during model
        // warm-up, meant an early Stop click threw the whole session away.
        StopController.shared.arm()

        // Opt-in parent-death watchdog: hosts that spawn us with a live stdin
        // pipe pass this flag; when the pipe closes (host crashed/restarted),
        // stop gracefully instead of recording forever as an orphan. Opt-in
        // because a /dev/null stdin reads EOF immediately.
        if options.flags.contains("exit-on-stdin-close") {
            Thread {
                while true {
                    let data = FileHandle.standardInput.availableData
                    if data.isEmpty { break }  // EOF — host is gone
                }
                Events.log("stdin closed — host process gone; finishing session")
                StopController.shared.stop()
            }.start()
        }

        let source = options.values["source"] ?? "both"
        let wantMic = source == "mic" || source == "both"
        let wantSystem = source == "system" || source == "both"
        guard wantMic || wantSystem else {
            throw EngineError.usage("--source must be mic | system | both")
        }
        let seconds = options.values["seconds"].flatMap(Double.init)

        // Capture-first startup: pipelines are created WITHOUT loading models so
        // recording begins the moment permissions clear. Audio queues in each
        // pipeline's buffer stream while models load behind it — the host can
        // show "recording" immediately and no audio is lost.
        var micPipeline: ChannelPipeline?
        var systemPipeline: ChannelPipeline?
        if wantMic { micPipeline = ChannelPipeline(channel: "mic") }
        if wantSystem { systemPipeline = ChannelPipeline(channel: "system") }

        var micCapture: MicCapture?
        var systemCapture: SystemAudioCapture?

        if let pipeline = systemPipeline {
            // Constructed before starting: this is where the screen/system-audio
            // permission prompt fires on first run.
            systemCapture = try await SystemAudioCapture(into: pipeline)
        }
        if let pipeline = micPipeline {
            // Explicitly request mic access BEFORE touching the audio hardware:
            // this is what makes macOS actually show the permission prompt
            // (attributed to the app that launched us). Starting the engine
            // without permission fails with an opaque '!dev' kAUStartIO error.
            Events.emit(["event": "status", "stage": "requesting_permission", "permission": "microphone"])
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            guard granted else {
                throw EngineError.internalError(
                    "Microphone permission denied. Open System Settings → Privacy & Security → Microphone, "
                        + "enable it for the app running Doodle Note (Electron during development), then try again."
                )
            }
            Events.emit(["event": "status", "stage": "permission_granted", "permission": "microphone"])
            // AEC is opt-in (`--aec on`): Apple's voice processing fails to
            // initialize on some setups, and its teardown/retry can leave the
            // fallback mic silently dead. Cross-channel transcript dedup
            // handles speaker echo, so reliability wins by default.
            micCapture = MicCapture(into: pipeline, enableAEC: options.values["aec"] == "on")
        }

        try micCapture?.start()
        try await systemCapture?.start()

        // Capturing now — tell the host immediately (bars animate, timer runs).
        var ready: [String: Any] = ["event": "ready", "mode": "live"]
        ready["channels"] = [wantMic ? "mic" : nil, wantSystem ? "system" : nil].compactMap { $0 }
        Events.emit(ready)

        // Dead-capture watchdog: a live mic delivers buffers continuously even
        // in silence, so zero buffers means the capture is dead — restart it
        // once, then say so loudly. A fake recording session is the worst bug
        // a meeting app can have.
        if wantMic, let pipeline = micPipeline {
            let originalCapture = micCapture
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !pipeline.hasProducedAudio else { return }
                Events.log("mic produced no audio after 3s — restarting capture")
                Events.emit(["event": "status", "stage": "mic_restarting", "channel": "mic"])
                originalCapture?.stop()
                let retry = MicCapture(into: pipeline, enableAEC: false)
                do {
                    try retry.start()
                } catch {
                    Events.emit([
                        "event": "error", "channel": "mic",
                        "message": "Microphone produced no audio and the restart failed (\(error)). "
                            + "Check System Settings → Sound → Input, then stop and re-record.",
                    ])
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if !pipeline.hasProducedAudio {
                    Events.emit([
                        "event": "error", "channel": "mic",
                        "message": "Microphone is not delivering audio — check System Settings → "
                            + "Sound → Input, then stop and re-record.",
                    ])
                }
            }
        }

        // Load models sequentially (first load may download; second hits cache),
        // then start draining the queued audio.
        try await micPipeline?.prepare()
        try await systemPipeline?.prepare()
        micPipeline?.begin()
        systemPipeline?.begin()
        // Warm-up complete — hosts can flip from "warming up" to live UI.
        Events.emit(["event": "status", "stage": "transcribing"])

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

    init(channel: String) {
        self.channel = channel
        self.manager = StreamingUnifiedAsrManager()
        (self.bufferStream, self.bufferContinuation) = AsyncStream.makeStream(of: AVAudioPCMBuffer.self)
    }

    /// Load models and wire callbacks. Called AFTER capture starts — audio
    /// queues in the buffer stream until begin() drains it.
    func prepare() async throws {
        Events.emit(["event": "status", "stage": "loading_models", "channel": channel, "model": "parakeet-unified-en-0.6b"])
        try await manager.loadModels()
        let ch = channel
        await manager.setPartialTranscriptCallback { text in
            Events.emit(["event": "partial", "channel": ch, "text": text])
        }
    }

    /// Whether at least one audio buffer has arrived from capture.
    var hasProducedAudio: Bool {
        epochLock.lock()
        defer { epochLock.unlock() }
        return epochEmitted
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
    private var engine = AVAudioEngine()
    private let pipeline: ChannelPipeline
    private let enableAEC: Bool

    init(into pipeline: ChannelPipeline, enableAEC: Bool) {
        self.pipeline = pipeline
        self.enableAEC = enableAEC
    }

    func start() throws {
        // Acoustic echo cancellation (Apple's Voice Processing I/O — the FaceTime
        // AEC) subtracts whatever the Mac plays through its speakers from the mic
        // signal. If it fails for any reason, capture must survive: fall back to
        // the raw mic (far-side bleed returns, but the meeting is still recorded).
        if enableAEC {
            do {
                try startEngine(withAEC: true)
                Events.emit(["event": "status", "stage": "aec_enabled", "channel": "mic"])
                return
            } catch {
                Events.log("AEC engine start failed — retrying without echo cancellation: \(error)")
                Events.emit([
                    "event": "status", "stage": "aec_unavailable", "channel": "mic",
                    "reason": String(describing: error),
                ])
                // The failed engine may be half-configured for voice processing;
                // discard it entirely rather than trying to unwind its state.
                engine = AVAudioEngine()
            }
        }
        do {
            try startEngine(withAEC: false)
        } catch {
            throw EngineError.internalError(
                "Microphone capture failed even without echo cancellation "
                    + "(check the input device in System Settings → Sound): \(error)"
            )
        }
    }

    private func startEngine(withAEC aec: Bool) throws {
        let input = engine.inputNode
        if aec {
            // macOS requires the SAME voice-processing mode on BOTH I/O nodes of
            // an engine — enabling only the input side fails at kAUInitialize.
            try input.setVoiceProcessingEnabled(true)
            try engine.outputNode.setVoiceProcessingEnabled(true)
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
        }

        // Query the format AFTER voice-processing setup — it changes the I/O format.
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

    /// Install signal handlers now. Idempotent. Must run before any long
    /// startup work — see LiveCommand.run.
    func arm() {
        installSignalHandlers()
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
