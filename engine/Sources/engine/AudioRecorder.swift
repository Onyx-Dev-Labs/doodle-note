import AVFoundation
import Foundation

/// Crash-safe session audio persistence.
///
/// While a session runs, each channel's audio is appended to rotating ~30s CAF
/// checkpoint files under `<audioDir>/checkpoints/` (CAF headers mark the data
/// chunk as open-ended, so an unclosed file from a crash is still readable).
/// A `manifest.json` alongside them records each channel's wall-clock start so
/// the channels can be aligned later.
///
/// On a clean finish — or via the `merge-audio` recovery command after a crash —
/// the checkpoints merge into `<audioDir>/audio.m4a`: AAC, 16kHz, left = mic
/// ("You"), right = system ("Them"). The checkpoints are then deleted, so a
/// directory containing `checkpoints/` but no `audio.m4a` is exactly "a session
/// that never finished" — that's the host's recovery signal.
final class SessionRecorder: @unchecked Sendable {
    static let sampleRate: Double = 16_000
    /// Mic on the left, system on the right; anything unexpected sorts after.
    static let channelOrder = ["mic", "system"]

    let directory: URL
    private let checkpointsDir: URL
    private let manifestURL: URL
    private let lock = NSLock()
    private var channelEpochs: [String: Int] = [:]
    private var recorders: [String: ChannelRecorder] = [:]

    init(directory: URL, channels: [String]) throws {
        self.directory = directory
        self.checkpointsDir = directory.appendingPathComponent("checkpoints")
        self.manifestURL = directory.appendingPathComponent("manifest.json")
        try FileManager.default.createDirectory(at: checkpointsDir, withIntermediateDirectories: true)
        writeManifest()
        for channel in channels {
            recorders[channel] = ChannelRecorder(channel: channel, checkpointsDir: checkpointsDir) {
                [weak self] channel, epochMs in
                self?.noteChannelStart(channel, epochMs: epochMs)
            }
        }
    }

    func recorder(for channel: String) -> ChannelRecorder? {
        recorders[channel]
    }

    /// Close all chunk files, merge them into audio.m4a, and remove the
    /// checkpoints. Call after capture has fully stopped.
    func finish() throws -> MergedAudio {
        for recorder in recorders.values { recorder.close() }
        return try Self.mergeAndClean(directory: directory)
    }

    /// The channel's first buffer anchors it to wall-clock time — the same
    /// moment the pipeline's `channel_start` event marks — so the merge can
    /// offset channels whose captures started at slightly different times.
    private func noteChannelStart(_ channel: String, epochMs: Int) {
        lock.lock()
        channelEpochs[channel] = epochMs
        lock.unlock()
        writeManifest()
    }

    private func writeManifest() {
        lock.lock()
        let payload: [String: Any] = [
            "version": 1,
            "sampleRate": Self.sampleRate,
            "channels": channelEpochs.mapValues { ["epochMs": $0] },
            "createdEpochMs": Int(Date().timeIntervalSince1970 * 1000),
        ]
        lock.unlock()
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
            try? data.write(to: manifestURL, options: .atomic)
        }
    }

    // MARK: - Merge (shared by clean finish and post-crash recovery)

    struct MergedAudio {
        let url: URL
        let durationMs: Int
        /// Wall-clock ms of the file's first frame (the earliest channel
        /// epoch) — lets hosts map transcript timestamps to seek positions.
        /// 0 when no epoch survived (manifest lost before any channel wrote).
        let startEpochMs: Int
    }

    /// Merge checkpoints in `directory` into audio.m4a and delete them.
    /// Safe to call on a directory left behind by a crashed session.
    static func mergeAndClean(directory: URL) throws -> MergedAudio {
        let result = try merge(directory: directory)
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("checkpoints"))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("manifest.json"))
        return result
    }

    static func merge(directory: URL) throws -> MergedAudio {
        let checkpointsDir = directory.appendingPathComponent("checkpoints")
        let fm = FileManager.default

        // Channels come from the chunk files themselves, not the manifest —
        // recovery must work even if the manifest never got its channels.
        let chunkFiles = (try? fm.contentsOfDirectory(at: checkpointsDir, includingPropertiesForKeys: nil)) ?? []
        var chunksByChannel: [String: [URL]] = [:]
        for url in chunkFiles where url.pathExtension == "caf" {
            // <channel>-NNNNNN.caf
            let stem = url.deletingPathExtension().lastPathComponent
            guard let dash = stem.lastIndex(of: "-") else { continue }
            chunksByChannel[String(stem[..<dash]), default: []].append(url)
        }
        guard !chunksByChannel.isEmpty else {
            throw EngineError.internalError("no checkpoint audio found in \(checkpointsDir.path)")
        }

        var epochs: [String: Int] = [:]
        if let data = try? Data(contentsOf: directory.appendingPathComponent("manifest.json")),
            let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let channels = manifest["channels"] as? [String: [String: Any]]
        {
            for (channel, info) in channels {
                if let epoch = info["epochMs"] as? Int { epochs[channel] = epoch }
            }
        }
        let baseEpoch = epochs.values.min() ?? 0

        let channels = chunksByChannel.keys.sorted { a, b in
            let ia = channelOrder.firstIndex(of: a) ?? channelOrder.count
            let ib = channelOrder.firstIndex(of: b) ?? channelOrder.count
            return ia == ib ? a < b : ia < ib
        }
        let readers = channels.map { channel -> ChannelChunkReader in
            let offsetMs = max(0, (epochs[channel] ?? baseEpoch) - baseEpoch)
            return ChannelChunkReader(
                files: chunksByChannel[channel]!.sorted { $0.lastPathComponent < $1.lastPathComponent },
                silencePrefixFrames: Int(Double(offsetMs) * sampleRate / 1000.0)
            )
        }

        let outChannelCount: AVAudioChannelCount = readers.count >= 2 ? 2 : 1
        guard
            let outFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: sampleRate,
                channels: outChannelCount, interleaved: false
            )
        else { throw EngineError.internalError("could not create merge output format") }

        let outURL = directory.appendingPathComponent("audio.m4a")
        try? fm.removeItem(at: outURL)
        let outFile = try AVAudioFile(
            forWriting: outURL,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: outChannelCount,
                // Per-channel: 64k is out of range for mono AAC at 16kHz.
                AVEncoderBitRateKey: 32_000 * Int(outChannelCount),
            ],
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )

        let blockFrames: AVAudioFrameCount = 16_384
        guard let block = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: blockFrames) else {
            throw EngineError.internalError("could not allocate merge buffer")
        }
        var totalFrames = 0
        while true {
            var producedMax = 0
            for (index, reader) in readers.enumerated() {
                // With >2 source channels (never expected), extras fold onto the right.
                let target = block.floatChannelData![min(index, Int(outChannelCount) - 1)]
                if index < Int(outChannelCount) {
                    target.update(repeating: 0, count: Int(blockFrames))
                }
                producedMax = max(producedMax, reader.fill(target, frames: Int(blockFrames)))
            }
            if producedMax == 0 { break }
            block.frameLength = AVAudioFrameCount(producedMax)
            try outFile.write(from: block)
            totalFrames += producedMax
        }
        guard totalFrames > 0 else {
            try? fm.removeItem(at: outURL)
            throw EngineError.internalError("checkpoint audio contained no readable frames")
        }
        return MergedAudio(
            url: outURL,
            durationMs: Int(Double(totalFrames) * 1000.0 / sampleRate),
            startEpochMs: baseEpoch
        )
    }
}

// MARK: - Per-channel checkpoint writer

/// Serialized writer for one channel's checkpoint chunks. Capture callbacks
/// hand buffers to `write` from arbitrary threads; everything else happens on
/// a private queue so the realtime path never blocks on disk.
final class ChannelRecorder: @unchecked Sendable {
    private static let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: SessionRecorder.sampleRate,
        channels: 1, interleaved: false
    )!
    private static let chunkFrames = AVAudioFramePosition(30 * Int(SessionRecorder.sampleRate))

    private let queue: DispatchQueue
    private let channel: String
    private let checkpointsDir: URL
    private let onFirstBuffer: (String, Int) -> Void

    private var started = false
    private var file: AVAudioFile?
    private var fileFrames: AVAudioFramePosition = 0
    private var chunkIndex = 0
    private var converter: AVAudioConverter?
    private var converterInputFormat: AVAudioFormat?
    private var reportedWriteFailure = false

    init(channel: String, checkpointsDir: URL, onFirstBuffer: @escaping (String, Int) -> Void) {
        self.queue = DispatchQueue(label: "engine.audio-recorder.\(channel)", qos: .utility)
        self.channel = channel
        self.checkpointsDir = checkpointsDir
        self.onFirstBuffer = onFirstBuffer
    }

    /// Called from capture threads. `buffer` must be owned by the caller's
    /// pipeline (ingest buffers are fresh copies, shared read-only with ASR).
    func write(_ buffer: AVAudioPCMBuffer) {
        queue.async { [self] in
            if !started {
                started = true
                onFirstBuffer(channel, Int(Date().timeIntervalSince1970 * 1000))
            }
            guard let pcm = normalized(buffer), pcm.frameLength > 0 else { return }
            append(pcm)
        }
    }

    /// Flush the resampler tail and close the current chunk. Blocks until the
    /// write queue drains; call only after capture has stopped.
    func close() {
        queue.sync {
            if let tail = drainConverter(), tail.frameLength > 0 {
                append(tail)
            }
            file = nil  // AVAudioFile finalizes its header on release
            converter = nil
            converterInputFormat = nil
        }
    }

    // MARK: queue-confined

    private func append(_ pcm: AVAudioPCMBuffer) {
        do {
            if file == nil {
                chunkIndex += 1
                let url = checkpointsDir.appendingPathComponent(
                    String(format: "%@-%06d.caf", channel, chunkIndex))
                file = try AVAudioFile(
                    forWriting: url,
                    settings: [
                        AVFormatIDKey: kAudioFormatLinearPCM,
                        AVSampleRateKey: SessionRecorder.sampleRate,
                        AVNumberOfChannelsKey: 1,
                        AVLinearPCMBitDepthKey: 32,
                        AVLinearPCMIsFloatKey: true,
                    ],
                    commonFormat: .pcmFormatFloat32,
                    interleaved: false
                )
                fileFrames = 0
            }
            try file?.write(from: pcm)
            fileFrames += AVAudioFramePosition(pcm.frameLength)
            if fileFrames >= Self.chunkFrames {
                file = nil  // rotate: bounded loss window if the process dies
            }
        } catch {
            // Disk-full or similar: transcription must keep working, so log
            // once and drop audio persistence for the rest of the session.
            if !reportedWriteFailure {
                reportedWriteFailure = true
                Events.emit([
                    "event": "status", "stage": "audio_save_failed", "channel": channel,
                    "reason": String(describing: error),
                ])
                Events.log("(\(channel)) audio checkpoint write failed — recording continues without saved audio: \(error)")
            }
            file = nil
        }
    }

    /// The mic path can deliver non-16k formats (the AEC tap runs at the
    /// hardware rate, and a mid-session mic switch can change it again), so
    /// anything that isn't already 16kHz mono float32 goes through a streaming
    /// AVAudioConverter that survives across buffers.
    private func normalized(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let f = buffer.format
        if f.sampleRate == Self.targetFormat.sampleRate,
            f.channelCount == 1,
            f.commonFormat == .pcmFormatFloat32,
            !f.isInterleaved
        {
            return buffer
        }
        if converter == nil || converterInputFormat != f {
            if let tail = drainConverter(), tail.frameLength > 0 {
                append(tail)
            }
            converter = AVAudioConverter(from: f, to: Self.targetFormat)
            converterInputFormat = f
        }
        guard let converter else { return nil }

        let ratio = Self.targetFormat.sampleRate / f.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.targetFormat, frameCapacity: capacity) else {
            return nil
        }
        var fed = false
        var conversionError: NSError?
        let status = converter.convert(to: out, error: &conversionError) { _, outStatus in
            if fed {
                outStatus.pointee = .noDataNow  // keep the stream open for the next buffer
                return nil
            }
            fed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error else {
            Events.log("(\(channel)) audio convert failed: \(String(describing: conversionError))")
            return nil
        }
        return out
    }

    private func drainConverter() -> AVAudioPCMBuffer? {
        guard let converter else { return nil }
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.targetFormat, frameCapacity: 4_096) else {
            return nil
        }
        var conversionError: NSError?
        let status = converter.convert(to: out, error: &conversionError) { _, outStatus in
            outStatus.pointee = .endOfStream
            return nil
        }
        return status == .error ? nil : out
    }
}

// MARK: - Merge-side chunk reader

/// Streams one channel's checkpoint chunks (plus its alignment silence prefix)
/// as a flat sequence of frames. Unreadable chunks — e.g. a file truncated by
/// the crash being recovered from — are skipped, not fatal.
private final class ChannelChunkReader {
    private let files: [URL]
    private var silenceRemaining: Int
    private var fileIndex = 0
    private var currentFile: AVAudioFile?
    private var readBuffer: AVAudioPCMBuffer?

    init(files: [URL], silencePrefixFrames: Int) {
        self.files = files
        self.silenceRemaining = silencePrefixFrames
    }

    /// Fill `target` (already zeroed by the caller) with up to `frames` frames.
    /// Returns how many frames this channel actually produced; 0 = exhausted.
    func fill(_ target: UnsafeMutablePointer<Float>, frames: Int) -> Int {
        var produced = 0
        while produced < frames {
            if silenceRemaining > 0 {
                let n = min(silenceRemaining, frames - produced)
                silenceRemaining -= n
                produced += n  // target is pre-zeroed — silence is a no-op
                continue
            }
            if currentFile == nil {
                guard fileIndex < files.count else { break }
                let url = files[fileIndex]
                fileIndex += 1
                do {
                    let file = try AVAudioFile(forReading: url)
                    currentFile = file
                    readBuffer = AVAudioPCMBuffer(
                        pcmFormat: file.processingFormat, frameCapacity: 16_384)
                } catch {
                    Events.log("skipping unreadable checkpoint \(url.lastPathComponent): \(error)")
                    continue
                }
            }
            guard let file = currentFile, let buffer = readBuffer else { break }
            // AVAudioFile throws (the famous nilError) when asked to read at
            // EOF, so stop on position — for a chunk truncated by a crash,
            // length reflects the frames that actually made it to disk.
            guard file.framePosition < file.length else {
                currentFile = nil
                continue
            }
            let remaining = file.length - file.framePosition
            let want = AVAudioFrameCount(min(Int64(frames - produced), min(remaining, Int64(buffer.frameCapacity))))
            do {
                try file.read(into: buffer, frameCount: want)
            } catch {
                Events.log("checkpoint read failed mid-file — keeping what was read: \(error)")
                currentFile = nil
                continue
            }
            let got = Int(buffer.frameLength)
            if got == 0 {
                currentFile = nil
                continue
            }
            if let source = buffer.floatChannelData?[0] {
                (target + produced).update(from: source, count: got)
            }
            produced += got
        }
        return produced
    }
}
