import Foundation

/// The note-merge prompt — ported from packages/ai/src/prompt.ts and
/// templates.ts so phone-generated notes match desktop output. One deviation:
/// phone recordings are single-channel in-person audio, so the You/Them
/// attribution rule is replaced with a single-speaker caveat.
enum NotePrompt {
    static let mergeRules = """
    You are the note-writing engine inside Doodle Note, an AI meeting notepad. You turn a meeting transcript plus the user's rough notes into polished meeting notes.

    Rules:
    - Use ONLY information present in the transcript or the rough notes. Never invent names, numbers, dates, or commitments.
    - The rough notes tell you what the user cared about — give those points prominence and keep the user's wording where it is clear.
    - Spell names and product terms exactly as they appear in the transcript.
    - This transcript is a single-channel in-person recording: speakers are NOT separated. Attribute an action item or decision to a person ONLY when the transcript itself makes the owner unambiguous; otherwise leave it unowned.
    - Write in tight, plain English. No filler, no corporate fluff.
    - A section heading with nothing real to put under it is omitted entirely.

    """

    struct Template: Identifiable {
        let id: String
        let label: String
        let outputFormat: String
    }

    static let templates: [Template] = [
        Template(
            id: "general",
            label: "General meeting",
            outputFormat: """
            Output format (markdown, nothing before or after it):
            # <meeting title>

            <1-2 sentence summary of what the meeting was about and its outcome>

            ## Notes
            <the substance, grouped under short bold topic lines following the meeting's flow; bullets, not paragraphs>

            ## Decisions
            <bullet list of decisions actually made; omit the section if none>

            ## Action items
            <markdown checkboxes: - [ ] Owner — task (deadline if stated); omit the section if none>
            """
        ),
        Template(
            id: "customer-discovery",
            label: "Customer discovery",
            outputFormat: """
            Output format (markdown, nothing before or after it):
            # <meeting title>

            <1-2 sentence summary: who the customer is and what they need>

            ## Company & contacts
            <who was on the call, company, roles; only what the transcript supports>

            ## Situation & pain points
            <what hurts today, in their words where possible>

            ## Requirements & success criteria
            <what a solution must do for them>

            ## Budget & timeline
            <anything said about money or dates; omit the section if none>

            ## Next steps
            <markdown checkboxes: - [ ] Owner — task (deadline if stated)>
            """
        ),
        Template(
            id: "one-on-one",
            label: "1:1",
            outputFormat: """
            Output format (markdown, nothing before or after it):
            # <meeting title>

            <1 sentence summary of the conversation>

            ## Discussed
            <bullets grouped by topic>

            ## Feedback
            <feedback given or received; omit the section if none>

            ## Action items
            <markdown checkboxes: - [ ] Owner — task (deadline if stated); omit the section if none>
            """
        ),
    ]

    static func template(id: String) -> Template {
        templates.first { $0.id == id } ?? templates[0]
    }

    static func systemPrompt(templateId: String) -> String {
        mergeRules + template(id: templateId).outputFormat
    }

    static func formatTimestamp(ms: Int) -> String {
        let totalSec = ms / 1000
        return "\(totalSec / 60):" + String(format: "%02d", totalSec % 60)
    }

    /// Builds the user message. `maxTranscriptChars` bounds the transcript for
    /// small context windows (on-device model); when over budget we keep the
    /// head and tail, which carry the setup and the conclusions.
    static func userMessage(
        title: String,
        roughNotes: String,
        segments: [(speaker: String, text: String, startMs: Int)],
        durationMs: Int?,
        maxTranscriptChars: Int
    ) -> String {
        let cleanTitle = title.trimmingCharacters(in: .whitespaces).isEmpty
            ? "Untitled meeting" : title
        let rough = roughNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "(the user took no rough notes)" : roughNotes

        var transcript = segments.isEmpty
            ? "(no transcript captured)"
            : segments
                .map { "[\(formatTimestamp(ms: $0.startMs))] \($0.speaker): \($0.text)" }
                .joined(separator: "\n")

        if transcript.count > maxTranscriptChars {
            let half = maxTranscriptChars / 2
            let head = transcript.prefix(half)
            let tail = transcript.suffix(half)
            transcript = head + "\n[… middle of transcript omitted to fit the model …]\n" + tail
        }

        let duration = durationMs.map { "\nDuration: \(Int(($0 / 60000))) minutes" } ?? ""

        return """
        Meeting: \(cleanTitle)\(duration)

        === USER'S ROUGH NOTES ===
        \(rough)

        === TRANSCRIPT ===
        \(transcript)

        Write the polished meeting notes now.
        """
    }
}
