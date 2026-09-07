import Foundation

/// Identity is explicit. Transport state and credentials never determine ownership.
struct LibraryIdentity: Codable, Equatable, Hashable, Sendable {
    let accountID: String
    let workspaceID: String
}

struct LibraryRecord: Codable, Identifiable, Equatable, Sendable {
    static let localID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    let id: UUID
    var name: String
    let identity: LibraryIdentity?
    static let local = LibraryRecord(id: localID, name: "Only on this device", identity: nil)
}

struct NoteFolder: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let libraryID: UUID
    var name: String
}

/// occurrenceID is the provider's stable original occurrence identity, never the displayed start date.
struct EventOccurrenceKey: Codable, Equatable, Hashable, Sendable {
    let provider: String
    let accountID: String
    let calendarID: String
    let eventID: String
    let occurrenceID: String
}

struct SourceAnchor: Codable, Equatable, Sendable {
    enum Content: Codable, Equatable, Sendable {
        case title
        case personalParagraph(Int)
        case transcript(UUID)
        case summary(UUID)
    }
    let libraryID: UUID
    let noteID: UUID
    /// NoteRevision.id for title/typed/transcript, SummaryVersion.id for summary sources.
    let revisionID: UUID
    let content: Content
}

struct NoteRevision: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let noteID: UUID
    let libraryID: UUID
    let savedAt: Date
    let title: String
    let text: String
    let passages: [TranscriptPassage]
    let speakerAnnotations: SpeakerAnnotations?

    init(_ note: NoteRecord) {
        id = note.metadata!.revisionID
        noteID = note.id
        libraryID = note.metadata!.libraryID
        savedAt = note.updatedAt
        title = note.title
        text = note.text
        passages = note.passages
        speakerAnnotations = note.speakerAnnotations
    }

    func resolve(_ anchor: SourceAnchor) -> String? {
        guard anchor.noteID == noteID, anchor.revisionID == id, anchor.libraryID == libraryID else { return nil }
        switch anchor.content {
        case .title: return title
        case .personalParagraph(let index):
            let paragraphs = text.components(separatedBy: "\n")
            return paragraphs.indices.contains(index) ? paragraphs[index] : nil
        case .transcript(let id): return passages.first { $0.id == id }?.text
        case .summary: return nil // Summary anchors resolve their own immutable version through the repository.
        }
    }
}

/// Appending a new edited version retains the generated original and its citations.
struct SummaryVersion: Codable, Identifiable, Equatable, Sendable {
    enum Origin: String, Codable, Sendable { case generated, edited }
    let id: UUID
    let parentID: UUID?
    let createdAt: Date
    let origin: Origin
    let format: String
    let language: SpokenLanguage
    let text: String
    let sources: [SourceAnchor]
}

enum TranscriptCompletion: String, Codable, Sendable {
    case none, partial, interrupted, complete
}

struct NoteMetadata: Codable, Equatable, Sendable {
    /// Imported transcript completeness, independent of device-local recording/audio state.
    var cloudTranscriptStatus: TranscriptCompletion? = nil
    var cloudReadOnly: Bool? = nil
    var libraryID = LibraryRecord.localID
    var folderID: UUID? = nil
    var lifecycleGeneration: UUID? = nil
    var revisionID = UUID()
    var event: EventOccurrenceKey? = nil
    var summaries: [SummaryVersion] = []
    var selectedSummaryID: UUID? = nil
}

struct ProcessingJob: Codable, Identifiable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case audioImport, summary, eventNote }
    enum State: String, Codable, Sendable { case pending, running, retryable, completed, cancelled }
    let id: UUID
    let libraryID: UUID
    let kind: Kind
    let idempotencyKey: String
    /// Reserved before work begins, reused after a crash between output and completion.
    let noteID: UUID
    let versionID: UUID
    var state: State = .pending
    var attempts = 0
    var lastError: String? = nil
}

struct LibraryCatalog: Codable, Equatable, Sendable {
    var schemaVersion = 1
    var libraries: [LibraryRecord] = [.local]
    var folders: [NoteFolder] = []
    var jobs: [ProcessingJob] = []
}

enum LibraryDataError: LocalizedError {
    case invalidOwnership, immutableHistory, invalidDocument, unsupportedVersion, invalidJob
    var errorDescription: String? {
        switch self {
        case .invalidOwnership: "The note or folder belongs to a different library."
        case .immutableHistory: "A retained version cannot be overwritten."
        case .invalidDocument: "The saved document is invalid; its original file is preserved."
        case .unsupportedVersion: "This library requires a newer version of DoodleNote."
        case .invalidJob: "The processing request does not match its saved identity."
        }
    }
}
