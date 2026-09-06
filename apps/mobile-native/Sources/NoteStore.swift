import Foundation
import Observation

struct NoteDiskStore {
    let root: URL

    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }

    func directory(for id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }

    func audioDirectory(for id: UUID) throws -> URL {
        let url = directory(for: id).appendingPathComponent("audio", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return url
    }

    func save(_ note: NoteRecord) throws {
        let dir = directory(for: note.id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(note)
        try data.write(to: dir.appendingPathComponent("note.json"),
                       options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func load() throws -> (notes: [NoteRecord], unreadable: [String]) {
        let dirs = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var notes: [NoteRecord] = []
        var unreadable: [String] = []
        for dir in dirs where UUID(uuidString: dir.lastPathComponent) != nil {
            do {
                var note = try JSONDecoder().decode(NoteRecord.self,
                    from: Data(contentsOf: dir.appendingPathComponent("note.json")))
                guard note.schemaVersion == 1, note.id.uuidString == dir.lastPathComponent else {
                    unreadable.append(dir.lastPathComponent)
                    continue
                }
                if note.captureState == .recording {
                    note.captureState = .interrupted
                    try save(note)
                }
                notes.append(note)
            } catch { unreadable.append(dir.lastPathComponent) }
        }
        return (notes.sorted { $0.updatedAt > $1.updatedAt }, unreadable)
    }

    func audioFiles(for id: UUID) -> [URL] {
        let dir = directory(for: id).appendingPathComponent("audio", isDirectory: true)
        return ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "caf" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

@MainActor @Observable
final class NoteLibrary {
    private(set) var notes: [NoteRecord] = []
    var problem: String?
    private(set) var disk: NoteDiskStore?

    init(root: URL) {
        do {
            let disk = try NoteDiskStore(root: root)
            self.disk = disk
            let result = try disk.load()
            notes = result.notes
            if !result.unreadable.isEmpty {
                problem = "Some saved notes could not be opened. Their files have been preserved."
            }
        } catch { problem = "Local storage could not be opened. \(error.localizedDescription)" }
    }

    @discardableResult func create() -> UUID? {
        let note = NoteRecord()
        guard persist(note) else { return nil }
        notes.insert(note, at: 0)
        return note.id
    }

    func note(_ id: UUID) -> NoteRecord? { notes.first { $0.id == id } }

    @discardableResult func update(_ id: UUID, _ change: (inout NoteRecord) -> Void) -> Bool {
        guard let i = notes.firstIndex(where: { $0.id == id }) else { return false }
        var note = notes[i]
        change(&note)
        note.updatedAt = Date()
        // Keep unsaved edits visible if storage fails. Never display a false saved status.
        notes[i] = note
        return persist(note)
    }

    private func persist(_ note: NoteRecord) -> Bool {
        do {
            guard let disk else { return false }
            try disk.save(note)
            return true
        } catch {
            problem = "Changes could not be saved. Keep the app open and free device storage. \(error.localizedDescription)"
            return false
        }
    }
}
