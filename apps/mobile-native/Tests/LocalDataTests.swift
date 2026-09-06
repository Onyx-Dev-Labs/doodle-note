import AVFoundation
import PencilKit
import Speech
import XCTest
@testable import DoodleNoteNative

final class LocalDataTests: XCTestCase {
    func temporaryStore() throws -> NoteDiskStore {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return try NoteDiskStore(root: url)
    }

    func testTextInkAndTranscriptSurviveReopen() throws {
        let store = try temporaryStore()
        var note = NoteRecord()
        note.title = "Discovery"
        note.text = "A personal detail not in the transcript"
        let points = [CGPoint(x: 10, y: 10), CGPoint(x: 80, y: 40)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index) * 0.1, size: CGSize(width: 3, height: 3),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date())
        note.ink = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: path)]).dataRepresentation()
        note.language = .danish
        note.apply(TranscriptPassage(start: 0, end: 2, text: "Godmorgen", isFinal: true))
        try store.save(note)
        let result = try NoteDiskStore(root: store.root).load()
        XCTAssertEqual(result.notes, [note])
        XCTAssertTrue(result.unreadable.isEmpty)
        XCTAssertEqual(try PKDrawing(data: XCTUnwrap(result.notes.first).ink).strokes.count, 1)
    }

    func testInterruptedCaptureIsRecoveredWithoutLosingAudio() throws {
        let store = try temporaryStore()
        var note = NoteRecord()
        note.captureState = .recording
        try store.save(note)
        let audio = try store.audioDirectory(for: note.id).appendingPathComponent("original.caf")
        let bytes = Data([1, 2, 3])
        try bytes.write(to: audio)
        let recovered = try store.load()
        XCTAssertEqual(recovered.notes.first?.captureState, .interrupted)
        XCTAssertEqual(try Data(contentsOf: audio), bytes)
        XCTAssertEqual(try store.load().notes.first?.captureState, .interrupted)
    }

    func testCorruptAndFutureNotesRemainUntouchedWhileHealthyNotesLoad() throws {
        let store = try temporaryStore()
        let good = NoteRecord()
        var future = NoteRecord()
        future.schemaVersion = 100
        try store.save(good)
        try store.save(future)
        let badID = UUID()
        let badDir = store.directory(for: badID)
        try FileManager.default.createDirectory(at: badDir, withIntermediateDirectories: true)
        let bytes = Data("incomplete json".utf8)
        let file = badDir.appendingPathComponent("note.json")
        try bytes.write(to: file)
        let result = try store.load()
        XCTAssertEqual(result.notes, [good])
        XCTAssertEqual(Set(result.unreadable), Set([badID.uuidString, future.id.uuidString]))
        XCTAssertEqual(try Data(contentsOf: file), bytes)
    }

    func testSpeechRevisionsReplaceDraftsWithoutDuplicatingFinalText() {
        var note = NoteRecord()
        note.apply(TranscriptPassage(start: 0, end: 1, text: "Hel", isFinal: false))
        note.apply(TranscriptPassage(start: 0, end: 2, text: "Hello there", isFinal: false))
        note.apply(TranscriptPassage(start: 0, end: 2, text: "Hello there.", isFinal: true))
        note.apply(TranscriptPassage(start: 0, end: 2, text: "Incorrect draft", isFinal: false))
        note.apply(TranscriptPassage(start: 2, end: 3, text: "Next", isFinal: true))
        XCTAssertEqual(note.passages.map(\.text), ["Hello there.", "Next"])
        XCTAssertTrue(note.passages.allSatisfy { $0.isFinal && $0.speakerName == nil })
    }

    func testChunkWriterPreservesEveryFrameAndClosesOnFinish() async throws {
        let store = try temporaryStore()
        let id = UUID()
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000))
        buffer.frameLength = 16_000
        memset(buffer.floatChannelData![0], 0, 16_000 * MemoryLayout<Float>.size)
        let writer = AudioChunkWriter(directory: try store.audioDirectory(for: id),
                                      onCaptureError: { _ in }, onSpeechError: { _ in })
        for _ in 0..<12 { writer.append(buffer) }
        await writer.finish()
        writer.append(buffer)
        await writer.finish()
        let files = store.audioFiles(for: id)
        XCTAssertEqual(files.count, 3)
        let frames = try files.reduce(Int64(0)) { total, url in total + (try AVAudioFile(forReading: url).length) }
        XCTAssertEqual(frames, 192_000)
    }

    func testSpeechConversionDoesNotChangeSavedSourceAudio() async throws {
        let store = try temporaryStore()
        let id = UUID()
        let sourceFormat = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2))
        let speechFormat = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: 4_800))
        buffer.frameLength = 4_800
        for channel in 0..<2 { memset(buffer.floatChannelData![channel], 0, 4_800 * MemoryLayout<Float>.size) }
        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingOldest(128))
        let writer = AudioChunkWriter(directory: try store.audioDirectory(for: id),
            speechFormat: speechFormat, speechInput: input, onCaptureError: { _ in }, onSpeechError: { _ in })
        for _ in 0..<20 { writer.append(buffer) }
        await writer.finish()
        var convertedFrames = 0
        for await item in stream {
            XCTAssertEqual(item.buffer.format.sampleRate, 16_000)
            XCTAssertEqual(item.buffer.format.channelCount, 1)
            convertedFrames += Int(item.buffer.frameLength)
        }
        XCTAssertEqual(convertedFrames, 32_000, accuracy: 32)
        let file = try AVAudioFile(forReading: XCTUnwrap(store.audioFiles(for: id).first))
        XCTAssertEqual(file.length, 96_000)
        XCTAssertEqual(file.processingFormat.channelCount, 2)
        XCTAssertEqual(file.processingFormat.sampleRate, 48_000)
    }
}
