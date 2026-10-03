import AVFoundation

/// Confined to the audio writer queue. Preserve resampling state across tap callbacks.
final class SpeakerPCMConverter {
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var sourceFrames: Int64 = 0
    private var emittedFrames = 0
    private let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!

    func convert(_ input: AVAudioPCMBuffer) throws -> [Float] {
        if sourceFormat == nil {
            sourceFormat = input.format
            sourceFrames = 0
            emittedFrames = 0
            converter = AVAudioConverter(from: input.format, to: outputFormat)
            converter?.primeMethod = .none
            converter?.downmix = true
        }
        guard sourceFormat == input.format, let converter else { throw CaptureError.format }
        sourceFrames += Int64(input.frameLength)
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 16_000 / input.format.sampleRate)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            throw CaptureError.conversion
        }
        let supply = Supply(input)
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in supply.take(state) }
        if let error { throw error }
        guard status != .error else { throw CaptureError.conversion }
        return samples(output)
    }

    func finish() throws -> [Float] {
        guard let converter else { return [] }
        defer { self.converter = nil; sourceFormat = nil }
        var result: [Float] = []
        while true {
            guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: 4096) else {
                throw CaptureError.conversion
            }
            var error: NSError?
            let status = converter.convert(to: output, error: &error) { _, state in
                state.pointee = .endOfStream
                return nil
            }
            if let error { throw error }
            guard status != .error else { throw CaptureError.conversion }
            result += samples(output)
            if status == .endOfStream || output.frameLength == 0 { return result }
        }
    }

    private func samples(_ buffer: AVAudioPCMBuffer) -> [Float] {
        guard buffer.frameLength > 0, let channel = buffer.floatChannelData?[0], let sourceFormat else { return [] }
        // AVAudioConverter can emit filter padding at end-of-stream. It must not extend the recording clock.
        let expected = Int((Double(sourceFrames) * 16_000 / sourceFormat.sampleRate).rounded(.down))
        let count = min(Int(buffer.frameLength), max(0, expected - emittedFrames))
        emittedFrames += count
        return Array(UnsafeBufferPointer(start: channel, count: count))
    }

    private final class Supply: @unchecked Sendable {
        let buffer: AVAudioPCMBuffer
        private var supplied = false
        private let lock = NSLock()
        init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
        func take(_ status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
            lock.withLock {
                guard !supplied else { status.pointee = .noDataNow; return nil }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
        }
    }
}
