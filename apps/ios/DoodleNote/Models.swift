import Foundation
import SwiftData

/// A meeting: recording metadata, the user's rough notes, and AI-generated
/// notes. IDs are device-minted UUIDs — the same id follows the meeting to
/// the cloud and every synced device (see apps/web/app/api/sync/push).
@Model
final class Meeting {
    @Attribute(.unique) var id: UUID
    var title: String
    var createdAt: Date
    var startedAt: Date?
    var endedAt: Date?
    /// The user's rough notes, markdown.
    var roughNotes: String
    /// AI-generated notes, markdown. Nil until "Generate notes" runs.
    var generatedNotes: String?
    var templateId: String
    /// "phone" for meetings recorded here, "cloud" for meetings pulled via sync.
    var origin: String
    /// Content hash last accepted by the sync server; nil = never pushed.
    var lastPushedHash: String?
    @Relationship(deleteRule: .cascade, inverse: \Segment.meeting)
    var segments: [Segment]

    init(
        id: UUID = UUID(),
        title: String = "",
        createdAt: Date = .now,
        templateId: String = "general",
        origin: String = "phone"
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.roughNotes = ""
        self.generatedNotes = nil
        self.templateId = templateId
        self.origin = origin
        self.lastPushedHash = nil
        self.segments = []
    }

    var sortedSegments: [Segment] {
        segments.sorted { $0.startMs < $1.startMs }
    }

    var displayTitle: String {
        title.trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled meeting" : title
    }

    var durationMs: Int? {
        guard let startedAt, let endedAt else { return nil }
        return Int(endedAt.timeIntervalSince(startedAt) * 1000)
    }
}

/// One finalized transcript utterance. On the phone everything comes from the
/// mic (in-person meetings), so channel is "mic" and the speaker label is
/// "Speaker" — no You/Them separation without system audio.
@Model
final class Segment {
    var id: UUID
    var channel: String
    var speaker: String
    var text: String
    var startMs: Int
    var endMs: Int
    var confidence: Double?
    var meeting: Meeting?

    init(
        id: UUID = UUID(),
        channel: String = "mic",
        speaker: String = "Speaker",
        text: String,
        startMs: Int,
        endMs: Int,
        confidence: Double? = nil
    ) {
        self.id = id
        self.channel = channel
        self.speaker = speaker
        self.text = text
        self.startMs = startMs
        self.endMs = endMs
        self.confidence = confidence
    }
}
