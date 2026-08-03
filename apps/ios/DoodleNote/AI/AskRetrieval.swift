import Foundation
import NaturalLanguage

/// Sendable copies of SwiftData meeting records. SwiftData relationships stay
/// on the main actor; retrieval and semantic ranking run on a background task.
struct AskMeetingSnapshot: Sendable {
    struct TranscriptSegment: Sendable {
        let speaker: String
        let text: String
        let startMs: Int
        let endMs: Int
    }

    let id: UUID
    let title: String
    let createdAt: Date
    let generatedNotes: String
    let roughNotes: String
    let segments: [TranscriptSegment]

    var hasSourceContent: Bool {
        !generatedNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !roughNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !segments.isEmpty
    }
}

enum AskEvidenceSource: String, Sendable {
    case generatedNotes = "Generated notes"
    case roughNotes = "Rough notes"
    case transcript = "Transcript"
}

struct AskEvidenceChunk: Sendable, Equatable {
    let meetingID: UUID
    let meetingTitle: String
    let meetingDate: Date
    let source: AskEvidenceSource
    let text: String
    let startMs: Int?
    let endMs: Int?
}

struct AskRetrievalResult: Sendable {
    let batches: [[AskEvidenceChunk]]
    let meetingLabels: [UUID: String]
    let selectedMeetingIDs: [UUID]
    let isExhaustive: Bool
    let dateScopeDescription: String?

    var allChunks: [AskEvidenceChunk] { batches.flatMap { $0 } }

    func attributed(_ answer: String) -> String {
        let sources = selectedMeetingIDs.compactMap { id -> String? in
            guard let chunk = allChunks.first(where: { $0.meetingID == id }) else { return nil }
            let label = meetingLabels[id] ?? "M?"
            return "- [\(label)] \(chunk.meetingTitle) — \(Self.isoDate(chunk.meetingDate))"
        }
        guard !sources.isEmpty else { return answer }
        return answer + "\n\n**Sources**\n" + sources.joined(separator: "\n")
    }

    func render(_ batch: [AskEvidenceChunk]) -> String {
        batch.map { chunk in
            let label = meetingLabels[chunk.meetingID] ?? "M?"
            var source = chunk.source.rawValue
            if let startMs = chunk.startMs {
                let start = NotePrompt.formatTimestamp(ms: startMs)
                if let endMs = chunk.endMs, endMs > startMs {
                    source += " \(start)-\(NotePrompt.formatTimestamp(ms: endMs))"
                } else {
                    source += " \(start)"
                }
            }
            return """
            === SOURCE [\(label)] ===
            Meeting: \(chunk.meetingTitle)
            Date: \(Self.isoDate(chunk.meetingDate))
            Source: \(source)
            \(chunk.text)
            """
        }.joined(separator: "\n\n")
    }

    private static func isoDate(_ date: Date) -> String {
        let components = Calendar(identifier: .gregorian)
            .dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }
}

/// Query-time, local-only retrieval over titles, generated notes, rough notes,
/// and the complete transcript. No meeting content leaves the device unless
/// the user has explicitly selected the BYOK cloud engine.
enum AskRetrieval {
    private static let maxChunkChars = 900
    private static let maxTargetedChunks = 14
    private static let maxTargetedChunksPerMeeting = 5
    private static let maxExhaustiveChunksPerMeeting = 2
    private static let maxSemanticMeetings = 3

    private static let stopWords: Set<String> = [
        "a", "about", "all", "am", "an", "and", "any", "are", "as", "at",
        "be", "been", "being", "but", "by", "can", "did", "discuss", "discussed",
        "do", "does", "doing", "for", "from", "get", "got", "had", "has", "have",
        "how", "i", "in", "into", "is", "it", "just", "list", "me", "meeting",
        "meetings", "mine", "my", "of", "on", "or", "our", "recent", "said", "say",
        "some", "tell", "than", "that", "the", "their", "them", "there", "these",
        "they", "this", "those", "to", "us", "was", "we", "were", "what", "when",
        "where", "which", "who", "why", "will", "with", "would", "you", "your",
    ]

    private static let actionWords: Set<String> = [
        "action", "actions", "assign", "assigned", "commit", "committed", "commitment",
        "due", "follow", "followup", "item", "items", "next", "open", "owe", "owner",
        "promise", "promised", "responsible", "step", "steps", "task", "tasks", "todo",
        "todos",
    ]

    private static let actionExpansion: Set<String> = actionWords.union([
        "deliver", "deadline", "email", "need", "needs", "prepare", "proposal", "send",
        "schedule", "will",
    ])

    private static let decisionWords: Set<String> = [
        "agree", "agreed", "decision", "decisions", "decide", "decided", "conclusion",
    ]

    private struct QueryIntent {
        let normalizedQuestion: String
        let queryTerms: Set<String>
        let identityTerms: Set<String>
        let isActionQuestion: Bool
        let isDecisionQuestion: Bool
        let requestsAll: Bool
        let latestMeetingOnly: Bool
    }

    private struct DateScope {
        let range: Range<Date>
        let description: String
    }

    private struct ScoredChunk {
        let chunk: AskEvidenceChunk
        let score: Double
        let hasIntentEvidence: Bool
    }

    static func retrieve(
        meetings: [AskMeetingSnapshot],
        question: String,
        history: [String] = [],
        maxBatchChars: Int,
        now: Date = .now,
        calendar: Calendar = .current,
        useSemanticSearch: Bool = true
    ) -> AskRetrievalResult {
        let intent = queryIntent(question)
        let dateScope = dateScope(for: question, now: now, calendar: calendar)
        let datedMeetings = meetings
            .filter(\.hasSourceContent)
            .filter { meeting in
                guard let dateScope else { return true }
                return dateScope.range.contains(meeting.createdAt)
            }
            .sorted { $0.createdAt > $1.createdAt }

        guard !datedMeetings.isEmpty else {
            return AskRetrievalResult(
                batches: [],
                meetingLabels: [:],
                selectedMeetingIDs: [],
                isExhaustive: intent.requestsAll,
                dateScopeDescription: dateScope?.description
            )
        }

        let retrievalText = (history.suffix(2) + [question]).joined(separator: " ")
        let retrievalTerms = meaningfulTerms(in: retrievalText)
        let namedMeetings = namedMeetingIDs(in: datedMeetings, identityTerms: retrievalTerms
            .subtracting(stopWords)
            .subtracting(actionWords)
            .subtracting(decisionWords))
        let matchingMeetings = namedMeetings.isEmpty
            ? datedMeetings
            : datedMeetings.filter { namedMeetings.contains($0.id) }
        let initialScopedMeetings = intent.latestMeetingOnly
            ? Array(matchingMeetings.prefix(1))
            : matchingMeetings
        let exhaustive = intent.requestsAll || ((intent.isActionQuestion || intent.isDecisionQuestion)
            && namedMeetings.isEmpty && !intent.latestMeetingOnly)

        // Exhaustive action/decision searches already have strong structural
        // and lexical signals. Embedding every transcript chunk there adds
        // tens of seconds without improving coverage.
        let embedding = useSemanticSearch && !exhaustive
            ? NLEmbedding.sentenceEmbedding(for: .english)
            : nil
        // For an unscoped corpus, cheaply rank one compact summary per meeting
        // before embedding individual chunks. This preserves semantic search
        // without making a broad paraphrased question embed every transcript.
        let scopedMeetings = if let embedding,
                                initialScopedMeetings.count > maxSemanticMeetings
        {
            semanticMeetingCandidates(
                initialScopedMeetings,
                question: intent.normalizedQuestion,
                queryTerms: retrievalTerms,
                embedding: embedding
            )
        } else {
            initialScopedMeetings
        }

        let chunks = scopedMeetings.flatMap(makeChunks)
        // Across several meetings, exact terms and section headings rank the
        // finalist chunks without an expensive second pass over transcripts.
        // Chunk-level semantics remain useful inside one clearly scoped call.
        let chunkEmbedding = scopedMeetings.count == 1 ? embedding : nil
        let scored = chunks.map { chunk in
            score(
                chunk,
                intent: intent,
                retrievalTerms: retrievalTerms,
                namedMeetingIDs: namedMeetings,
                embedding: chunkEmbedding,
                now: now
            )
        }

        let selected: [AskEvidenceChunk]
        if exhaustive {
            selected = selectExhaustive(
                scored,
                meetings: scopedMeetings,
                intent: intent
            )
        } else {
            selected = selectTargeted(
                scored,
                meetings: scopedMeetings,
                seedEveryMeeting: !namedMeetings.isEmpty
            )
        }

        let selectedMeetingIDs = selected.reduce(into: [UUID]()) { ids, chunk in
            if !ids.contains(chunk.meetingID) { ids.append(chunk.meetingID) }
        }
        let labels = Dictionary(uniqueKeysWithValues: selectedMeetingIDs.enumerated().map {
            ($0.element, "M\($0.offset + 1)")
        })
        var batches = pack(selected, labels: labels, maxBatchChars: max(1_000, maxBatchChars))
        if !exhaustive, batches.count > 1 {
            batches = Array(batches.prefix(1))
        }

        return AskRetrievalResult(
            batches: batches,
            meetingLabels: labels,
            selectedMeetingIDs: selectedMeetingIDs,
            isExhaustive: exhaustive,
            dateScopeDescription: dateScope?.description
        )
    }

    // MARK: Chunking

    private static func makeChunks(_ meeting: AskMeetingSnapshot) -> [AskEvidenceChunk] {
        var chunks: [AskEvidenceChunk] = []

        if !meeting.generatedNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            chunks += splitMarkdown(meeting.generatedNotes).map {
                AskEvidenceChunk(
                    meetingID: meeting.id,
                    meetingTitle: meeting.title,
                    meetingDate: meeting.createdAt,
                    source: .generatedNotes,
                    text: $0,
                    startMs: nil,
                    endMs: nil
                )
            }
        }

        if !meeting.roughNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            chunks += splitMarkdown(meeting.roughNotes).map {
                AskEvidenceChunk(
                    meetingID: meeting.id,
                    meetingTitle: meeting.title,
                    meetingDate: meeting.createdAt,
                    source: .roughNotes,
                    text: $0,
                    startMs: nil,
                    endMs: nil
                )
            }
        }

        var transcriptLines: [(text: String, startMs: Int, endMs: Int)] = []
        for segment in meeting.segments.sorted(by: { $0.startMs < $1.startMs }) {
            let line = "[\(NotePrompt.formatTimestamp(ms: segment.startMs))] \(segment.speaker): \(segment.text)"
            transcriptLines.append((line, segment.startMs, segment.endMs))
        }
        chunks += splitTranscript(transcriptLines).map {
            AskEvidenceChunk(
                meetingID: meeting.id,
                meetingTitle: meeting.title,
                meetingDate: meeting.createdAt,
                source: .transcript,
                text: $0.text,
                startMs: $0.startMs,
                endMs: $0.endMs
            )
        }

        return chunks
    }

    /// Carries a Markdown heading into every split chunk so an "Action Items"
    /// section remains discoverable even when the list is longer than one chunk.
    private static func splitMarkdown(_ text: String) -> [String] {
        var result: [String] = []
        var heading: String?
        var body: [String] = []

        func rendered(_ lines: [String]) -> String {
            ([heading].compactMap { $0 } + lines)
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        func flush() {
            let value = rendered(body)
            if !value.isEmpty { result.append(value) }
            body.removeAll(keepingCapacity: true)
        }

        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#") {
                flush()
                heading = line
                continue
            }

            let candidate = rendered(body + [line])
            if candidate.count <= maxChunkChars {
                body.append(line)
                continue
            }

            flush()
            var remainder = line
            while rendered([remainder]).count > maxChunkChars {
                let headingCount = heading?.count ?? 0
                let available = max(100, maxChunkChars - headingCount - 1)
                let prefix = String(remainder.prefix(available))
                body = [prefix]
                flush()
                remainder = String(remainder.dropFirst(prefix.count))
            }
            if !remainder.isEmpty { body.append(remainder) }
        }
        flush()
        return result
    }

    private static func splitTranscript(
        _ lines: [(text: String, startMs: Int, endMs: Int)]
    ) -> [(text: String, startMs: Int, endMs: Int)] {
        var result: [(String, Int, Int)] = []
        var current: [String] = []
        var startMs: Int?
        var endMs: Int?

        func flush() {
            guard let start = startMs, let end = endMs, !current.isEmpty else { return }
            result.append((current.joined(separator: "\n"), start, end))
            current.removeAll(keepingCapacity: true)
            startMs = nil
            endMs = nil
        }

        for line in lines {
            let candidate = (current + [line.text]).joined(separator: "\n")
            if candidate.count > maxChunkChars, !current.isEmpty { flush() }

            if line.text.count <= maxChunkChars {
                if startMs == nil { startMs = line.startMs }
                endMs = line.endMs
                current.append(line.text)
            } else {
                var remainder = line.text
                while !remainder.isEmpty {
                    let prefix = String(remainder.prefix(maxChunkChars))
                    result.append((prefix, line.startMs, line.endMs))
                    remainder = String(remainder.dropFirst(prefix.count))
                }
            }
        }
        flush()
        return result
    }

    // MARK: Ranking

    private static func semanticMeetingCandidates(
        _ meetings: [AskMeetingSnapshot],
        question: String,
        queryTerms: Set<String>,
        embedding: NLEmbedding
    ) -> [AskMeetingSnapshot] {
        meetings.map { meeting in
            let summary = semanticSummary(for: meeting)
            let exactHits = queryTerms.intersection(words(in: summary)).count
            let distance = embedding.distance(between: question, and: summary)
            return (meeting: meeting, score: distance - Double(exactHits) * 0.08)
        }
        .sorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score < rhs.score }
            return lhs.meeting.createdAt > rhs.meeting.createdAt
        }
        .prefix(maxSemanticMeetings)
        .map(\.meeting)
    }

    private static func semanticSummary(for meeting: AskMeetingSnapshot) -> String {
        var parts = [meeting.title]
        if !meeting.generatedNotes.isEmpty {
            parts.append(String(meeting.generatedNotes.prefix(550)))
        }
        if !meeting.roughNotes.isEmpty {
            parts.append(String(meeting.roughNotes.prefix(200)))
        }
        if parts.joined(separator: "\n").count < maxChunkChars {
            parts.append(meeting.segments.prefix(4).map(\.text).joined(separator: " "))
        }
        return String(parts.joined(separator: "\n").prefix(maxChunkChars))
    }

    private static func score(
        _ chunk: AskEvidenceChunk,
        intent: QueryIntent,
        retrievalTerms: Set<String>,
        namedMeetingIDs: Set<UUID>,
        embedding: NLEmbedding?,
        now: Date
    ) -> ScoredChunk {
        let titleTerms = words(in: chunk.meetingTitle)
        let chunkTerms = words(in: chunk.text)
        let contentHits = retrievalTerms.intersection(chunkTerms).count
        let focusHits = retrievalTerms
            .subtracting(titleTerms)
            .intersection(chunkTerms)
            .count
        let identityContentHits = intent.identityTerms.intersection(chunkTerms).count
        let titleHits = intent.identityTerms.intersection(titleTerms).count
        // Once a title identifies the meeting, words not present in that title
        // carry the user's actual information need (for example "Wi-Fi" or
        // "Cody"). Give those exact source hits priority over repeated title
        // text inside a generated summary.
        var value = Double(contentHits * 4 + focusHits * 20 + titleHits * 36)

        if namedMeetingIDs.contains(chunk.meetingID) { value += 30 }

        let actionHits = actionExpansion.intersection(chunkTerms).count
        let decisionHits = decisionWords.intersection(chunkTerms).count
        let hasActionHeading = normalized(chunk.text).contains("action item")
            || normalized(chunk.text).contains("next step")
            || normalized(chunk.text).contains("follow up")
        let hasDecisionHeading = normalized(chunk.text).contains("decision")

        if intent.isActionQuestion {
            value += Double(actionHits * 5)
            if hasActionHeading { value += 28 }
        }
        if intent.isDecisionQuestion {
            value += Double(decisionHits * 6)
            if hasDecisionHeading { value += 24 }
        }

        switch chunk.source {
        case .generatedNotes: value += 3
        case .roughNotes: value += 2
        case .transcript: value += 1
        }

        if let embedding {
            let distance = embedding.distance(
                between: intent.normalizedQuestion,
                and: String(chunk.text.prefix(maxChunkChars))
            )
            value += max(0, 1.35 - distance) * 12
        }

        let ageDays = max(0, now.timeIntervalSince(chunk.meetingDate) / 86_400)
        value += max(0, 1 - ageDays / 365)

        let topicMatches = intent.identityTerms.isEmpty || identityContentHits > 0 || titleHits > 0
        return ScoredChunk(
            chunk: chunk,
            score: value,
            hasIntentEvidence: intent.isActionQuestion
                ? (actionHits > 0 || hasActionHeading) && topicMatches
                : intent.isDecisionQuestion
                    ? (decisionHits > 0 || hasDecisionHeading) && topicMatches
                    : contentHits > 0 || titleHits > 0
        )
    }

    private static func selectTargeted(
        _ scored: [ScoredChunk],
        meetings: [AskMeetingSnapshot],
        seedEveryMeeting: Bool
    ) -> [AskEvidenceChunk] {
        let sorted = scored.sorted(by: scoredBefore)
        var selected: [AskEvidenceChunk] = []
        var counts: [UUID: Int] = [:]

        // Seed every explicitly named meeting. For a topic question without a
        // named meeting, seed only the three strongest meetings; seeding the
        // whole corpus would recreate the old newest-first context crowding.
        let seedIDs: [UUID]
        if seedEveryMeeting {
            seedIDs = meetings.map(\.id)
        } else {
            seedIDs = sorted.reduce(into: [UUID]()) { ids, candidate in
                if ids.count < 3, !ids.contains(candidate.chunk.meetingID) {
                    ids.append(candidate.chunk.meetingID)
                }
            }
        }
        for id in seedIDs {
            guard let best = sorted.first(where: { $0.chunk.meetingID == id }) else { continue }
            selected.append(best.chunk)
            counts[id, default: 0] += 1
        }

        let perMeetingLimit = seedEveryMeeting ? maxTargetedChunksPerMeeting : 3
        for candidate in sorted {
            guard selected.count < maxTargetedChunks else { break }
            guard counts[candidate.chunk.meetingID, default: 0] < perMeetingLimit else {
                continue
            }
            guard !selected.contains(candidate.chunk) else { continue }
            selected.append(candidate.chunk)
            counts[candidate.chunk.meetingID, default: 0] += 1
        }
        return selected
    }

    private static func selectExhaustive(
        _ scored: [ScoredChunk],
        meetings: [AskMeetingSnapshot],
        intent: QueryIntent
    ) -> [AskEvidenceChunk] {
        var selected: [AskEvidenceChunk] = []
        for meeting in meetings {
            let meetingChunks = scored
                .filter { $0.chunk.meetingID == meeting.id }
                .sorted(by: scoredBefore)
            let intentMatches = meetingChunks.filter(\.hasIntentEvidence)
            let candidates = intentMatches.isEmpty ? meetingChunks : intentMatches
            let limit = (intent.isActionQuestion || intent.isDecisionQuestion)
                ? maxExhaustiveChunksPerMeeting
                : 1
            selected += candidates.prefix(limit).map(\.chunk)
        }
        return selected
    }

    private static func scoredBefore(_ lhs: ScoredChunk, _ rhs: ScoredChunk) -> Bool {
        if lhs.score != rhs.score { return lhs.score > rhs.score }
        if lhs.chunk.meetingDate != rhs.chunk.meetingDate {
            return lhs.chunk.meetingDate > rhs.chunk.meetingDate
        }
        return lhs.chunk.source.rawValue < rhs.chunk.source.rawValue
    }

    private static func namedMeetingIDs(
        in meetings: [AskMeetingSnapshot],
        identityTerms: Set<String>
    ) -> Set<UUID> {
        guard !identityTerms.isEmpty else { return [] }
        let threshold = identityTerms.count == 1 ? 1 : 2
        let titleMatches = meetings.compactMap { meeting -> UUID? in
            let hits = identityTerms.intersection(words(in: meeting.title)).count
            return hits >= threshold ? meeting.id : nil
        }
        if !titleMatches.isEmpty { return Set(titleMatches) }

        // A customer or project name may only appear inside notes or the
        // transcript. Fall back to the complete local meeting corpus before
        // deciding the question is broad.
        let contentMatches = meetings.compactMap { meeting -> UUID? in
            var meetingTerms = words(in: meeting.generatedNotes)
            meetingTerms.formUnion(words(in: meeting.roughNotes))
            for segment in meeting.segments {
                meetingTerms.formUnion(words(in: segment.text))
            }
            let hits = identityTerms.intersection(meetingTerms).count
            return hits >= threshold ? meeting.id : nil
        }
        return Set(contentMatches)
    }

    // MARK: Query parsing and packing

    private static func queryIntent(_ question: String) -> QueryIntent {
        let normalizedQuestion = normalized(question)
        let terms = words(in: question)
        let action = !terms.intersection(actionWords).isEmpty
            || normalizedQuestion.contains("to do")
            || normalizedQuestion.contains("follow up")
        let decision = !terms.intersection(decisionWords).isEmpty
        let requestsAll = terms.contains("all")
            || terms.contains("every")
            || terms.contains("each")
            || normalizedQuestion.contains("across my meetings")
            || normalizedQuestion.contains("this week")
            || normalizedQuestion.contains("last week")
        let latestMeetingOnly = normalizedQuestion.contains("last meeting")
            || normalizedQuestion.contains("latest meeting")
            || normalizedQuestion.contains("most recent meeting")
        return QueryIntent(
            normalizedQuestion: normalizedQuestion,
            queryTerms: terms,
            identityTerms: terms
                .subtracting(stopWords)
                .subtracting(actionWords)
                .subtracting(decisionWords),
            isActionQuestion: action,
            isDecisionQuestion: decision,
            requestsAll: requestsAll,
            latestMeetingOnly: latestMeetingOnly
        )
    }

    private static func dateScope(
        for question: String,
        now: Date,
        calendar: Calendar
    ) -> DateScope? {
        let query = normalized(question)
        if query.contains("today") {
            let start = calendar.startOfDay(for: now)
            guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return nil }
            return DateScope(range: start..<end, description: "today")
        }
        if query.contains("yesterday") {
            let end = calendar.startOfDay(for: now)
            guard let start = calendar.date(byAdding: .day, value: -1, to: end) else { return nil }
            return DateScope(range: start..<end, description: "yesterday")
        }
        if query.contains("this week") {
            guard let interval = calendar.dateInterval(of: .weekOfYear, for: now) else { return nil }
            return DateScope(range: interval.start..<interval.end, description: "this week")
        }
        if query.contains("last week") {
            guard
                let thisWeek = calendar.dateInterval(of: .weekOfYear, for: now),
                let start = calendar.date(byAdding: .weekOfYear, value: -1, to: thisWeek.start)
            else { return nil }
            return DateScope(range: start..<thisWeek.start, description: "last week")
        }
        return nil
    }

    private static func pack(
        _ chunks: [AskEvidenceChunk],
        labels: [UUID: String],
        maxBatchChars: Int
    ) -> [[AskEvidenceChunk]] {
        guard !chunks.isEmpty else { return [] }
        var batches: [[AskEvidenceChunk]] = []
        var current: [AskEvidenceChunk] = []
        var used = 0

        for chunk in chunks {
            let sectionChars = renderedLength(chunk, label: labels[chunk.meetingID] ?? "M?")
            if used + sectionChars > maxBatchChars, !current.isEmpty {
                batches.append(current)
                current = []
                used = 0
            }
            current.append(chunk)
            used += sectionChars
        }
        if !current.isEmpty { batches.append(current) }
        return batches
    }

    private static func renderedLength(_ chunk: AskEvidenceChunk, label: String) -> Int {
        chunk.text.count + chunk.meetingTitle.count + chunk.source.rawValue.count + label.count + 100
    }

    private static func meaningfulTerms(in text: String) -> Set<String> {
        words(in: text).subtracting(stopWords)
    }

    private static func words(in text: String) -> Set<String> {
        let value = normalized(text)
        var result = Set(value
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 2 })
        // Treat common hyphen variants as equivalent: "Wi-Fi" should match
        // "wifi", and "follow-up" should match "followup".
        for token in value.components(separatedBy: .whitespacesAndNewlines)
            where token.contains("-")
        {
            let collapsed = token
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .joined()
            if collapsed.count >= 2 { result.insert(collapsed) }
        }
        return result
    }

    private static func normalized(_ text: String) -> String {
        text.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
    }
}
