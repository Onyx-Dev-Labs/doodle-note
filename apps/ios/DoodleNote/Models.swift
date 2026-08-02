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
    /// "meeting" (nil/default) or a standalone quick "note" — desktop's kind
    /// field; syncs on the wire so notes stay notes across devices.
    var kind: String?
    /// Calendar event this meeting was started from (EventKit identifier or
    /// the id synced from other devices).
    var calendarEventId: String?
    /// Folder assignment; folders sync across devices.
    var folderId: UUID?
    @Relationship(deleteRule: .cascade, inverse: \Segment.meeting)
    var segments: [Segment]

    var isNote: Bool { kind == "note" }

    init(
        id: UUID = UUID(),
        title: String = "",
        createdAt: Date = .now,
        templateId: String = "general",
        origin: String = "phone",
        kind: String? = nil
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.kind = kind
        self.roughNotes = ""
        self.generatedNotes = nil
        self.templateId = templateId
        self.origin = origin
        self.lastPushedHash = nil
        self.calendarEventId = nil
        self.folderId = nil
        self.segments = []
    }

    var sortedSegments: [Segment] {
        segments.sorted { $0.startMs < $1.startMs }
    }

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        return isNote ? "Untitled note" : "Untitled meeting"
    }

    var hasMeaningfulContent: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !roughNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !(generatedNotes?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            || !segments.isEmpty
            || startedAt != nil
    }

    /// Content that can actually be sent to the note generator. A title or a
    /// recording timestamp keeps a meeting from being discarded, but neither
    /// gives the generator useful source material.
    var hasNoteSourceContent: Bool {
        !roughNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !(generatedNotes?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            || !segments.isEmpty
    }

    var isEmptyDraft: Bool { !hasMeaningfulContent }

    var durationMs: Int? {
        guard let startedAt, let endedAt else { return nil }
        return Int(endedAt.timeIntervalSince(startedAt) * 1000)
    }

    /// Whole minutes, for lightweight list subtitles (dates only — never
    /// touches the segments relationship, so it's cheap during scroll).
    var durationMinutes: Int? {
        durationMs.map { max(1, $0 / 60_000) }
    }
}

/// A folder for organizing meetings. Synced (ids are shared with the cloud
/// and other devices).
@Model
final class Folder {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    /// True once this folder has been seen by the sync server (pushed or
    /// pulled) — drives remote-deletion reconciliation.
    var synced: Bool

    init(id: UUID = UUID(), name: String, createdAt: Date = .now, synced: Bool = false) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.synced = synced
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
