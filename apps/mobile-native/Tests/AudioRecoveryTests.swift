import AVFoundation
import XCTest
@testable import DoodleNoteNative

final class AudioRecoveryTests: XCTestCase {
    func fixture() throws -> (NoteDiskStore, UUID, URL, AVAudioFormat) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = try NoteDiskStore(root: root)
        var note = NoteRecord()
        note.captureState = .recording
        try store.save(note)
        let url = try store.audioDirectory(for: note.id).appendingPathComponent("capture-000001.caf")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 2))
        var file: AVAudioFile? = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
        ])
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000))
        buffer.frameLength = 16_000
        for channel in 0..<2 {
            for frame in 0..<16_000 { buffer.floatChannelData![channel][frame] = channel == 0 ? 0.25 : -0.25 }
        }
        try file?.write(from: buffer)
        file = nil
        return (store, note.id, url, format)
    }

    func testStaleHeaderAndPartialFrameRecoverWithoutChangingOriginal() throws {
        let (store, id, original, format) = try fixture()
        try AudioRecovery.begin(file: original, format: format)
        var bytes = try Data(contentsOf: original)
        let marker = try XCTUnwrap(bytes.range(of: Data("data".utf8)))
        bytes.replaceSubrange((marker.lowerBound + 4)..<(marker.lowerBound + 12), with: Data(repeating: 0xff, count: 8))
        bytes.append(contentsOf: [0xaa, 0xbb])
        try bytes.write(to: original)
        let result = try store.load()
        XCTAssertEqual(result.notes.first?.captureState, .interrupted)
        XCTAssertTrue(result.audioProblems.isEmpty)
        XCTAssertEqual(try Data(contentsOf: original), bytes)
        let selected = try XCTUnwrap(store.audioFiles(for: id).first)
        XCTAssertEqual(selected, AudioRecovery.recoveredURL(for: original))
        let recovered = try AVAudioFile(forReading: selected)
        XCTAssertEqual(recovered.length, 16_000)
        let read = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: recovered.processingFormat, frameCapacity: 16_000))
        try recovered.read(into: read)
        XCTAssertEqual(read.floatChannelData![0][15_999], 0.25, accuracy: 0.001)
        XCTAssertEqual(read.floatChannelData![1][15_999], -0.25, accuracy: 0.001)
        _ = try store.load()
        XCTAssertEqual(store.audioFiles(for: id), [selected])
    }

    func testMalformedAudioIsReportedAndPreserved() throws {
        let (store, id, original, format) = try fixture()
        try AudioRecovery.begin(file: original, format: format)
        let bytes = Data("incomplete audio header".utf8)
        try bytes.write(to: original)
        let result = try store.load()
        XCTAssertEqual(result.audioProblems.count, 1)
        XCTAssertEqual(try Data(contentsOf: original), bytes)
        XCTAssertEqual(store.audioFiles(for: id), [original])
        XCTAssertFalse(FileManager.default.fileExists(atPath: AudioRecovery.recoveredURL(for: original).path))
    }
}
