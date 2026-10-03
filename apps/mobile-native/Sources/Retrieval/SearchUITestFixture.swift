#if DEBUG
import Foundation

enum SearchUITestFixture {
    static func prepare(root: URL) throws {
        let disk = try NoteDiskStore(root: root)
        guard try disk.load().notes.isEmpty else { return }
        for number in 0..<500 {
            var note = NoteRecord()
            note.title = "Synthetic meeting \(number)"
            note.text = number == 0 ? "archive oldestneedle original decision" : "archive decision \(number)"
            note.createdAt = Date(timeIntervalSince1970: Double(number))
            try disk.save(note)
        }
    }
}
#endif
