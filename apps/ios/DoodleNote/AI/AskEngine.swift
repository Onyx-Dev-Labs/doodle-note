import Foundation
import SwiftData

/// "Ask anything" — chat with one meeting or across recent meetings.
/// Prompts ported from packages/ai/src/ask-prompt.ts and
/// global-ask-prompt.ts; answers are grounded strictly in meeting context.
enum AskEngine {
    struct Exchange {
        var question: String
        var answer: String
    }

    static let meetingSystemPrompt = """
    You are the meeting assistant inside Doodle Note, an AI meeting notepad. The user asks questions about ONE specific meeting; its full context (transcript, the user's rough notes, generated notes, prior Q&A) is provided with the question.

    Rules:
    - Answer using ONLY the provided meeting context. No outside knowledge, no guesses.
    - If the answer is not in the meeting, say plainly that it didn't come up in this meeting. Never invent facts, names, numbers, or commitments.
    - This transcript is a single-channel in-person recording: speakers are not separated. Attribute a statement to a person only when the transcript itself makes that clear.
    - Be concise: answer the question directly, then stop. No preamble like "Based on the meeting…".
    - Markdown is allowed when it helps (bullet lists, **bold**); plain sentences otherwise.
    - When asked to draft an email (e.g. a follow-up), produce a ready-to-send email grounded in the meeting's decisions and action items: a Subject line, a brief recap, decisions made, and action items with owners. Use only facts from the meeting and add no placeholders beyond the sender's own sign-off.
    """

    static let globalSystemPrompt = """
    You are the meeting assistant inside DoodleNote, an AI meeting notepad. The user asks questions across their RECENT MEETINGS. Notes for each meeting are provided, newest first.

    Rules:
    - Answer using ONLY the provided meeting notes. No outside knowledge, no guesses.
    - Attribute what you say: name the meeting (title and date) each point comes from. When the answer spans meetings, group by meeting, newest first.
    - If the answer is not in the provided notes, say plainly that it doesn't appear in the recent meetings. Never invent facts, names, numbers, or commitments.
    - When asked for todos or action items: list outstanding items grouped by meeting, newest first, keeping each item's owner. Skip meetings with none rather than writing "none".
    - Be concise: answer the question directly, then stop. No preamble.
    - Markdown is allowed when it helps (headings per meeting, bullet lists, **bold**).
    """

    private static let maxHistory = 6

    // MARK: Per-meeting ask

    @MainActor
    static func ask(meeting: Meeting, question: String, history: [Exchange]) async throws -> String {
        let budget = NotesEngineFactory.contextBudgetChars

        var transcript = meeting.sortedSegments
            .map { "[\(NotePrompt.formatTimestamp(ms: $0.startMs))] \($0.speaker): \($0.text)" }
            .joined(separator: "\n")
        if transcript.isEmpty { transcript = "(no transcript captured)" }
        if transcript.count > budget {
            let half = budget / 2
            transcript = transcript.prefix(half) + "\n[… middle omitted …]\n" + transcript.suffix(half)
        }

        var sections = [
            "Meeting: \(meeting.displayTitle)",
            "=== TRANSCRIPT ===\n\(transcript)",
            "=== USER'S ROUGH NOTES ===\n\(meeting.roughNotes.isEmpty ? "(the user took no rough notes)" : meeting.roughNotes)",
        ]
        if let generated = meeting.generatedNotes, !generated.isEmpty {
            sections.append("=== GENERATED NOTES ===\n\(generated)")
        }
        if !history.isEmpty {
            let exchanges = history.suffix(maxHistory)
                .map { "Q: \($0.question)\nA: \($0.answer)" }
                .joined(separator: "\n\n")
            sections.append("=== PRIOR Q&A (this conversation) ===\n\(exchanges)")
        }
        sections.append("=== QUESTION ===\n\(question)\n\nAnswer using only the meeting context above.")

        return try await NotesEngineFactory.make().respond(
            system: meetingSystemPrompt,
            user: sections.joined(separator: "\n\n")
        )
    }

    // MARK: Cross-meeting ask

    @MainActor
    static func askGlobal(meetings: [Meeting], question: String, history: [Exchange]) async throws -> String {
        let budget = NotesEngineFactory.contextBudgetChars
        var sections: [String] = []
        var used = 0
        var omitted = 0

        for meeting in meetings.sorted(by: { $0.createdAt > $1.createdAt }) {
            let date = meeting.createdAt.formatted(.iso8601.year().month().day())
            let notes = bestNotes(for: meeting)
            let section = "=== MEETING: \(meeting.displayTitle) — \(date) ===\n\(notes)"
            if used + section.count > budget && !sections.isEmpty {
                omitted += 1
                continue
            }
            sections.append(section)
            used += section.count
        }
        if omitted > 0 {
            sections.append("(\(omitted) older meeting\(omitted == 1 ? "" : "s") omitted for length)")
        }
        if !history.isEmpty {
            let exchanges = history.suffix(maxHistory)
                .map { "Q: \($0.question)\nA: \($0.answer)" }
                .joined(separator: "\n\n")
            sections.append("=== PRIOR Q&A (this conversation) ===\n\(exchanges)")
        }
        sections.append("=== QUESTION ===\n\(question)\n\nAnswer using only the meeting notes above.")

        return try await NotesEngineFactory.make().respond(
            system: globalSystemPrompt,
            user: sections.joined(separator: "\n\n")
        )
    }

    /// Generated notes preferred (compact and dense), then rough notes, then
    /// a transcript excerpt — same fallback order as desktop.
    private static func bestNotes(for meeting: Meeting) -> String {
        if let generated = meeting.generatedNotes, !generated.isEmpty { return generated }
        if !meeting.roughNotes.isEmpty { return meeting.roughNotes }
        let excerpt = meeting.sortedSegments.prefix(30)
            .map { "\($0.speaker): \($0.text)" }
            .joined(separator: "\n")
        return excerpt.isEmpty ? "(no notes captured)" : "Transcript excerpt:\n" + excerpt
    }
}
