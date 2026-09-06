import AVFoundation

/// Only repairs journaled PCM files created by this app. Originals are never rewritten.
enum AudioRecovery {
    struct OpenChunk: Codable {
        var version = 1
        let filename: String
        let sampleRate: Double
        let channels: UInt32
    }
    struct Report { var recovered = 0; var unreadable: [String] = [] }
    enum Failure: Error { case unsupported, malformed, empty, validation }

    static func journalURL(for file: URL) -> URL { file.appendingPathExtension("open.json") }
    static func recoveredURL(for file: URL) -> URL {
        file.deletingPathExtension().appendingPathExtension("recovered.caf")
    }
    static func begin(file: URL, format: AVAudioFormat) throws {
        let journal = OpenChunk(filename: file.lastPathComponent,
                                sampleRate: format.sampleRate, channels: format.channelCount)
        try JSONEncoder().encode(journal).write(to: journalURL(for: file),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func complete(file: URL) throws { try FileManager.default.removeItem(at: journalURL(for: file)) }

    static func recover(directory: URL) -> Report {
        var report = Report()
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
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
                if !FileManager.default.fileExists(atPath: recovered.path) {
                    try repair(original: original, recovered: recovered, journal: journal)
                }
                guard try AVAudioFile(forReading: recovered).length > 0 else { throw Failure.empty }
                report.recovered += 1
            } catch { report.unreadable.append(journalURL.lastPathComponent) }
        }
        return report
    }

    private static func repair(original: URL, recovered: URL, journal: OpenChunk) throws {
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
