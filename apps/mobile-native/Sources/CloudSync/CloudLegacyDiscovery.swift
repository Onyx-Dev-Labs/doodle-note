import Foundation

struct CloudLegacyNote: Identifiable, Sendable {
    let id: UUID
    let title: String
    let transcriptCount: Int
}
struct CloudLegacyPage: Sendable {
    let notes: [CloudLegacyNote]
    let total: Int
    let next: String?
    init(_ value: CloudJSON) throws {
        guard let rows = value["notes"]?.list, rows.count <= 50,
              let totalValue = value["total"]?.number, let total = Int(exactly: totalValue), total >= 0 else { throw CloudSyncFailure.invalidResponse }
        self.total = total
        next = value["next"]?.string
        notes = try rows.map { row in
            guard let countValue = row["transcript_count"]?.number, let count = Int(exactly: countValue), count >= 0 else { throw CloudSyncFailure.invalidResponse }
            return CloudLegacyNote(id: try row.requiredUUID("id"), title: try row.requiredString("title"), transcriptCount: count)
        }
        guard Set(notes.map(\.id)).count == notes.count else { throw CloudSyncFailure.invalidResponse }
    }
}
