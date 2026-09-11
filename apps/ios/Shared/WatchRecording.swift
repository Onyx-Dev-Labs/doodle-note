import Foundation

struct WatchRecording: Codable, Identifiable, Equatable, Sendable {
    static let protocolVersion = 1
    let id: UUID
    let startedAt: Date
    var duration: TimeInterval
    var status: Status
    enum Status: String, Codable, Sendable {
        case recording, ready, received, transcribed, interrupted
    }

    init(id: UUID = UUID(), startedAt: Date = .now, duration: TimeInterval = 0, status: Status = .recording) {
        self.id = id
        self.startedAt = startedAt
        self.duration = duration
        self.status = status
    }

    var metadata: [String: Any] {
        ["version": Self.protocolVersion, "id": id.uuidString,
         "startedAt": startedAt.timeIntervalSince1970, "duration": duration]
    }

    init(metadata: [String: Any]) throws {
        guard metadata["version"] as? Int == Self.protocolVersion,
              let rawID = metadata["id"] as? String, let id = UUID(uuidString: rawID),
              let start = metadata["startedAt"] as? Double, start.isFinite,
              let duration = metadata["duration"] as? Double,
              duration.isFinite, duration > 0, duration <= 86_400 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.init(id: id, startedAt: Date(timeIntervalSince1970: start), duration: duration, status: .ready)
    }
}

/// All files stay in Application Support, including after acknowledgement. No
/// transport callback is allowed to delete the user's only recording.
final class WatchRecordingStore: @unchecked Sendable {
    let directory: URL
    private let lock = NSRecursiveLock()

    init(directory: URL = URL.applicationSupportDirectory.appendingPathComponent("WatchRecordings", isDirectory: true)) {
        self.directory = directory
    }

    func audioURL(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString + ".caf") }
    private func manifestURL(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString + ".json") }

    func save(_ recording: WatchRecording) throws {
        try lock.withLock {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try JSONEncoder().encode(recording).write(to: manifestURL(recording.id), options: .atomic)
        }
    }

    func recordings() throws -> [WatchRecording] {
        try lock.withLock {
            guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
            return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "json" }
                .map { try JSONDecoder().decode(WatchRecording.self, from: Data(contentsOf: $0)) }
                .sorted { $0.startedAt > $1.startedAt }
        }
    }

    /// Must complete synchronously in WCSession's receive delegate: its source
    /// URL is temporary and is removed when the delegate returns.
    func receive(_ recording: WatchRecording, from source: URL) throws {
        try lock.withLock {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = audioURL(recording.id)
            if !FileManager.default.fileExists(atPath: destination.path) {
                let staging = directory.appendingPathComponent(UUID().uuidString + ".partial")
                defer { try? FileManager.default.removeItem(at: staging) }
                try FileManager.default.copyItem(at: source, to: staging)
                try FileManager.default.moveItem(at: staging, to: destination)
            }
            // Preserve progress when the watch retries the same UUID.
            if try recordings().contains(where: { $0.id == recording.id }) { return }
            var received = recording
            received.status = .received
            try save(received)
        }
    }
}
