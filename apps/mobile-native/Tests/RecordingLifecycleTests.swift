import AVFoundation
import XCTest
@testable import DoodleNoteNative

@MainActor private final class FakeCaptureHardware: CaptureHardware {
    let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
    let eventSource = NSObject()
    var notificationObject: AnyObject? { eventSource }
    var failStart = false
    var starts = 0
    var stops = 0
    var deactivations = 0
    func start(writer: AudioChunkWriter) throws {
        starts += 1
        if failStart { throw CaptureError.format }
        let packet = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000)!
        packet.frameLength = 16_000
        memset(packet.floatChannelData![0], 0, 16_000 * 4)
        writer.append(packet)
    }
    func stop() { stops += 1 }
    func deactivate() { deactivations += 1 }
}

@MainActor final class RecordingLifecycleTests: XCTestCase {
    func testCanceledPermissionCannotStartOrCreateAudioAfterward() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        await library.flush()
        var pending: CheckedContinuation<Bool, Never>?
        let entered = expectation(description: "Permission entered")
        var hardwareCreated = 0
        let recording = RecordingSession(recordPermission: {
            await withCheckedContinuation { pending = $0; entered.fulfill() }
        }, makeHardware: { hardwareCreated += 1; return FakeCaptureHardware() }, analysisEnabled: false)
        let start = Task { await recording.start(id, library: library) }
        await fulfillment(of: [entered], timeout: 2)
        XCTAssertEqual(recording.preparingNoteID, id)
        await recording.stop(library: library)
        pending?.resume(returning: true)
        await start.value
        XCTAssertEqual(hardwareCreated, 0)
        XCTAssertNil(recording.noteID)
        XCTAssertFalse(recording.busy)
        XCTAssertEqual(library.note(id)?.captureState, .idle)
        XCTAssertFalse(FileManager.default.fileExists(atPath: try XCTUnwrap(library.disk).directory(for: id).appendingPathComponent("audio").path))
    }

    func testFinalizeFailurePersistsInterruptedStateBeforeReturning() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let hardware = FakeCaptureHardware()
        let recording = RecordingSession(recordPermission: { true }, makeHardware: { hardware }, analysisEnabled: false,
            writerFault: { if $0 == .finalize { throw CocoaError(.fileWriteOutOfSpace) } })
        await recording.start(id, library: library)
        XCTAssertEqual(recording.noteID, id)
        await recording.stop(library: library)
        XCTAssertEqual(recording.lastReport?.savedFrames, 16_000)
        XCTAssertEqual(recording.lastReport?.complete, false)
        XCTAssertNotNil(recording.problem)
        XCTAssertEqual(library.note(id)?.captureState, .interrupted)
        XCTAssertEqual(try library.disk?.load().notes.first(where: { $0.id == id })?.captureState, .interrupted)
        XCTAssertEqual(hardware.deactivations, 1)
    }

    func testFailedStatusWriteRemainsVisibleAndRetriesAsInterrupted() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let recording = RecordingSession(recordPermission: { true }, makeHardware: { FakeCaptureHardware() }, analysisEnabled: false)
        await recording.start(id, library: library)
        let disk = try XCTUnwrap(library.disk)
        let file = disk.directory(for: id).appendingPathComponent("note.json")
        let original = try Data(contentsOf: file)
        try original.write(to: root.appendingPathComponent("preserved-synthetic-source.json"))
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        await recording.stop(library: library)
        XCTAssertEqual(recording.lastReport?.complete, true)
        XCTAssertEqual(library.note(id)?.captureState, .interrupted)
        XCTAssertNotNil(library.saveProblem)
        XCTAssertTrue(recording.problem?.contains("status could not be saved") == true)
        let failed = await library.flush(noteID: id)
        XCTAssertFalse(failed)
        try FileManager.default.removeItem(at: file)
        try original.write(to: file)
        library.retrySaving()
        let retried = await library.flush(noteID: id)
        XCTAssertTrue(retried)
        XCTAssertNil(library.saveProblem)
        XCTAssertEqual(try disk.load().notes.first?.captureState, .interrupted)
    }

    func testHardwareStartFailureKeepsInterruptedNoteAndCanRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let hardware = FakeCaptureHardware()
        hardware.failStart = true
        let recording = RecordingSession(recordPermission: { true }, makeHardware: { hardware }, analysisEnabled: false)
        await recording.start(id, library: library)
        XCTAssertNil(recording.noteID)
        XCTAssertFalse(recording.busy)
        XCTAssertEqual(library.note(id)?.captureState, .interrupted)
        XCTAssertNotNil(recording.problem)
        hardware.failStart = false
        await recording.start(id, library: library)
        XCTAssertEqual(recording.noteID, id)
        await recording.stop(library: library)
        XCTAssertEqual(library.note(id)?.captureState, .finished)
    }

    func testRouteInterruptionStopsAndRequiresDeliberateResume() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let id = try XCTUnwrap(library.create())
        let hardware = FakeCaptureHardware()
        let recording = RecordingSession(recordPermission: { true }, makeHardware: { hardware }, analysisEnabled: false)
        await recording.start(id, library: library)
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: hardware.eventSource)
        for _ in 0..<100 where recording.noteID != nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertNil(recording.noteID)
        XCTAssertEqual(library.note(id)?.captureState, .interrupted)
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])
        await Task.yield()
        XCTAssertEqual(hardware.starts, 1)
        await recording.start(id, library: library)
        XCTAssertEqual(hardware.starts, 2)
        await recording.stop(library: library)
        XCTAssertEqual(recording.lastReport?.complete, true)
    }
}
