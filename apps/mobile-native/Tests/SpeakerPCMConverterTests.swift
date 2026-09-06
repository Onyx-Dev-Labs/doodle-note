import AVFoundation
import XCTest
@testable import DoodleNoteNative

final class SpeakerPCMConverterTests: XCTestCase {
    func testSpeakerClockAndWaveformDoNotDependOnMicrophonePacketSize() throws {
        for rate in [44_100.0, 48_000.0] {
            let small = try converted(rate: rate, packetSize: 4096)
            let large = try converted(rate: rate, packetSize: 16_384)
            XCTAssertEqual(small.count, 32_000, accuracy: 2, "rate \(rate)")
            XCTAssertEqual(small.count, large.count)
            let largestDifference = zip(small, large).map { abs($0 - $1) }.max() ?? 0
            XCTAssertLessThan(largestDifference, 0.001, "No packet-boundary padding or filter reset")
        }
    }

    func testBothStereoChannelsReachTheSpeakerModel() throws {
        let left = try converted(rate: 48_000, packetSize: 4096, activeChannel: 0)
        let right = try converted(rate: 48_000, packetSize: 4096, activeChannel: 1)
        XCTAssertGreaterThan(right.map { abs($0) }.max() ?? 0, 0.02)
        XCTAssertEqual(left.count, right.count)
        XCTAssertLessThan(zip(left, right).map { abs($0 - $1) }.max() ?? 0, 0.001)
    }

    private func converted(rate: Double, packetSize: Int, activeChannel: Int? = nil) throws -> [Float] {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2))
        let converter = SpeakerPCMConverter()
        let count = Int(rate * 2)
        var result: [Float] = []
        for start in stride(from: 0, to: count, by: packetSize) {
            let frames = min(packetSize, count - start)
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)))
            buffer.frameLength = AVAudioFrameCount(frames)
            for index in 0..<frames {
                let sample = Float(sin(Double(start + index) * 2 * .pi * 440 / rate)) * 0.25
                buffer.floatChannelData![0][index] = activeChannel == 1 ? 0 : sample
                buffer.floatChannelData![1][index] = activeChannel == 0 ? 0 : sample
            }
            result += try converter.convert(buffer)
        }
        result += try converter.finish()
        XCTAssertTrue(try converter.finish().isEmpty)
        return result
    }
}
