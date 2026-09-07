import AVFoundation
import XCTest
@testable import DoodleNoteNative

final class AudioTimelineTests: XCTestCase {
    private static func write(directory: URL, seconds: UInt32, start: TimeInterval, date: Date) async throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let packet = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: seconds * 16_000))
        packet.frameLength = seconds * 16_000
        memset(packet.floatChannelData![0], 0, Int(packet.frameLength) * 4)
        let writer = AudioChunkWriter(directory: directory, onCaptureError: { _ in }, onSpeechError: { _ in }, timelineStart: start, timestamp: date)
        writer.append(packet)
        let report = await writer.finish()
        XCTAssertTrue(report.complete)
    }

    func testMissingChunkAndClockRollbackNeverShiftLaterSourceTimes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try NoteDiskStore(root: root)
        let note = NoteRecord()
        try store.save(note)
        let directory = try store.audioDirectory(for: note.id)
        try await Self.write(directory: directory, seconds: 3, start: 0, date: Date(timeIntervalSince1970: 2))
        try await Self.write(directory: directory, seconds: 2, start: 3, date: Date(timeIntervalSince1970: 1))
        let plan = try store.playbackTimeline(for: note.id)
        XCTAssertEqual(plan.end, 5)
        XCTAssertEqual(try plan.resolve(3.5).offset, 0.5)
        XCTAssertEqual(try plan.resolve(3.5).index, 1)
        try FileManager.default.removeItem(at: plan.segments[0].url)
        let missing = try store.playbackTimeline(for: note.id)
        XCTAssertThrowsError(try missing.resolve(1))
        XCTAssertEqual(try missing.resolve(3.5).offset, 0.5)
        XCTAssertEqual(try store.recordingOffset(for: note.id), 5)
        XCTAssertThrowsError(try missing.resolve(.nan))
        XCTAssertThrowsError(try missing.resolve(5))
    }

    func testCorruptAudioCanBeRemovedButUnknownEndpointCannotBeCleared() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = try NoteDiskStore(root: root)
        var note = NoteRecord()
        note.text = "Retain personal notes"
        try disk.save(note)
        let legacy = NoteLifecycle.initial(noteID: note.id, libraryID: LibraryRecord.localID)
        let legacyBytes = try JSONEncoder().encode(legacy)
        XCTAssertNil(try JSONDecoder().decode(NoteLifecycle.self, from: legacyBytes).audioTimelineUncertain)
        XCTAssertFalse(String(decoding: legacyBytes, as: UTF8.self).contains("audioTimelineUncertain"))
        let directory = try disk.audioDirectory(for: note.id)
        try Data("broken audio".utf8).write(to: directory.appendingPathComponent("broken.caf"))
        let repository = LibraryRepository(disk: disk)
        let removed = try await repository.removeAudio(noteID: note.id, libraryID: LibraryRecord.localID,
            expectedGeneration: note.id, operationID: UUID(), confirmed: true, now: Date(), identities: [])
        XCTAssertEqual(removed.audioTimelineUncertain, true)
        XCTAssertTrue(disk.audioFiles(for: note.id).isEmpty)
        XCTAssertEqual(try disk.load().notes.first?.text, note.text)
        XCTAssertThrowsError(try disk.recordingOffset(for: note.id))
        var stale = removed
        stale.audioTimelineUncertain = nil
        try disk.saveLifecycle(stale)
        XCTAssertEqual(try disk.lifecycle(noteID: note.id, libraryID: LibraryRecord.localID).audioTimelineUncertain, true)
        XCTAssertThrowsError(try disk.recordingOffset(for: note.id))
    }

    @MainActor func testPlaybackInterruptionStopsWithoutAutoRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await Self.write(directory: directory, seconds: 3, start: 0, date: Date())
        let playback = LocalPlayback()
        playback.play(plan: try AudioTimeline.read(directory: directory, origin: 0), at: 0)
        XCTAssertTrue(playback.isPlaying)
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        for _ in 0..<100 where playback.isPlaying { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertFalse(playback.isPlaying)
        XCTAssertNotNil(playback.problem)
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])
        await Task.yield()
        XCTAssertFalse(playback.isPlaying)
    }

    func testOverlappingOrCorruptReceiptFailsWithoutRewritingEvidence() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await Self.write(directory: directory, seconds: 1, start: 0, date: Date(timeIntervalSince1970: 1))
        try await Self.write(directory: directory, seconds: 1, start: 1, date: Date(timeIntervalSince1970: 2))
        let plan = try AudioTimeline.read(directory: directory, origin: 0)
        let file = plan.segments[1].url
        let target = AudioTimeline.receiptURL(file)
        let overlap = AudioTimeline.Receipt(filename: file.lastPathComponent, start: 0, frames: 16_000, sampleRate: 16_000, channels: 1)
        let bytes = try JSONEncoder().encode(overlap)
        try bytes.write(to: target)
        XCTAssertThrowsError(try AudioTimeline.read(directory: directory, origin: 0))
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        try Data("invalid receipt".utf8).write(to: target)
        XCTAssertThrowsError(try AudioTimeline.read(directory: directory, origin: 0))
        XCTAssertEqual(try Data(contentsOf: target), Data("invalid receipt".utf8))
        XCTAssertThrowsError(try AudioTimeline.save(.init(filename: "../escape.caf", start: 0, frames: 1, sampleRate: 16_000, channels: 1), for: file))
    }
}
