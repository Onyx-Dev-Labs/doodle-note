import Foundation
import SwiftData

/// "Ask anything" — grounded chat with one meeting or the full local corpus.
/// Retrieval stays on-device; the selected NotesEngine performs synthesis.
enum AskEngine {
    struct Exchange: Sendable {
        var question: String
        var answer: String
    }

    static let meetingSystemPrompt = """
    You are the meeting assistant inside DoodleNote. The user asks about ONE meeting. Source excerpts from that meeting's generated notes, rough notes, and transcript are provided.

    Rules:
    - Answer using ONLY the provided sources. Never use outside knowledge or guess.
    - If the answer is absent, say plainly that it did not come up in the provided meeting sources.
    - This is a single-channel in-person recording. Attribute a statement to a person only when the source makes that clear.
    - Preserve names, owners, dates, numbers, and commitments exactly as written.
    - Cite factual claims with the source label and meeting title, for example: [M1] Project Kickoff — 2026-07-15.
    - When asked for action items, output only the action items; do not add a meeting recap or unrelated topics.
    - When asked to draft an email or follow-up, produce ready-to-send copy using only the supplied meeting facts.
    - Be concise and answer directly. Markdown is allowed.
    """

    static let globalSystemPrompt = """
    You are the meeting assistant inside DoodleNote. The user asks questions across their meetings. Relevant excerpts from meeting titles, generated notes, rough notes, and transcripts are provided.

    Rules:
    - Answer using ONLY the provided sources. Never use outside knowledge or guess.
    - If the answer is absent, say plainly that it does not appear in the provided sources.
    - Preserve names, owners, dates, numbers, and commitments exactly as written.
    - Transcript excerpts come from single-channel recordings. Attribute words to a person only when the excerpt itself makes the speaker clear.
    - Every factual group or bullet must cite its source label, meeting title, and date, for example: [M2] Customer Review — 2026-07-15.
    - For todos, decisions, or follow-ups, group results by meeting and retain the owner and deadline when present.
    - When asked for action items, output only the action items; do not add a meeting recap or unrelated topics.
    - Do not claim an item is still open unless the source explicitly says so; call it an action item instead.
    - When asked to draft an email or follow-up, produce ready-to-send copy using only the supplied meeting facts.
    - Be concise and answer directly. Markdown is allowed.
    """

    private static let exhaustiveSystemPrompt = globalSystemPrompt + """

    This request may be processed in multiple evidence batches. Return every relevant fact in THIS batch, with citations. Do not summarize away distinct action items, owners, deadlines, or decisions. If this batch contains nothing that answers the question, output exactly NO_MATCH.
    """

    private static let maxHistory = 4

    // MARK: Per-meeting ask

    @MainActor
    static func ask(meeting: Meeting, question: String, history: [Exchange]) async throws -> String {
        let snapshot = snapshot(meeting)
        guard snapshot.hasSourceContent else {
            return "This meeting doesn't have notes or transcript content to search yet."
        }

        let historySearch = retrievalHistory(history)
        let budget = NotesEngineFactory.contextBudgetChars
        let result = await Task.detached(priority: .userInitiated) {
            AskRetrieval.retrieve(
                meetings: [snapshot],
                question: question,
                history: historySearch,
                maxBatchChars: budget
            )
        }.value

        guard let batch = result.batches.first else {
            return "I couldn't find that in this meeting's notes or transcript."
        }
        let user = prompt(
            evidence: result.render(batch),
            question: question,
            history: history
        )
        let answer = try await NotesEngineFactory.make().respond(
            system: meetingSystemPrompt,
            user: user,
            maxResponseTokens: 600
        )
        return result.attributed(answer)
    }

    // MARK: Cross-meeting ask

    @MainActor
    static func askGlobal(meetings: [Meeting], question: String, history: [Exchange]) async throws -> String {
        var snapshots: [AskMeetingSnapshot] = []
        snapshots.reserveCapacity(meetings.count)
        for (index, meeting) in meetings.enumerated() where meeting.hasNoteSourceContent {
            snapshots.append(snapshot(meeting))
            if index.isMultiple(of: 5) { await Task.yield() }
        }

        guard !snapshots.isEmpty else {
            return "I couldn't find any meeting notes or transcripts to search yet."
        }

        let historySearch = retrievalHistory(history)
        let budget = NotesEngineFactory.contextBudgetChars
        let result = await Task.detached(priority: .userInitiated) {
            AskRetrieval.retrieve(
                meetings: snapshots,
                question: question,
                history: historySearch,
                maxBatchChars: budget
            )
        }.value

        guard !result.batches.isEmpty else {
            if let scope = result.dateScopeDescription {
                return "I couldn't find any meetings from \(scope)."
            }
            return "I couldn't find relevant meeting notes or transcript details for that question."
        }

        let engine = NotesEngineFactory.make()
        if !result.isExhaustive, let batch = result.batches.first {
            let answer = try await engine.respond(
                system: globalSystemPrompt,
                user: prompt(
                    evidence: result.render(batch),
                    question: question,
                    history: history
                ),
                maxResponseTokens: 600
            )
            return result.attributed(answer)
        }

        // Broad requests (for example, "all action items this week") are
        // processed in bounded batches. This is slower than one completion but
        // never silently drops meetings just because Apple's context is small.
        var answers: [String] = []
        for batch in result.batches {
            let answer = try await engine.respond(
                system: exhaustiveSystemPrompt,
                user: prompt(
                    evidence: result.render(batch),
                    question: question,
                    history: history
                ),
                maxResponseTokens: 700
            ).trimmingCharacters(in: .whitespacesAndNewlines)
            if answer.caseInsensitiveCompare("NO_MATCH") != .orderedSame {
                answers.append(answer)
            }
        }

        guard !answers.isEmpty else {
            return "I couldn't find that in the matching meeting notes or transcripts."
        }
        return result.attributed(answers.joined(separator: "\n\n"))
    }

    // MARK: Context snapshots and prompts

    @MainActor
    private static func snapshot(_ meeting: Meeting) -> AskMeetingSnapshot {
        AskMeetingSnapshot(
            id: meeting.id,
            title: meeting.displayTitle,
            createdAt: meeting.createdAt,
            generatedNotes: meeting.generatedNotes ?? "",
            roughNotes: meeting.roughNotes,
            segments: meeting.sortedSegments.map {
                AskMeetingSnapshot.TranscriptSegment(
                    speaker: $0.speaker,
                    text: $0.text,
                    startMs: $0.startMs,
                    endMs: $0.endMs
                )
            }
        )
    }

    private static func retrievalHistory(_ history: [Exchange]) -> [String] {
        history.suffix(2).map { exchange in
            // The previous question carries conversational scope. Feeding the
            // entire answer back into retrieval can introduce unrelated terms
            // and pull a follow-up toward the wrong meeting.
            "Previous question: \(exchange.question)"
        }
    }

    private static func prompt(
        evidence: String,
        question: String,
        history: [Exchange]
    ) -> String {
        var sections = ["=== MEETING SOURCES ===\n\(evidence)"]
        if !history.isEmpty {
            let prior = history.suffix(maxHistory).map { exchange in
                "Q: \(exchange.question)\nA: \(exchange.answer)"
            }.joined(separator: "\n\n")
            // Retrieval uses the complete recent exchanges, while the model
            // gets a bounded tail so history cannot evict current evidence.
            sections.append("=== PRIOR Q&A ===\n\(String(prior.suffix(1_600)))")
        }
        sections.append("""
        === QUESTION ===
        \(question)

        Answer using only the labeled meeting sources above.
        """)
        return sections.joined(separator: "\n\n")
    }
}
