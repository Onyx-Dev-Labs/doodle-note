import Foundation

struct SpeakerTurn: Codable, Equatable, Sendable {
    var sessionID: UUID
    var slot: Int
    var start: TimeInterval
    var end: TimeInterval
    var isFinal: Bool
    var key: String { "\(sessionID.uuidString):\(slot)" }
}

struct SpeakerAnnotations: Codable, Equatable, Sendable {
    var turns: [SpeakerTurn] = []
    var names: [String: String] = [:]
    var order: [String]? = nil

    mutating func replace(sessionID: UUID, with incoming: [SpeakerTurn]) {
        turns.removeAll { $0.sessionID == sessionID }
        let valid = incoming.filter {
            $0.sessionID == sessionID && (0..<4).contains($0.slot)
                && $0.start.isFinite && $0.end.isFinite && $0.start >= 0 && $0.end > $0.start
        }
        var known = order ?? speakerKeys
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

    func name(for key: String) -> String {
        if let name = names[key], !name.isEmpty { return name }
        let index = ((order ?? speakerKeys).firstIndex(of: key) ?? 0) + 1
        return "Speaker \(index)"
    }

    func label(for passage: TranscriptPassage) -> String {
        let duration = passage.end - passage.start
        guard duration > 0 else { return "Unassigned speaker" }
        let relevant = turns.filter { min($0.end, passage.end) > max($0.start, passage.start) }
        let grouped = Dictionary(grouping: relevant, by: \.key)
        // Union each speaker's intervals so a finalized/draft overlap cannot inflate coverage.
        let coverage = grouped.mapValues { turns -> Double in
            let intervals = turns.map { (max($0.start, passage.start), min($0.end, passage.end)) }.sorted { $0.0 < $1.0 }
            var end = passage.start
            return intervals.reduce(0) { total, item in
                let contribution = max(0, item.1 - max(end, item.0))
                end = max(end, item.1)
                return total + contribution
            }
        }
        let active = coverage.filter { $0.value / duration >= 0.1 }
        if active.count > 1 { return "Multiple speakers" }
        guard let (key, covered) = active.first, covered / duration >= 0.65 else { return "Unassigned speaker" }
        let tentative = relevant.contains { $0.key == key && !$0.isFinal }
        return name(for: key) + (tentative ? " (provisional)" : "")
    }
}
