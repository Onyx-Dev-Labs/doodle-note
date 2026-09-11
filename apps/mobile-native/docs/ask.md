# Meeting and library Ask

Open **Ask this library** from Home, or **Editor navigation → Ask this meeting**. Home scans all saved, authorized notes in the selected library, including old history and every folder. Select another connected library explicitly. Meeting Ask flushes personal edits and scans that meeting's typed notes and transcript. Search cache summaries are not evidence.

The local model selects verbatim relevant original passages. The app validates quote membership and retains each immutable source anchor; it does not display an ungrounded generated paraphrase as a fact. Sources remain in their original language even when the requested matching language differs. Typed text and transcript are labeled separately. If both kinds occur, the answer warns that they may disagree and does not adjudicate conflicting claims. Relevance selection still requires human language/model QA, including opposing claims spread across separate fragments.

Every original source is visited in bounded fragments, with visible progress and cancellation. There is no top-k or newest-note window. Count/list views explicitly count model-identified matching **notes**, not people, tasks or occurrences; all evidence remains visible for review. Unavailable, unsaved, partial or interrupted content prevents a complete census claim. Unsupported questions display insufficient evidence, never an invented answer. Counts describe available evidence, not guarantees about missing content or model recall.

Original passages open in a source sheet. Transcript audio playback is offered only when local audio exists, uses the source timeline, and respects capture restrictions. A source edit can invalidate an in-flight answer; authentication/scope changes clear visible results and citations. No conversation or answer is written to notes, sync or archives in this issue. No external calls, tools or automatic actions are available to model content.

Apple's generation model is a runtime-gated candidate. Unsupported devices/languages, unprepared Apple Intelligence and simulator unavailability produce a visible unavailable state, never fake normal answers or a cloud fallback. `--ui-testing --ask-fixture` enables an explicitly synthetic debug selector for deterministic UI tests only.

## Check this

1. Add typed notes and finalized transcript in each launch language. Ask from the meeting, then Home. Confirm Home includes older notes and all folders only within the chosen library.
2. Ask count/list questions. Confirm matching note counts, visible original evidence and incomplete warnings when saves or transcription are unfinished. Ask an unsupported question and expect insufficient evidence.
3. Enter opposing typed and spoken claims. Both original sources and their types should remain inspectable without an invented resolution. Review relevance on a real prepared model; fixture tests do not establish accuracy.
4. Open citations with and without retained audio. Read original saved text; playback must never fetch missing audio. During recording, playback is disabled.
5. Cancel a long question, change library or revoke an account. No partial result is presented as complete and no earlier account evidence remains visible.

The new interface translations are machine drafts. Physical device, language-quality, accessibility and real offline model QA remain separate gates.
