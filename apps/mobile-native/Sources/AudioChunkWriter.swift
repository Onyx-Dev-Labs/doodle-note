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
    case microphone, format, backlog, conversion
    var errorDescription: String? {
        switch self {
        case .microphone: "Microphone access is needed to record. Enable it in Settings."
        case .format: "The microphone audio format is unavailable."
        case .backlog: "Audio capture could not keep up. Recording stopped to avoid an unreported gap."
        case .conversion: "Live transcription could not process the audio format. Audio is still being saved."
        }
    }
}

/// All file/converter access belongs to `queue`. The lock protects admission and bounded queue depth.
/// The tap owns its input only for the callback, so accepted buffers are copied before enqueueing.
final class AudioChunkWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ai.doodlenote.audio-writer", qos: .userInitiated)
    private let lock = NSLock()
    private var accepting = true
    private var pending = 0
    private let directory: URL
    private let prefix: String
    private var file: AVAudioFile?
    private var openFileURL: URL?
    private var index = 0
    private var writeFailed = false
    private var framesInChunk: AVAudioFramePosition = 0
    private var converter: AVAudioConverter?
    private let speechFormat: AVAudioFormat?
    private var speechInput: AsyncStream<AnalyzerInput>.Continuation?
    private var speakerInput: AsyncStream<SpeakerAudio>.Continuation?
    private let onCaptureError: @Sendable (String) -> Void
    private let onSpeechError: @Sendable (String) -> Void
    private let onSpeakerError: @Sendable (String) -> Void

    init(directory: URL, speechFormat: AVAudioFormat? = nil,
         speechInput: AsyncStream<AnalyzerInput>.Continuation? = nil,
         speakerInput: AsyncStream<SpeakerAudio>.Continuation? = nil,
         onCaptureError: @escaping @Sendable (String) -> Void,
         onSpeechError: @escaping @Sendable (String) -> Void,
         onSpeakerError: @escaping @Sendable (String) -> Void = { _ in }) {
        self.directory = directory
        self.prefix = String(format: "%020.0f", Date().timeIntervalSince1970 * 1_000_000)
        self.speechFormat = speechFormat
        self.speechInput = speechInput
        self.speakerInput = speakerInput
        self.onCaptureError = onCaptureError
        self.onSpeechError = onSpeechError
        self.onSpeakerError = onSpeakerError
    }

    func append(_ input: AVAudioPCMBuffer) {
        lock.lock()
        guard accepting else { lock.unlock(); return }
        guard pending < 128,
              let owned = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: input.frameLength) else {
            accepting = false
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
        let packet = OwnedPCM(owned)
        queue.async { [self] in
            defer { lock.withLock { pending -= 1 } }
            guard !writeFailed else { return }
            do { try write(packet.buffer) }
            catch {
                writeFailed = true
                lock.withLock { accepting = false }
                onCaptureError(error.localizedDescription)
            }
        }
        lock.unlock()
    }

    func finish() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            accepting = false
            queue.async { [self] in
                do { try closeChunk() } catch { onCaptureError(error.localizedDescription) }
                flushSpeech()
                speechInput?.finish()
                speechInput = nil
                speakerInput?.finish()
                speakerInput = nil
                continuation.resume()
            }
            lock.unlock()
        }
    }

    private func write(_ buffer: AVAudioPCMBuffer) throws {
        if file == nil {
            let url = directory.appendingPathComponent("\(prefix)-\(String(format: "%06d", index)).caf")
            try AudioRecovery.begin(file: url, format: buffer.format)
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
        try file?.write(from: buffer)
        framesInChunk += AVAudioFramePosition(buffer.frameLength)
        if Double(framesInChunk) >= buffer.format.sampleRate * 5 {
            try closeChunk()
            framesInChunk = 0
            index += 1
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
        guard let speakerInput else { return }
        guard let channels = buffer.floatChannelData else {
            speakerInput.finish()
            self.speakerInput = nil
            onSpeakerError("Speaker labels stopped because the microphone format changed. Audio is preserved.")
            return
        }
        let count = Int(buffer.format.channelCount)
        var mono = [Float](repeating: 0, count: Int(buffer.frameLength))
        for frame in mono.indices {
            for channel in 0..<count {
                mono[frame] += buffer.format.isInterleaved ? channels[0][frame * count + channel] : channels[channel][frame]
            }
            mono[frame] /= Float(count)
        }
        switch speakerInput.yield(SpeakerAudio(samples: mono, sampleRate: buffer.format.sampleRate)) {
        case .dropped, .terminated:
            speakerInput.finish()
            self.speakerInput = nil
            onSpeakerError("Speaker processing could not keep up. Labels stopped; audio and transcription continue.")
        case .enqueued: break
        @unknown default: break
        }
    }

    private func closeChunk() throws {
        file = nil
        guard let url = openFileURL else { return }
        if !writeFailed { try AudioRecovery.complete(file: url) }
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
