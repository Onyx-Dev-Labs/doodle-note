import AVFoundation
import FluidAudio
import Foundation

enum Commands {

    // MARK: - transcribe: batch, highest quality (Parakeet TDT sliding-window)

    /// Transcribe a complete audio file with Parakeet TDT v2/v3. This is the
    /// engine the final post-meeting pass and file uploads will use.
    static func transcribe(_ options: CLIOptions) async throws {
        let url = try options.requireFile()
        let version: AsrModelVersion = options.values["model"] == "v3" ? .v3 : .v2
        let modelName = version == .v3 ? "parakeet-tdt-0.6b-v3" : "parakeet-tdt-0.6b-v2"

        Events.emit(["event": "status", "stage": "loading_models", "model": modelName])
        let gate = PercentGate()
        let models = try await AsrModels.downloadAndLoad(version: version) { progress in
            if let pct = gate.advance(progress.fractionCompleted) {
                Events.emit(["event": "download", "progress": Double(pct) / 100.0])
            }
        }

        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        Events.emit(["event": "ready", "model": modelName])

        // Segment-friendly mode for imports and re-transcription: stereo
        // meeting recordings decode each channel separately (L = mic "You",
        // R = system "Them" — our merge writes them that way), emitting the
        // live protocol's per-channel timings/final events so hosts assemble
        // transcript segments with the exact same code as live capture.
        if options.values["channels"] == "split" {
            try await transcribeSplit(url: url, manager: manager)
            return
        }

        var decoderState = try TdtDecoderState()
        let result = try await manager.transcribe(url, decoderState: &decoderState)

        // The URL transcribe path reports duration 0 in FluidAudio 0.15.4 — measure it ourselves.
        let audioFile = try AVAudioFile(forReading: url)
        let audioSeconds = Double(audioFile.length) / audioFile.processingFormat.sampleRate
        let rtfx = result.processingTime > 0 ? audioSeconds / result.processingTime : 0
        var final: [String: Any] = [
            "event": "final",
            "text": result.text,
            "confidence": Double(result.confidence),
            "audioSeconds": audioSeconds,
            "processingSeconds": result.processingTime,
            "speedup": (rtfx * 10).rounded() / 10,
        ]
        if options.flags.contains("timings"), let timings = result.tokenTimings {
            final["tokens"] = Timings.payload(timings)
        }
        Events.emit(final)
    }

    /// Decode each audio channel independently and emit per-channel events.
    /// Mono inputs (imports) produce a single "mic" channel.
    private static func transcribeSplit(url: URL, manager: AsrManager) async throws {
        let file = try AVAudioFile(forReading: url)
        let sourceFormat = file.processingFormat
        let channelCount = min(Int(sourceFormat.channelCount), 2)
        guard channelCount > 0, file.length > 0 else {
            throw EngineError.internalError("audio file has no content: \(url.path)")
        }
        let channelNames = channelCount == 2 ? ["mic", "system"] : ["mic"]

        guard
            let monoFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: sourceFormat.sampleRate,
                channels: 1, interleaved: false)
        else { throw EngineError.internalError("could not create mono split format") }

        // Blockwise read → split channels → resample each to the ASR's 16k
        // mono. One converter per channel: they keep filter state across
        // blocks, and interleaving two channels through one converter would
        // smear samples across the block seams.
        let converters = channelNames.map { _ in AudioConverter() }
        var channelSamples: [[Float]] = Array(repeating: [], count: channelCount)
        let blockFrames: AVAudioFrameCount = 1 << 19  // ~11s at 48k per read
        guard let block = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: blockFrames)
        else { throw EngineError.internalError("could not allocate read buffer") }

        while file.framePosition < file.length {
            try file.read(into: block, frameCount: blockFrames)
            let frames = block.frameLength
            guard frames > 0 else { break }
            for channel in 0..<channelCount {
                guard
                    let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: frames),
                    let source = block.floatChannelData?[channel],
                    let target = mono.floatChannelData?[0]
                else { continue }
                mono.frameLength = frames
                target.update(from: source, count: Int(frames))
                channelSamples[channel].append(contentsOf: try converters[channel].resampleBuffer(mono))
            }
        }

        let started = Date()
        var audioSeconds: Double = 0
        for (index, name) in channelNames.enumerated() {
            Events.emit(["event": "status", "stage": "transcribing", "channel": name])
            var decoderState = try TdtDecoderState()
            let result = try await manager.transcribe(
                channelSamples[index], decoderState: &decoderState)
            audioSeconds = max(audioSeconds, Double(channelSamples[index].count) / AudioSupport.sampleRate)
            // Tokens stream in bounded chunks — an hour of speech in one JSON
            // line is unkind to line-buffered consumers.
            if let timings = result.tokenTimings {
                var offset = 0
                while offset < timings.count {
                    let end = min(offset + 1_000, timings.count)
                    Events.emit([
                        "event": "timings", "channel": name,
                        "tokens": Timings.payload(Array(timings[offset..<end])),
                    ])
                    offset = end
                }
            }
            Events.emit([
                "event": "final",
                "channel": name,
                "text": result.text,
                "confidence": Double(result.confidence),
            ])
        }
        let processing = Date().timeIntervalSince(started)
        Events.emit([
            "event": "done",
            "audioSeconds": audioSeconds,
            "processingSeconds": processing,
            "speedup": processing > 0 ? ((audioSeconds / processing) * 10).rounded() / 10 : 0,
        ])
    }

    // MARK: - stream: live partials (Parakeet Unified, built for hours-long sessions)

    /// Simulate live transcription by feeding a file through the streaming engine
    /// in small chunks — the exact code path live capture will drive, minus the mic.
    /// Emits `partial` events as the transcript grows, then a `final`.
    static func stream(_ options: CLIOptions) async throws {
        let url = try options.requireFile()
        let realtime = options.flags.contains("realtime")

        Events.emit(["event": "status", "stage": "loading_models", "model": "parakeet-unified-en-0.6b"])
        let manager = StreamingUnifiedAsrManager()
        try await manager.loadModels()

        await manager.setPartialTranscriptCallback { text in
            Events.emit(["event": "partial", "text": text])
        }
        Events.emit(["event": "ready", "model": "parakeet-unified-en-0.6b"])

        let samples = try AudioConverter().resampleAudioFile(url)
        let chunkSamples = 4_000  // 0.25s @ 16kHz — mimics capture callback cadence
        let started = Date()

        var offset = 0
        while offset < samples.count {
            let end = min(offset + chunkSamples, samples.count)
            let buffer = try AudioSupport.makePCMBuffer(Array(samples[offset..<end]))
            try await manager.appendAudio(buffer)
            try await manager.processBufferedAudio()
            let timings = await manager.consumeTokenTimings()
            if !timings.isEmpty {
                Events.emit(["event": "timings", "tokens": Timings.payload(timings)])
            }
            if realtime {
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            offset = end
        }

        let text = try await manager.finish()
        let tail = await manager.consumeTokenTimings()
        if !tail.isEmpty {
            Events.emit(["event": "timings", "tokens": Timings.payload(tail)])
        }
        let audioSeconds = Double(samples.count) / AudioSupport.sampleRate
        let processing = Date().timeIntervalSince(started)
        Events.emit([
            "event": "final",
            "text": text,
            "audioSeconds": audioSeconds,
            "processingSeconds": processing,
            "speedup": processing > 0 ? ((audioSeconds / processing) * 10).rounded() / 10 : 0,
        ])
    }

    // MARK: - info: model cache state

    static func info() {
        let fm = FileManager.default
        func describe(_ version: AsrModelVersion, _ name: String) -> [String: Any] {
            let dir = AsrModels.defaultCacheDirectory(for: version)
            return ["model": name, "cacheDir": dir.path, "downloaded": fm.fileExists(atPath: dir.path)]
        }
        Events.emit([
            "event": "info",
            "models": [
                describe(.v2, "parakeet-tdt-0.6b-v2"),
                describe(.v3, "parakeet-tdt-0.6b-v3"),
            ],
        ])
    }
}
