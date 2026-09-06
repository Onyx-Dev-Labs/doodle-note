import Foundation

enum SpokenLanguage: String, Codable, CaseIterable, Identifiable, Sendable {
    case english = "en-US", danish = "da-DK", spanish = "es-ES"
    case french = "fr-FR", german = "de-DE"

    var id: String { rawValue }
    var name: String {
        switch self {
        case .english: "English"
        case .danish: "Dansk"
        case .spanish: "Español"
        case .french: "Français"
        case .german: "Deutsch"
        }
    }
}

struct TranscriptPassage: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var start: TimeInterval
    var end: TimeInterval
    var text: String
    var isFinal: Bool
    // A missing identity is deliberate. Transcription alone does not identify a speaker.
    var speakerName: String? = nil
}

struct NoteRecord: Codable, Identifiable, Equatable, Sendable {
    enum CaptureState: String, Codable, Sendable { case idle, recording, finished, interrupted }
    var schemaVersion = 2
    var metadata: NoteMetadata? = NoteMetadata()
    var id = UUID()
    var createdAt = Date()
    var updatedAt = Date()
    var title = ""
    var text = ""
    var ink = Data()
    var language = SpokenLanguage.english
    var passages: [TranscriptPassage] = []
    var captureState = CaptureState.idle
    var speakerAnnotations: SpeakerAnnotations? = nil

    mutating func apply(_ passage: TranscriptPassage) {
        // Volatile hypotheses replace only their overlapping interval. Finalized text is immutable here.
        passages.removeAll { !$0.isFinal && $0.start < passage.end && $0.end > passage.start }
        if let index = passages.firstIndex(where: {
            abs($0.start - passage.start) < 0.001 && abs($0.end - passage.end) < 0.001
        }) {
            if !passages[index].isFinal { passages[index] = passage }
        } else {
            passages.append(passage)
        }
        passages.sort { $0.start < $1.start }
    }
}
