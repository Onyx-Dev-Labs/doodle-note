import Foundation

/// Selection identity travels with asynchronous preview reads and the eventual choose operation.
struct CloudConflictPreview {
    private(set) var noteID: UUID?
    private(set) var revisionID: UUID?
    private(set) var text: String?
    private var requestID = UUID()
    mutating func begin(noteID: UUID) -> UUID {
        invalidate()
        self.noteID = noteID
        return requestID
    }
    mutating func invalidate() {
        requestID = UUID()
        noteID = nil
        revisionID = nil
        text = nil
    }
    mutating func publish(requestID: UUID, noteID: UUID, revisionID: UUID, text: String) {
        guard self.requestID == requestID, self.noteID == noteID else { return }
        self.revisionID = revisionID
        self.text = text
    }
}
