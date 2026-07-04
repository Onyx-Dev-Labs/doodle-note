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
