import AVFoundation

/// Only repairs journaled PCM files created by this app. Originals are never rewritten.
enum AudioRecovery {
    struct OpenChunk: Codable {
        var version = 1
        let filename: String
        let sampleRate: Double
        let channels: UInt32
        var start: TimeInterval? = nil
    }
    struct Report {
        var recovered = 0
        var unreadable: [String] = []
        var discardedBytes: UInt64 = 0
        var incompleteCaptures: [String] = []
    }
    private struct Layout {
        let dataHeader: UInt64
        let dataStart: UInt64
        let completeBytes: UInt64
        let bytesPerFrame: UInt64
        let discardedBytes: UInt64
    }
    enum Failure: Error { case unsupported, malformed, empty, validation }

    static func journalURL(for file: URL) -> URL { file.appendingPathExtension("open.json") }
    static func recoveredURL(for file: URL) -> URL {
        file.deletingPathExtension().appendingPathExtension("recovered.caf")
    }
    static func begin(file: URL, format: AVAudioFormat, start: TimeInterval? = nil) throws {
        let journal = OpenChunk(filename: file.lastPathComponent,
                                sampleRate: format.sampleRate, channels: format.channelCount, start: start)
        try JSONEncoder().encode(journal).write(to: journalURL(for: file),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func complete(file: URL, expectedFrames: AVAudioFramePosition? = nil) throws {
        let journal = try JSONDecoder().decode(OpenChunk.self, from: Data(contentsOf: journalURL(for: file)))
        let audio = try AVAudioFile(forReading: file)
        guard journal.version == 1, journal.filename == file.lastPathComponent,
              audio.processingFormat.sampleRate == journal.sampleRate,
              audio.processingFormat.channelCount == journal.channels else { throw Failure.validation }
        if let expectedFrames, audio.length != expectedFrames { throw Failure.validation }
        if let start = journal.start {
            try AudioTimeline.save(.init(filename: file.lastPathComponent, start: start,
                frames: audio.length, sampleRate: audio.processingFormat.sampleRate,
                channels: audio.processingFormat.channelCount), for: file)
        }
        try FileManager.default.removeItem(at: journalURL(for: file))
    }

    static func recover(directory: URL) -> Report {
        var report = Report()
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for receipt in files where receipt.lastPathComponent.hasSuffix(".capture.json") {
            do {
                let saved = try JSONDecoder().decode(AudioChunkWriter.Report.self, from: Data(contentsOf: receipt))
                guard saved.schemaVersion == 1, saved.acceptedFrames >= 0, saved.savedFrames >= 0,
                      saved.savedFrames <= saved.acceptedFrames, saved.rejectedFrames >= 0 else { throw Failure.validation }
                if !saved.complete {
                    if saved.acceptedFrames > saved.savedFrames || saved.rejectedFrames > 0 {
                        report.incompleteCaptures.append("An interrupted capture has \(saved.acceptedFrames - saved.savedFrames) unconfirmed accepted frames and \(saved.rejectedFrames) rejected frames. Saved audio is preserved.")
                    } else {
                        report.incompleteCaptures.append("Capture finalization reported a failure. Saved audio is preserved and needs verification.")
                    }
                }
            } catch { report.unreadable.append(receipt.lastPathComponent) }
        }
        for journalURL in files where journalURL.lastPathComponent.hasSuffix(".caf.open.json") {
            do {
                let journal = try JSONDecoder().decode(OpenChunk.self, from: Data(contentsOf: journalURL))
                guard journal.version == 1, journal.channels > 0, journal.channels <= 32,
                      journal.sampleRate.isFinite, journal.sampleRate > 0,
                      URL(fileURLWithPath: journal.filename).lastPathComponent == journal.filename,
                      journal.filename.hasSuffix(".caf"), !journal.filename.hasPrefix("."),
                      journalURL.lastPathComponent == journal.filename + ".open.json"
                else { throw Failure.malformed }
                let original = directory.appendingPathComponent(journal.filename)
                let recovered = recoveredURL(for: original)
                let layout = try inspect(original: original, journal: journal)
                if !FileManager.default.fileExists(atPath: recovered.path) {
                    try repair(original: original, recovered: recovered, layout: layout)
                }
                let file = try AVAudioFile(forReading: recovered)
                guard file.length == AVAudioFramePosition(layout.completeBytes / layout.bytesPerFrame),
                      file.processingFormat.sampleRate == journal.sampleRate,
                      file.processingFormat.channelCount == journal.channels else { throw Failure.validation }
                if let start = journal.start {
                    try AudioTimeline.save(.init(filename: original.lastPathComponent, start: start,
                        frames: file.length, sampleRate: journal.sampleRate, channels: journal.channels), for: original)
                }
                report.recovered += 1
                report.discardedBytes += layout.discardedBytes
            } catch { report.unreadable.append(journalURL.lastPathComponent) }
        }
        return report
    }

    private static func inspect(original: URL, journal: OpenChunk) throws -> Layout {
        let source = try FileHandle(forReadingFrom: original)
        defer { try? source.close() }
        let size = try source.seekToEnd()
        try source.seek(toOffset: 0)
        guard try source.read(upToCount: 8) == Data([0x63, 0x61, 0x66, 0x66, 0, 1, 0, 0]) else {
            throw Failure.unsupported
        }
        var offset: UInt64 = 8
        var bytesPerFrame: UInt64?
        var dataHeader: UInt64?
        var dataStart: UInt64?
        while offset + 12 <= size, offset <= 1_048_576 {
            try source.seek(toOffset: offset)
            guard let header = try source.read(upToCount: 12), header.count == 12 else { throw Failure.malformed }
            let kind = String(decoding: header.prefix(4), as: UTF8.self)
            let count = readBE(header, at: 4, count: 8)
            if kind == "data" {
                guard bytesPerFrame != nil, size >= offset + 16 else { throw Failure.malformed }
                dataHeader = offset
                dataStart = offset + 16
                break
            }
            guard count <= size - offset - 12 else { throw Failure.malformed }
            if kind == "desc" {
                guard offset == 8, count == 32,
                      let description = try source.read(upToCount: 32), description.count == 32,
                      String(decoding: description[8..<12], as: UTF8.self) == "lpcm",
                      readBE(description, at: 12, count: 4) == 2,
                      readBE(description, at: 20, count: 4) == 1,
                      readBE(description, at: 24, count: 4) == UInt64(journal.channels),
                      readBE(description, at: 28, count: 4) == 16,
                      Double(bitPattern: readBE(description, at: 0, count: 8)) == journal.sampleRate
                else { throw Failure.unsupported }
                let frameBytes = readBE(description, at: 16, count: 4)
                guard frameBytes == UInt64(journal.channels) * 2 else { throw Failure.unsupported }
                bytesPerFrame = frameBytes
            } else if kind != "free" && kind != "chan" { throw Failure.unsupported }
            offset += 12 + count
        }
        guard let bytesPerFrame, let dataHeader, let dataStart else { throw Failure.malformed }
        let completeBytes = ((size - dataStart) / bytesPerFrame) * bytesPerFrame
        guard completeBytes > 0 else { throw Failure.empty }
        return Layout(dataHeader: dataHeader, dataStart: dataStart, completeBytes: completeBytes,
                      bytesPerFrame: bytesPerFrame, discardedBytes: size - dataStart - completeBytes)
    }

    private static func repair(original: URL, recovered: URL, layout: Layout) throws {
        let dataHeader = layout.dataHeader, dataStart = layout.dataStart
        let completeBytes = layout.completeBytes, bytesPerFrame = layout.bytesPerFrame
        // The journal identifies our data-last writer format. Trim a torn frame only in the copy.
        let temporary = recovered.appendingPathExtension(UUID().uuidString + ".tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try FileManager.default.copyItem(at: original, to: temporary)
        let destination = try FileHandle(forWritingTo: temporary)
        do {
            try destination.seek(toOffset: dataHeader + 4)
            var dataLength = (completeBytes + 4).bigEndian
            try withUnsafeBytes(of: &dataLength) { try destination.write(contentsOf: Data($0)) }
            try destination.truncate(atOffset: dataStart + completeBytes)
            try destination.synchronize()
            try destination.close()
        } catch { try? destination.close(); throw error }
        let test = try AVAudioFile(forReading: temporary)
        guard test.length == AVAudioFramePosition(completeBytes / bytesPerFrame) else { throw Failure.validation }
        try FileManager.default.moveItem(at: temporary, to: recovered)
    }

    private static func readBE(_ data: Data, at start: Int, count: Int) -> UInt64 {
        data[start..<(start + count)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }
}
