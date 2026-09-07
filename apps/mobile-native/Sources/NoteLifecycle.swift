import Foundation
import AVFoundation

/// Durable event/receipt. Contains identities and state only, never note content or audio.
struct NoteLifecycle: Codable, Equatable, Sendable, Identifiable {
    enum State: String, Codable, Sendable { case active, trashed, purged }
    enum Clock: String, Codable, Sendable { case device, provisionalAccount, server }
    var schemaVersion = 1
    let noteID: UUID
    let libraryID: UUID
    var generation: UUID
    var operationID: UUID
    var state: State
    var deletionID: UUID?
    var deletedAt: Date?
    var expiresAt: Date?
    var clock: Clock
    var cleanupPending = false
    var restorePending = false
    var audioRemovalPending = false
    var audioRemovedAt: Date?
    var audioOperationID: UUID?
    var audioTimelineStart: TimeInterval?
    var id: UUID { noteID }

    static func initial(noteID: UUID, libraryID: UUID) -> Self {
        Self(noteID: noteID, libraryID: libraryID, generation: noteID, operationID: noteID,
             state: .active, clock: libraryID == LibraryRecord.localID ? .device : .provisionalAccount)
    }
}

enum LifecycleError: LocalizedError {
    case stale, unavailable, confirmationRequired, expired, recordingActive
    var errorDescription: String? {
        switch self {
        case .stale: "This note changed. Reopen it before trying again."
        case .unavailable: "This note is in Trash or was permanently deleted."
        case .confirmationRequired: "Confirm permanent deletion before continuing."
        case .expired: "The 30-day recovery period has ended."
        case .recordingActive: "Stop recording before changing storage for this note."
        }
    }
}

struct StorageUsage: Sendable, Equatable {
    let notesBytes: Int64
    let audioBytes: Int64
    let availableBytes: Int64?
    var totalBytes: Int64 { notesBytes + audioBytes }
    var lowSpace: Bool { availableBytes.map { $0 < 500 * 1024 * 1024 } ?? false }
}

extension NoteDiskStore {
    func lifecycleURL(_ id: UUID) -> URL {
        root.appendingPathComponent("lifecycle", isDirectory: true).appendingPathComponent(id.uuidString + ".json")
    }

    func lifecycle(noteID: UUID, libraryID: UUID) throws -> NoteLifecycle {
        let file = lifecycleURL(noteID)
        guard FileManager.default.fileExists(atPath: file.path) else {
            return .initial(noteID: noteID, libraryID: libraryID)
        }
        let record = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: file))
        guard record.schemaVersion == 1, record.noteID == noteID, record.libraryID == libraryID else {
            throw LibraryDataError.invalidOwnership
        }
        return record
    }

    func saveLifecycle(_ record: NoteLifecycle) throws {
        let directory = lifecycleURL(record.noteID).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try write(record, to: lifecycleURL(record.noteID))
    }

    func lifecycleRecords() throws -> [NoteLifecycle] {
        let directory = root.appendingPathComponent("lifecycle", isDirectory: true)
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map { file in
                let record = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: file))
                guard record.schemaVersion == 1, record.noteID.uuidString + ".json" == file.lastPathComponent else {
                    throw LibraryDataError.invalidDocument
                }
                return record
            }
    }

    func audioTimelineStart(for id: UUID) throws -> TimeInterval {
        guard FileManager.default.fileExists(atPath: lifecycleURL(id).path) else { return 0 }
        let record = try JSONDecoder().decode(NoteLifecycle.self, from: Data(contentsOf: lifecycleURL(id)))
        guard record.schemaVersion == 1, record.noteID == id else { throw LibraryDataError.invalidDocument }
        let start = record.audioTimelineStart ?? 0
        guard start.isFinite, start >= 0 else { throw LibraryDataError.invalidDocument }
        return start
    }

    func recordingOffset(for id: UUID) throws -> TimeInterval {
        try audioFiles(for: id).reduce(audioTimelineStart(for: id)) { total, url in
            let file = try AVAudioFile(forReading: url)
            return total + Double(file.length) / file.processingFormat.sampleRate
        }
    }

    func requireActive(_ note: NoteRecord) throws {
        guard let metadata = note.metadata else { throw LibraryDataError.invalidDocument }
        let record = try lifecycle(noteID: note.id, libraryID: metadata.libraryID)
        guard record.state == .active, !record.restorePending else { throw LifecycleError.unavailable }
        guard record.generation == (metadata.lifecycleGeneration ?? note.id) else { throw LifecycleError.stale }
    }
}
