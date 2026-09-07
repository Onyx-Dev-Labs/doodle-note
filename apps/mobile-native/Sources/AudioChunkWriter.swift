import AVFoundation
import Speech

/// The owned buffer is immutable after construction and used by one writer queue.
private final class OwnedPCM: @unchecked Sendable {
    let buffer: AVAudioPCMBuffer
    init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
}

/// AVAudioConverter invokes this supplier synchronously; the lock also makes repeated calls safe.
private final class ConverterSupply: @unchecked Sendable {
    let buffer: AVAudioPCMBuffer
    private let lock = NSLock()
    private var supplied = false
    init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    func take(_ status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        lock.withLock {
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
    }
}

enum CaptureError: LocalizedError {
    case microphone, format, backlog, conversion, speakerBacklog
    var errorDescription: String? {
        switch self {
        case .microphone: "Microphone access is needed to record. Enable it in Settings."
        case .format: "The microphone audio format is unavailable."
        case .backlog: "Audio capture could not keep up. Recording stopped to avoid an unreported gap."
        case .conversion: "Live transcription could not process the audio format. Audio is still being saved."
        case .speakerBacklog: "Speaker processing could not keep up. Speaker labels stopped."
        }
    }
}

/// All file/converter access belongs to `queue`. The lock protects admission and bounded queue depth.
/// The tap owns its input only for the callback, so accepted buffers are copied before enqueueing.
final class AudioChunkWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ai.doodlenote.audio-writer", qos: .userInitiated)
    private let analysisQueue = DispatchQueue(label: "ai.doodlenote.audio-analysis", qos: .utility)
    private let lock = NSLock()
    struct Report: Codable, Equatable, Sendable {
        var schemaVersion = 1
        var acceptedFrames: Int64 = 0
        var savedFrames: Int64 = 0
        var rejectedFrames: Int64 = 0
        var failures: [String] = []
        var complete: Bool { failures.isEmpty && rejectedFrames == 0 && acceptedFrames == savedFrames }
    }
    enum Stage: Sendable { case admission, open, write, afterWrite, finalize, analysis }
    private let fault: @Sendable (Stage) throws -> Void
    private var report = Report()
    private var analysisPending = 0
    private var analysisStopped = false
    private var accepting = true
    private var pending = 0
    private var pendingBytes = 0
    private var analysisBytes = 0
    private let directory: URL
    private let prefix: String
    private var timelineCursor: TimeInterval
    private var file: AVAudioFile?
    private var openFileURL: URL?
    private var index = 0
    private var writeFailed = false
    private var framesInChunk: AVAudioFramePosition = 0
    private var converter: AVAudioConverter?
    private let speechFormat: AVAudioFormat?
    private var speechInput: AsyncStream<AnalyzerInput>.Continuation?
    private var speakerInput: AsyncStream<SpeakerAudio>.Continuation?
    private let speakerConverter = SpeakerPCMConverter()
    private let onCaptureError: @Sendable (String) -> Void
    private let onSpeechError: @Sendable (String) -> Void
    private let onSpeakerError: @Sendable (String) -> Void

    init(directory: URL, speechFormat: AVAudioFormat? = nil,
         speechInput: AsyncStream<AnalyzerInput>.Continuation? = nil,
         speakerInput: AsyncStream<SpeakerAudio>.Continuation? = nil,
         onCaptureError: @escaping @Sendable (String) -> Void,
         onSpeechError: @escaping @Sendable (String) -> Void,
         onSpeakerError: @escaping @Sendable (String) -> Void = { _ in },
         fault: @escaping @Sendable (Stage) throws -> Void = { _ in },
         timelineStart: TimeInterval = 0, timestamp: Date = Date()) {
        self.timelineCursor = timelineStart
        self.fault = fault
        self.directory = directory
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        let previous = names.compactMap { UInt64($0.prefix(20)) }.max() ?? 0
        let rawClock = timestamp.timeIntervalSince1970 * 1_000_000
        let clock = rawClock.isFinite ? UInt64(max(0, min(rawClock, Double(UInt64.max / 2)))) : 0
        self.prefix = String(format: "%020llu", max(clock, previous < UInt64.max ? previous + 1 : previous)) + "-" + UUID().uuidString
        self.speechFormat = speechFormat
        self.speechInput = speechInput
        self.speakerInput = speakerInput
        self.onCaptureError = onCaptureError
        self.onSpeechError = onSpeechError
        self.onSpeakerError = onSpeakerError
    }

    func append(_ input: AVAudioPCMBuffer) {
        guard input.frameLength > 0 else { return }
        let bytes = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
            .reduce(0) { $0 + Int($1.mDataByteSize) }
        lock.lock()
        guard accepting else { lock.unlock(); return }
        do { try fault(.admission) } catch {
            accepting = false
            report.rejectedFrames += Int64(input.frameLength)
            report.failures.append(error.localizedDescription)
            lock.unlock()
            onCaptureError(error.localizedDescription)
            return
        }
        guard pending < 128, bytes > 0, bytes <= 8 * 1_024 * 1_024 - pendingBytes,
              let owned = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: input.frameLength) else {
            accepting = false
            report.rejectedFrames += Int64(input.frameLength)
            report.failures.append(CaptureError.backlog.localizedDescription)
            lock.unlock()
            onCaptureError(CaptureError.backlog.localizedDescription)
            return
        }
        owned.frameLength = input.frameLength
        let source = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
        let target = UnsafeMutableAudioBufferListPointer(owned.mutableAudioBufferList)
        for (src, dst) in zip(source, target) {
            if let s = src.mData, let d = dst.mData { memcpy(d, s, Int(src.mDataByteSize)) }
        }
        pending += 1
        pendingBytes += bytes
        report.acceptedFrames += Int64(input.frameLength)
        let packet = OwnedPCM(owned)
        queue.async { [self] in
            defer { lock.withLock { pending -= 1; pendingBytes -= bytes } }
            guard !writeFailed else { return }
            do { try write(packet.buffer) }
            catch {
                writeFailed = true
                lock.withLock { accepting = false; report.failures.append(error.localizedDescription) }
                onCaptureError(error.localizedDescription)
            }
        }
        lock.unlock()
    }

    /// A source-write barrier; does not stop admission or wait for speech processing.
    func drain() async -> Report {
        await withCheckedContinuation { continuation in
            queue.async { [self] in continuation.resume(returning: lock.withLock { report }) }
        }
    }

    @discardableResult
    func finish() async -> Report {
        await withCheckedContinuation { continuation in
            lock.lock()
            accepting = false
            queue.async { [self] in
                do { try closeChunk() } catch {
                    lock.withLock { report.failures.append(error.localizedDescription) }
                    onCaptureError(error.localizedDescription)
                }
                do {
                    try JSONEncoder().encode(lock.withLock { report }).write(
                        to: directory.appendingPathComponent(prefix + ".capture.json"),
                        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                } catch {
                    lock.withLock { report.failures.append("Capture status could not be saved. " + error.localizedDescription) }
                    onCaptureError(error.localizedDescription)
                }
                let result = lock.withLock { report }
                analysisQueue.async { [self] in
                flushSpeech()
                if speakerInput != nil {
                    do { try yieldSpeakers(speakerConverter.finish()) }
                    catch { onSpeakerError("Speaker finalization failed. Saved audio is preserved. \(error.localizedDescription)") }
                }
                speechInput?.finish()
                speechInput = nil
                speakerInput?.finish()
                speakerInput = nil
                }
                continuation.resume(returning: result)
            }
            lock.unlock()
        }
    }

    private func write(_ buffer: AVAudioPCMBuffer) throws {
        if file == nil {
            try fault(.open)
            let url = directory.appendingPathComponent("\(prefix)-\(String(format: "%06d", index)).caf")
            guard !FileManager.default.fileExists(atPath: url.path) else { throw CocoaError(.fileWriteFileExists) }
            try AudioRecovery.begin(file: url, format: buffer.format, start: timelineCursor)
            openFileURL = url
            file = try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: buffer.format.sampleRate,
                AVNumberOfChannelsKey: buffer.format.channelCount,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ], commonFormat: buffer.format.commonFormat, interleaved: buffer.format.isInterleaved)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        }
        try fault(.write)
        try file?.write(from: buffer)
        try fault(.afterWrite)
        lock.withLock { report.savedFrames += Int64(buffer.frameLength) }
        framesInChunk += AVAudioFramePosition(buffer.frameLength)
        timelineCursor += Double(buffer.frameLength) / buffer.format.sampleRate
        if Double(framesInChunk) >= buffer.format.sampleRate * 5 {
            try closeChunk()
            framesInChunk = 0
            index += 1
        }

        let analysisSize = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
            .reduce(0) { $0 + Int($1.mDataByteSize) }
        let admission = lock.withLock { () -> (accepted: Bool, failed: Bool) in
            guard !analysisStopped else { return (false, false) }
            guard analysisPending < 32, analysisSize <= 2 * 1_024 * 1_024 - analysisBytes else { analysisStopped = true; return (false, true) }
            analysisPending += 1
            analysisBytes += analysisSize
            return (true, false)
        }
        if admission.failed {
            analysisQueue.async { [self] in
                speechInput?.finish(); speechInput = nil
                speakerInput?.finish(); speakerInput = nil
                onSpeechError("Live transcription could not keep up. Source audio continues to be saved.")
                onSpeakerError("Speaker processing could not keep up. Source audio continues to be saved.")
            }
        }
        guard admission.accepted else { return }
        let packet = OwnedPCM(buffer)
        analysisQueue.async { [self] in
            defer { lock.withLock { analysisPending -= 1; analysisBytes -= analysisSize } }
            analyze(packet.buffer)
        }
    }

    private func analyze(_ buffer: AVAudioPCMBuffer) {
        do { try fault(.analysis) } catch {
            speechInput?.finish(); speechInput = nil
            speakerInput?.finish(); speakerInput = nil
            onSpeechError(error.localizedDescription)
            onSpeakerError(error.localizedDescription)
            return
        }
        feedSpeakers(buffer)
        // Speech has a separate failure path. Saved audio remains available for later processing.
        guard let speechInput, let speechFormat else { return }
        do {
            let converted = try convert(buffer, to: speechFormat)
            guard converted.frameLength > 0 else { return }
            switch speechInput.yield(AnalyzerInput(buffer: converted)) {
            case .dropped, .terminated:
                throw CaptureError.conversion
            case .enqueued: break
            @unknown default: throw CaptureError.conversion
            }
        } catch {
            speechInput.finish()
            self.speechInput = nil
            onSpeechError(error.localizedDescription)
        }
    }

    private func feedSpeakers(_ buffer: AVAudioPCMBuffer) {
        guard speakerInput != nil else { return }
        do { try yieldSpeakers(speakerConverter.convert(buffer)) }
        catch {
            speakerInput?.finish()
            self.speakerInput = nil
            onSpeakerError("Speaker processing stopped. Audio and transcription continue. \(error.localizedDescription)")
        }
    }

    private func yieldSpeakers(_ samples: [Float]) throws {
        guard let speakerInput, !samples.isEmpty else { return }
        switch speakerInput.yield(SpeakerAudio(samples: samples, sampleRate: 16_000)) {
        case .dropped, .terminated:
            throw CaptureError.speakerBacklog
        case .enqueued: break
        @unknown default: throw CaptureError.conversion
        }
    }

    private func closeChunk() throws {
        file = nil
        guard let url = openFileURL else { return }
        if !writeFailed { try fault(.finalize); try AudioRecovery.complete(file: url) }
        openFileURL = nil
    }

    private func convert(_ input: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        if input.format == format { return input }
        if converter == nil {
            converter = AVAudioConverter(from: input.format, to: format)
            converter?.primeMethod = .none
        }
        guard let converter,
              let output = AVAudioPCMBuffer(pcmFormat: format,
                  frameCapacity: AVAudioFrameCount(ceil(Double(input.frameLength) * format.sampleRate / input.format.sampleRate)) + 32)
        else { throw CaptureError.conversion }
        let supply = ConverterSupply(input)
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            supply.take(inputStatus)
        }
        if let error { throw error }
        guard status != .error else { throw CaptureError.conversion }
        return output
    }

    private func flushSpeech() {
        guard let converter, let speechFormat, let speechInput else { return }
        defer { self.converter = nil }
        do {
            while true {
                guard let output = AVAudioPCMBuffer(pcmFormat: speechFormat, frameCapacity: 4096) else {
                    throw CaptureError.conversion
                }
                var error: NSError?
                let status = converter.convert(to: output, error: &error) { _, inputStatus in
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                if let error { throw error }
                guard status != .error else { throw CaptureError.conversion }
                if output.frameLength > 0,
                   case .dropped = speechInput.yield(AnalyzerInput(buffer: output)) {
                    throw CaptureError.conversion
                }
                if status == .endOfStream || output.frameLength == 0 { break }
            }
        } catch { onSpeechError(error.localizedDescription) }
    }
}
