import Foundation

struct SpeakerTurn: Codable, Equatable, Sendable {
    var sessionID: UUID
    var slot: Int
    var start: TimeInterval
    var end: TimeInterval
    var isFinal: Bool
    var key: String { "\(sessionID.uuidString):\(slot)" }
}

/// Shared attribution gate for transcript, summaries, Q&A and exports.
enum SpeakerAttribution {
    static let overlapFloor = 0.1
    static let assignFloor = 0.65

    enum Decision: Equatable, Sendable {
        case unassigned
        case multiple
        case speaker(key: String, provisional: Bool)
    }

    static func coverage(turns: [SpeakerTurn], start: TimeInterval, end: TimeInterval) -> [String: Double] {
        let duration = end - start
        guard duration > 0 else { return [:] }
        let relevant = turns.filter { min($0.end, end) > max($0.start, start) }
        let grouped = Dictionary(grouping: relevant, by: \.key)
        return grouped.mapValues { group -> Double in
            let intervals = group.map { (max($0.start, start), min($0.end, end)) }.sorted { $0.0 < $1.0 }
            var cursor = start
            return intervals.reduce(0) { total, item in
                let contribution = max(0, item.1 - max(cursor, item.0))
                cursor = max(cursor, item.1)
                return total + contribution
            }
        }
    }

    static func decide(turns: [SpeakerTurn], start: TimeInterval, end: TimeInterval) -> Decision {
        let duration = end - start
        guard duration > 0 else { return .unassigned }
        let coverage = coverage(turns: turns, start: start, end: end)
        let active = coverage.filter { $0.value / duration >= overlapFloor }
        if active.count > 1 { return .multiple }
        guard let (key, covered) = active.first, covered / duration >= assignFloor else { return .unassigned }
        let provisional = turns.contains { $0.key == key && min($0.end, end) > max($0.start, start) && !$0.isFinal }
        return .speaker(key: key, provisional: provisional)
    }
}

struct SpeakerAnnotations: Equatable, Sendable {
    var turns: [SpeakerTurn] = []
    var names: [String: String] = [:]
    var order: [String]? = nil
    /// Keys the matcher abstained on. Never treated as a confirmed name.
    var uncertain: [String] = []

    mutating func replace(sessionID: UUID, with incoming: [SpeakerTurn]) {
        turns.removeAll { $0.sessionID == sessionID }
        let valid = incoming.filter {
            $0.sessionID == sessionID && (0..<4).contains($0.slot)
                && $0.start.isFinite && $0.end.isFinite && $0.start >= 0 && $0.end > $0.start
        }
        let present = Set(valid.map(\.key))
        let prefix = sessionID.uuidString + ":"
        names = names.filter { present.contains($0.key) || !$0.key.hasPrefix(prefix) }
        uncertain = uncertain.filter { present.contains($0) || !$0.hasPrefix(prefix) }
        var known = order ?? speakerKeys
        known.removeAll { $0.hasPrefix(prefix) && !present.contains($0) }
        for turn in valid.sorted(by: { $0.slot < $1.slot }) where !known.contains(turn.key) { known.append(turn.key) }
        order = known
        turns += valid
        turns.sort { $0.start < $1.start }
    }

    var speakerKeys: [String] {
        if let order {
            let present = Set(turns.map(\.key))
            return order.filter { present.contains($0) }
        }
        var seen = Set<String>()
        return turns.compactMap { seen.insert($0.key).inserted ? $0.key : nil }
    }

    func confirmedName(for key: String) -> String? {
        names[key].flatMap { $0.isEmpty ? nil : $0 }
    }

    mutating func confirm(_ name: String, for key: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { names[key] = nil } else { names[key] = trimmed }
        uncertain.removeAll { $0 == key }
    }

    func name(for key: String, localized: Bool = false) -> String {
        if let name = confirmedName(for: key) { return name }
        if uncertain.contains(key) { return localized ? L10n.text("Uncertain speaker") : "Uncertain speaker" }
        let index = ((order ?? speakerKeys).firstIndex(of: key) ?? 0) + 1
        return localized ? L10n.format("Speaker %lld", index) : "Speaker \(index)"
    }

    func label(for passage: TranscriptPassage, localized: Bool = false) -> String {
        switch SpeakerAttribution.decide(turns: turns, start: passage.start, end: passage.end) {
        case .unassigned: return localized ? L10n.text("Unassigned speaker") : "Unassigned speaker"
        case .multiple: return localized ? L10n.text("Multiple speakers") : "Multiple speakers"
        case .speaker(let key, let provisional):
            let name = name(for: key, localized: localized)
            return provisional ? (localized ? L10n.format("%@ (provisional)", name) : name + " (provisional)") : name
        }
    }
}

extension SpeakerAnnotations: Codable {
    enum CodingKeys: String, CodingKey { case turns, names, order, uncertain }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        turns = try container.decodeIfPresent([SpeakerTurn].self, forKey: .turns) ?? []
        names = try container.decodeIfPresent([String: String].self, forKey: .names) ?? [:]
        order = try container.decodeIfPresent([String].self, forKey: .order)
        uncertain = try container.decodeIfPresent([String].self, forKey: .uncertain) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(turns, forKey: .turns)
        try container.encode(names, forKey: .names)
        try container.encodeIfPresent(order, forKey: .order)
        if !uncertain.isEmpty { try container.encode(uncertain, forKey: .uncertain) }
    }
}
