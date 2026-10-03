import AVFoundation

/// Local-only metadata keeps missing audio from shifting later source timestamps.
enum AudioTimeline {
    struct Receipt: Codable, Equatable, Sendable {
        var schemaVersion = 1
        let filename: String
        let start: TimeInterval
        let frames: Int64
        let sampleRate: Double
        let channels: UInt32
        var duration: TimeInterval { Double(frames) / sampleRate }
    }
    struct Segment: Sendable {
        let url: URL
        let start: TimeInterval
        let duration: TimeInterval
        let available: Bool
        var end: TimeInterval { start + duration }
    }
    struct Plan: Sendable {
        var segments: [Segment]
        let origin: TimeInterval
        var end: TimeInterval { segments.last?.end ?? origin }
        func resolve(_ seconds: TimeInterval) throws -> (index: Int, offset: TimeInterval) {
            guard seconds.isFinite, seconds >= origin else { throw Failure.unavailable }
            guard let index = segments.firstIndex(where: { seconds >= $0.start && seconds < $0.end }),
                  segments[index].available else { throw Failure.unavailable }
            return (index, seconds - segments[index].start)
        }
    }
    enum Failure: LocalizedError {
        case invalid, unavailable, uncertainEndpoint
        var errorDescription: String? {
            switch self {
            case .uncertainEndpoint: "The earlier audio timeline could not be established. Start a new note to record; your existing notes are preserved."
            case .invalid: "The local audio timeline is invalid. Original files are preserved."
            case .unavailable: "Audio for this part of the recording is unavailable on this device."
            }
        }
    }
    static func receiptURL(_ file: URL) -> URL { file.appendingPathExtension("timeline.json") }
    static func save(_ receipt: Receipt, for file: URL) throws {
        try validate(receipt, name: file.lastPathComponent)
        let target = receiptURL(file)
        if FileManager.default.fileExists(atPath: target.path) {
            guard try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: target)) == receipt else { throw Failure.invalid }
            return
        }
        try JSONEncoder().encode(receipt).write(to: target,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private static func validate(_ value: Receipt, name: String) throws {
        guard value.schemaVersion == 1, value.filename == name,
              URL(fileURLWithPath: name).lastPathComponent == name, !name.hasPrefix("."),
              name.hasSuffix(".caf"), !name.hasSuffix(".recovered.caf"),
              value.start.isFinite, value.start >= 0, value.frames > 0,
              value.sampleRate.isFinite, value.sampleRate > 0,
              value.channels > 0, value.channels <= 32,
              value.duration.isFinite, (value.start + value.duration).isFinite else { throw Failure.invalid }
    }
    static func read(directory: URL, origin: TimeInterval) throws -> Plan {
        guard origin.isFinite, origin >= 0 else { throw Failure.invalid }
        guard FileManager.default.fileExists(atPath: directory.path) else { return Plan(segments: [], origin: origin) }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        var receipts: [String: Receipt] = [:]
        for file in files where file.lastPathComponent.hasSuffix(".caf.timeline.json") {
            let value = try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: file))
            try validate(value, name: String(file.lastPathComponent.dropLast(".timeline.json".count)))
            guard receipts.updateValue(value, forKey: value.filename) == nil else { throw Failure.invalid }
        }
        let originals = files.filter { $0.pathExtension == "caf" && !$0.lastPathComponent.hasSuffix(".recovered.caf") }
        let names = Set(originals.map(\.lastPathComponent)).union(receipts.keys).sorted()
        var segments: [Segment] = []
        var cursor = origin
        for name in names {
            let original = directory.appendingPathComponent(name)
            let recovered = AudioRecovery.recoveredURL(for: original)
            let selected = FileManager.default.fileExists(atPath: recovered.path) ? recovered : original
            let available = FileManager.default.fileExists(atPath: selected.path)
            let receipt = receipts[name]
            let start: TimeInterval, duration: TimeInterval
            if let receipt {
                start = receipt.start; duration = receipt.duration
                if available {
                    let file = try AVAudioFile(forReading: selected)
                    guard file.length == receipt.frames, file.processingFormat.sampleRate == receipt.sampleRate,
                          file.processingFormat.channelCount == receipt.channels else { throw Failure.invalid }
                }
            } else {
                let file = try AVAudioFile(forReading: selected)
                start = cursor; duration = Double(file.length) / file.processingFormat.sampleRate
            }
            guard start + 0.000_001 >= cursor, duration.isFinite, duration > 0 else { throw Failure.invalid }
            segments.append(Segment(url: selected, start: start, duration: duration, available: available))
            cursor = start + duration
        }
        return Plan(segments: segments, origin: origin)
    }
}
