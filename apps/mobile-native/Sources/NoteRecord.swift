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
    var isUserEdited: Bool? = nil
}

struct RecordingSpeechSession: Codable, Equatable, Sendable, Identifiable {
    var id: UUID
    var start: TimeInterval
    var end: TimeInterval?
    var language: SpokenLanguage
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
    var speechSessions: [RecordingSpeechSession]? = nil
    var transcriptNeedsReview: Bool? = nil
    var transcriptCloudReviewRequired: Bool? = nil
    var transcriptCorrectionSources: [SourceAnchor]? = nil
    var captureState = CaptureState.idle
    var speakerAnnotations: SpeakerAnnotations? = nil

    /// IDs survive provisional/final updates. Human corrections take precedence over recognition.
    @discardableResult mutating func apply(_ passage: TranscriptPassage) -> Bool {
        guard passage.start.isFinite, passage.end.isFinite, passage.start >= 0,
              passage.end > passage.start, !passage.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let overlaps = passages.filter { $0.start < passage.end && $0.end > passage.start }
        if let corrected = overlaps.first(where: { $0.isUserEdited == true }) {
            let exact = abs(corrected.start - passage.start) < 0.001 && abs(corrected.end - passage.end) < 0.001
            if !exact { transcriptNeedsReview = true }
            if exact, passage.isFinal, let index = passages.firstIndex(where: { $0.id == corrected.id }) {
                passages[index].isFinal = true
            }
            return exact
        }
        if overlaps.contains(where: { $0.isFinal && (abs($0.start - passage.start) >= 0.001 || abs($0.end - passage.end) >= 0.001) }) {
            transcriptNeedsReview = true
            return false
        }
        // A late provisional result must not downgrade already finalized source text.
        if !passage.isFinal && overlaps.contains(where: \.isFinal) { return true }
        if let finalized = overlaps.first(where: \.isFinal) {
            if finalized.text != passage.text { transcriptNeedsReview = true; return false }
            return true
        }
        var replacement = passage
        if let previous = overlaps.max(by: {
            min($0.end, passage.end) - max($0.start, passage.start) < min($1.end, passage.end) - max($1.start, passage.start)
        }) {
            replacement.id = previous.id
            replacement.speakerName = previous.speakerName
        }
        passages.removeAll { $0.start < passage.end && $0.end > passage.start }
        passages.append(replacement)
        passages.sort { $0.start < $1.start }
        return true
    }

    @discardableResult mutating func replaceTranscript(start: TimeInterval, end: TimeInterval, with recognized: [TranscriptPassage]) -> Bool {
        let old = passages
        if old.contains(where: { prior in
            prior.isUserEdited == true && prior.start >= start && prior.end <= end &&
            !recognized.contains(where: { abs($0.start - prior.start) < 0.001 && abs($0.end - prior.end) < 0.001 })
        }) {
            transcriptNeedsReview = true
            return false
        }
        if recognized.contains(where: { incoming in old.contains(where: { prior in
            prior.isUserEdited == true && prior.start < incoming.end && prior.end > incoming.start &&
            (abs(prior.start - incoming.start) >= 0.001 || abs(prior.end - incoming.end) >= 0.001)
        }) }) {
            transcriptNeedsReview = true
            return false
        }
        var used: Set<UUID> = []
        var revised = recognized
        for index in revised.indices {
            if let prior = old.first(where: { !used.contains($0.id) && $0.start < revised[index].end && $0.end > revised[index].start }) {
                revised[index].id = prior.id
                revised[index].speakerName = prior.speakerName
                used.insert(prior.id)
            }
        }
        passages.removeAll { $0.isUserEdited != true && $0.start >= start && $0.end <= end }
        var complete = true
        for passage in revised { if !apply(passage) { complete = false } }
        return complete
    }

    @discardableResult mutating func correctPassage(id: UUID, text: String) -> Bool {
        guard let index = passages.firstIndex(where: { $0.id == id }) else { return false }
        passages[index].text = text
        passages[index].isUserEdited = true
        return true
    }
}
