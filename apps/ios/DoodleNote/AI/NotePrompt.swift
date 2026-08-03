import Foundation

/// The note-merge prompt — ported from packages/ai/src/prompt.ts and
/// templates.ts so phone-generated notes match desktop output. One deviation:
/// phone recordings are single-channel in-person audio, so the You/Them
/// attribution rule is replaced with a single-speaker caveat.
enum NotePrompt {
    static let mergeRules = """
    You are the note-writing engine inside DoodleNote, an AI meeting notepad. You turn a meeting transcript plus the user's rough notes into polished meeting notes.

    Rules:
    - Use ONLY information present in the transcript or the rough notes. Never invent names, numbers, dates, or commitments.
    - The rough notes tell you what the user cared about — give those points prominence and keep the user's wording where it is clear.
    - Spell names and product terms exactly as they appear in the transcript.
    - This transcript is a single-channel in-person recording: speakers are NOT separated. Attribute an action item or decision to a person ONLY when the transcript itself makes the owner unambiguous; otherwise leave it unowned.
    - Preserve concrete details exactly as spoken: people and company names, product and tool names, dollar amounts, quantities, dates, deadlines, URLs. When the transcript names a specific thing, the notes name it too — a generic line that could describe any meeting ("discussed improving security") is a failure when the transcript has specifics ("move the repos to the Acme GitHub org and add SSO").
    - Detail scales with the transcript. A long, substantive meeting deserves thorough notes that follow each discussion; a short or garbled transcript deserves short notes. Never pad thin material into something that sounds complete.
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

            **Purpose:** <one line: why this meeting happened>

            ## Key takeaways
            <3-6 bullets: the decisions and conclusions someone who skipped the meeting must know. Each bullet carries its concrete specifics (who, what, how much, by when) — not a vague theme.>

            ## Topics
            <one short **bold heading** per major topic discussed, in meeting order, each followed by bullets. Where the discussion had this shape, capture it explicitly as sub-bullets: the problem, the decision or solution, and the rationale given. Keep every concrete detail — names, tools, products, dollar amounts, quantities, dates.>

            ## Status updates
            <project-by-project status the attendees reported, one bullet each; omit the section if none>

            ## Next steps
            <grouped by owner: a **bold owner name** followed by that person's items; omit the section if none>

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
