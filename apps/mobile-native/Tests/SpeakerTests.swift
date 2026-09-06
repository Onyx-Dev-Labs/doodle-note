import AVFoundation
import CryptoKit
import XCTest
@testable import DoodleNoteNative

final class SpeakerTests: XCTestCase {
    func testBundledManifestPinsOnlyTheIntendedFourAssets() throws {
        let manifest = try SpeakerModelStore.manifest()
        XCTAssertEqual(manifest.revision, "ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1")
        XCTAssertEqual(manifest.files.count, 4)
        XCTAssertEqual(manifest.files.reduce(0) { $0 + $1.size }, 240_139_774)
    }
    func testFourSpeakersAndOverlapsAreLabeledWithoutGuessingNames() {
        let session = UUID()
        var annotations = SpeakerAnnotations()
        annotations.replace(sessionID: session, with: (0..<4).map {
            SpeakerTurn(sessionID: session, slot: $0, start: Double($0 * 2), end: Double($0 * 2 + 2), isFinal: true)
        })
        for slot in 0..<4 {
            XCTAssertEqual(annotations.label(for: TranscriptPassage(start: Double(slot * 2), end: Double(slot * 2 + 2),
                text: "A turn", isFinal: true)), "Speaker \(slot + 1)")
        }
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 1, end: 3, text: "Crosses a turn", isFinal: true)), "Multiple speakers")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 10, end: 12, text: "Unknown", isFinal: true)), "Unassigned speaker")
    }

    func testNameCorrectionSurvivesFinalizationButNotANewSessionSlot() throws {
        let first = UUID(), second = UUID()
        var annotations = SpeakerAnnotations()
        let draft = SpeakerTurn(sessionID: first, slot: 0, start: 0, end: 2, isFinal: false)
        let passage = TranscriptPassage(start: 0, end: 2, text: "Hello", isFinal: true)
        annotations.replace(sessionID: first, with: [draft])
        annotations.names[draft.key] = "Alex"
        XCTAssertEqual(annotations.label(for: passage), "Alex (provisional)")
        var final = draft
        final.isFinal = true
        annotations.replace(sessionID: first, with: [final])
        XCTAssertEqual(annotations.label(for: passage), "Alex")
        annotations.replace(sessionID: second, with: [SpeakerTurn(sessionID: second, slot: 0, start: 2, end: 4, isFinal: true)])
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 2, end: 4, text: "New session", isFinal: true)), "Speaker 2")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try NoteDiskStore(root: root)
        var note = NoteRecord()
        note.speakerAnnotations = annotations
        try store.save(note)
        XCTAssertEqual(try store.load().notes.first?.speakerAnnotations, annotations)
    }

    func testInsufficientOrDuplicatedCoverageStaysUnassigned() {
        let session = UUID()
        let turn = SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 0.5, isFinal: true)
        var annotations = SpeakerAnnotations()
        annotations.replace(sessionID: session, with: [turn, turn, turn])
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 0, end: 2, text: "Not covered", isFinal: true)), "Unassigned speaker")
    }

    func testLegacyNoteWithoutSpeakerAnnotationsStillDecodes() throws {
        let data = try JSONEncoder().encode(NoteRecord())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "speakerAnnotations")
        let decoded = try JSONDecoder().decode(NoteRecord.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(decoded.speakerAnnotations)
    }

    func testModelDigestRejectsCorruptionEvenWhenSizeMatches() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let good = Data("valid model".utf8)
        let hash = SHA256.hash(data: good).map { String(format: "%02x", $0) }.joined()
        let asset = SpeakerModelManifest.Asset(path: "weights.bin", size: good.count, sha256: hash)
        try good.write(to: file)
        XCTAssertNoThrow(try SpeakerModelStore.verify(file, asset: asset))
        try Data(repeating: 0, count: good.count).write(to: file)
        XCTAssertThrowsError(try SpeakerModelStore.verify(file, asset: asset))
    }

    func testSlowSpeakerConsumerDoesNotDiscardSavedAudio() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try NoteDiskStore(root: root), id = UUID()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1_600))
        buffer.frameLength = 1_600
        memset(buffer.floatChannelData![0], 0, 1_600 * MemoryLayout<Float>.size)
        let (stream, input) = AsyncStream<SpeakerAudio>.makeStream(bufferingPolicy: .bufferingOldest(1))
        let failure = expectation(description: "Speaker backlog is visible")
        let writer = AudioChunkWriter(directory: try store.audioDirectory(for: id), speakerInput: input,
            onCaptureError: { _ in }, onSpeechError: { _ in }, onSpeakerError: { _ in failure.fulfill() })
        for _ in 0..<5 { writer.append(buffer) }
        await writer.finish()
        var delivered = 0
        for await _ in stream { delivered += 1 }
        XCTAssertEqual(delivered, 1)
        await fulfillment(of: [failure], timeout: 2)
        let file = try AVAudioFile(forReading: XCTUnwrap(store.audioFiles(for: id).first))
        XCTAssertEqual(file.length, 8_000)
    }

    func testPinnedModelProcessesSyntheticAudioWhenProvided() async throws {
        guard let path = ProcessInfo.processInfo.environment["DOODLENOTE_SPEAKER_MODEL"] else {
            throw XCTSkip("Opt-in Core ML check requires the pinned local evaluation model.")
        }
        let worker = SpeakerWorker()
        try await worker.prepare(modelURL: URL(fileURLWithPath: path), sessionID: UUID(), offset: 0)
        for _ in 0..<20 { _ = try await worker.consume(SpeakerAudio(samples: [Float](repeating: 0, count: 1_600), sampleRate: 16_000)) }
        _ = try await worker.finish()
        let frames = await worker.processedFrames()
        XCTAssertGreaterThan(frames, 0)
    }
}
