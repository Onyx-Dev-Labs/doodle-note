import AVFoundation
import XCTest
@testable import DoodleNoteNative

private final class CaptureFaults: @unchecked Sendable {
    private let lock = NSLock()
    var stage: AudioChunkWriter.Stage?
    private var fired = false
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    var blockAnalysis = false
    private var blocked = false
    init(_ stage: AudioChunkWriter.Stage? = nil) { self.stage = stage }
    func apply(_ current: AudioChunkWriter.Stage) throws {
        let shouldBlock = lock.withLock { () -> Bool in
            guard current == .analysis, blockAnalysis, !blocked else { return false }
            blocked = true; return true
        }
        if shouldBlock { entered.signal(); release.wait() }
        let shouldFail = lock.withLock { () -> Bool in
            guard current == stage, !fired else { return false }
            fired = true; return true
        }
        if shouldFail { throw CocoaError(.fileWriteOutOfSpace) }
    }
}

final class CaptureDurabilityTests: XCTestCase {
    private func buffer(frames: UInt32 = 16_000) throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let value = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames))
        value.frameLength = frames
        for index in 0..<Int(frames) { value.floatChannelData![0][index] = index.isMultiple(of: 2) ? 0.25 : -0.25 }
        return value
    }

    func testTwoHoursPlusTailPreserveEverySourceFrame() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = AudioChunkWriter(directory: directory, onCaptureError: { _ in }, onSpeechError: { _ in })
        let packet = try buffer()
        for second in 0..<7_203 {
            writer.append(packet)
            if second.isMultiple(of: 32) { _ = await writer.drain() }
        }
        let report = await writer.finish()
        XCTAssertTrue(report.complete)
        XCTAssertEqual(report.savedFrames, 7_203 * 16_000)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        XCTAssertFalse(files.contains { $0.lastPathComponent.hasSuffix(".open.json") })
        var frames: Int64 = 0
        for url in files where url.pathExtension == "caf" {
            let file = try AVAudioFile(forReading: url)
            frames += file.length
            let sample = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 2))
            try file.read(into: sample, frameCount: 2)
            XCTAssertEqual(sample.floatChannelData![0][0], 0.25, accuracy: 0.001)
            file.framePosition = file.length - 2
            try file.read(into: sample, frameCount: 2)
            XCTAssertEqual(sample.floatChannelData![0][1], -0.25, accuracy: 0.001)
        }
        XCTAssertEqual(frames, report.savedFrames)
        let replay = await writer.finish()
        XCTAssertEqual(replay, report)
    }

    func testOversizedAdmissionIsExplicitAndBounded() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = AudioChunkWriter(directory: directory, onCaptureError: { _ in }, onSpeechError: { _ in })
        writer.append(try buffer(frames: 2_200_000))
        let report = await writer.finish()
        XCTAssertFalse(report.complete)
        XCTAssertEqual(report.acceptedFrames, 0)
        XCTAssertEqual(report.savedFrames, 0)
        XCTAssertEqual(report.rejectedFrames, 2_200_000)
    }

    func testSlowAnalysisCannotHoldSourceFinalization() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let faults = CaptureFaults()
        faults.blockAnalysis = true
        let writer = AudioChunkWriter(directory: directory, onCaptureError: { _ in }, onSpeechError: { _ in }, fault: faults.apply)
        let packet = try buffer()
        writer.append(packet)
        _ = await writer.drain()
        XCTAssertEqual(faults.entered.wait(timeout: .now() + 2), .success)
        defer { faults.release.signal() }
        for index in 0..<64 {
            writer.append(packet)
            if index.isMultiple(of: 16) { _ = await writer.drain() }
        }
        let report = await writer.finish()
        XCTAssertTrue(report.complete)
        XCTAssertEqual(report.savedFrames, 65 * 16_000)
    }

    func testAdmissionWriteAndFinalizationFailuresNeverReportComplete() async throws {
        for stage in [AudioChunkWriter.Stage.admission, .open, .write, .afterWrite, .finalize] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let faults = CaptureFaults(stage)
            let writer = AudioChunkWriter(directory: directory, onCaptureError: { _ in }, onSpeechError: { _ in }, fault: faults.apply)
            writer.append(try buffer())
            let report = await writer.finish()
            XCTAssertFalse(report.complete)
            XCTAssertFalse(report.failures.isEmpty)
            if stage == .finalize { XCTAssertEqual(report.savedFrames, 16_000) }
            else { XCTAssertEqual(report.savedFrames, 0) }
            if stage == .afterWrite {
                let recovery = AudioRecovery.recover(directory: directory)
                XCTAssertEqual(recovery.recovered, 1)
                XCTAssertFalse(recovery.incompleteCaptures.isEmpty)
                let timeline = try AudioTimeline.read(directory: directory, origin: 0)
                XCTAssertEqual(timeline.end, 1)
            }
        }
    }
}
