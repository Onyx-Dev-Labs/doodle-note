import AVFoundation
import FluidAudio
import Foundation

/// Decode all supported imports through AVFoundation into 16 kHz PCM WAV files
/// for the optional native Whisper backend. Does not load or download any model.
enum BatchAudioCommand {
    static func run(_ options: CLIOptions) async throws {
        let prepared = try await Commands.prepareAudioFile(options.requireFile())
        defer { prepared.removeTemporaryFiles() }
        guard let directory = options.values["output-dir"] else {
            throw EngineError.usage("prepare-batch-audio requires --output-dir")
        }
        let file = try AVAudioFile(forReading: prepared.url)
        let format = file.processingFormat
        let split = options.values["channels"] == "split"
        guard file.length > 0, format.channelCount > 0 else {
            throw EngineError.internalError("Audio file has no content")
        }
        guard !split || format.channelCount <= 2 else {
            throw EngineError.internalError("Split capture expects at most two audio channels")
        }
        let names = split && format.channelCount == 2 ? ["mic", "system"] : ["mic"]
        let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false)!
        let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
        let converters = names.map { _ in AudioConverter() }
        var outputs: [AVAudioFile] = []
        for name in names {
            let url = URL(fileURLWithPath: directory).appendingPathComponent("\(name).wav")
            outputs.append(try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
            ], commonFormat: .pcmFormatFloat32, interleaved: false))
        }
        let block = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 65536)!
        while file.framePosition < file.length {
            try file.read(into: block)
            if block.frameLength == 0 { break }
            for index in names.indices {
                let source: AVAudioPCMBuffer
                if split {
                    let channel = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: block.frameLength)!
                    channel.frameLength = block.frameLength
                    guard let input = block.floatChannelData?[index] else {
                        throw EngineError.internalError("Unable to decode capture channel")
                    }
                    channel.floatChannelData![0].update(from: input, count: Int(block.frameLength))
                    source = channel
                } else { source = block }
                let samples = try converters[index].resampleBuffer(source)
                if samples.isEmpty { continue }
                let buffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: AVAudioFrameCount(samples.count))!
                buffer.frameLength = AVAudioFrameCount(samples.count)
                samples.withUnsafeBufferPointer { pointer in
                    buffer.floatChannelData![0].update(from: pointer.baseAddress!, count: samples.count)
                }
                try outputs[index].write(from: buffer)
            }
        }
        outputs.removeAll() // Finalize WAV headers before announcing success.
        Events.emit(["event": "prepared", "channels": names,
                     "audioSeconds": Double(file.length) / format.sampleRate])
    }
}
