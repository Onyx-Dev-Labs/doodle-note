import AVFoundation
import Foundation

enum AudioSupport {
    static let sampleRate: Double = 16_000

    /// Wrap 16kHz mono float samples in an AVAudioPCMBuffer (the input type the
    /// streaming ASR managers accept — and the same shape live capture will produce).
    static func makePCMBuffer(_ samples: [Float]) throws -> AVAudioPCMBuffer {
        guard
            let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: 1,
                interleaved: false
            ),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        else {
            throw EngineError.internalError("could not allocate PCM buffer")
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        if let channel = buffer.floatChannelData?[0] {
            samples.withUnsafeBufferPointer { src in
                channel.update(from: src.baseAddress!, count: samples.count)
            }
        }
        return buffer
    }

    /// Deep-copy a PCM buffer. Audio-tap callbacks only guarantee their buffer is
    /// valid for the duration of the callback, so anything queued must be copied.
    static func copy(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameLength) else {
            return nil
        }
        copy.frameLength = source.frameLength
        let src = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let dst = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for (from, to) in zip(src, dst) {
            guard let fromData = from.mData, let toData = to.mData else { return nil }
            memcpy(toData, fromData, Int(min(from.mDataByteSize, to.mDataByteSize)))
        }
        return copy
    }
}
