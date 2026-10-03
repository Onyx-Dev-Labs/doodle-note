# Offline summary generation

ONY-250 adds a reviewable generated draft and immutable retained versions to the native Summary pane. The six formats are General, Client discovery, Project/status, One-to-one, Interview, and Training/workshop. Output initially uses the note's recording language, with an explicit override among English, Danish, Spanish, French, and German. Personal text, ink, transcript language and audio are not changed.

## Source and inference contract

The generator uses the existing on-device generation engine and its independent language/device readiness checks. It makes no network request and has no cloud fallback. Synthetic fixture success does not qualify Apple's model on a physical device or prove language quality.

Every nonempty typed paragraph is included in ordered bounded source batches. Transcript grounding prefers finalized and user-corrected passages; provisional hypotheses are omitted when any final passage exists. Fragments retain the original immutable note revision and paragraph/passage anchor. Summaries are never fed back as original evidence. Final, unambiguous speaker labels are supplied as separate source data; provisional or overlapping attribution is omitted. A label is not a guessed task owner.

A response must have bounded JSON items, a supplied source ID, and a nonempty verbatim quote from that source. These checks reject malformed or fabricated citations. They do **not** prove that the generated claim follows from the quote. Every retained generated output therefore contains an explicit draft/review notice, labels decision/action groups as candidates to verify, and includes the original-language quotes beside translated claims. A valid-quote/adversarial-action fixture demonstrates this limit. Human review must check names, dates, commitments, contradictions and attribution before acting. A six-format/five-language fixture matrix tests routing and preservation, not semantic accuracy.

Recording/interrupted/nonfinal sources, unfinished local processing, correction review, and finished captures without a complete transcript receipt are visibly incomplete. `cloudTranscriptStatus` is the shared local and imported completion contract from ONY-245: `complete` is required before a recording is treated as fully transcribed; absent status is unknown, not completed. Imported typed-only notes with status `none` are not treated as failed recordings. Partial or interrupted imported status marks the draft incomplete without implying local audio exists. Visiting every supplied source fragment does not prove that every recorded word was transcribed or that every significant fact was selected by the model. Audio and ink are not transcribed or interpreted by this generator.

## Version and cancellation contract

Generation begins from a saved authorized note revision. A changed revision or authentication generation invalidates the result. Cancel and view dismissal discard a pending draft; late model responses cannot publish it. The engine may remain busy until an underlying request returns, and readiness/errors remain visible without changing prior content.

Saving appends a generated version with its own identity and original source anchors. It never mutates a prior version. Selecting a new generated version over an edited selected version requires confirmation; the edited version stays retained. Editing any version appends an edited child. Retrying persistence uses the existing save-error flow; no success is claimed from an unsaved state.

## Check this

1. On a qualified physical device, generate each format in each supported language, including output language different from recording language. Check full source coverage, quote fidelity and unsupported owner/date/commitment claims with the agreed quality rubric.
2. Create a generated version, edit it, then regenerate. Review the draft, confirm selection and reopen the note. All versions and original personal text should remain.
3. Cancel generation, switch accounts, edit the source or remove model readiness during a request. A stale result must not become selected or cross library boundaries.
4. Generate from an interrupted recording, a finished recording without a complete transcript receipt, or a note that still needs transcript correction review. Expect an incomplete-source warning, not a claim of complete audio processing. A local `complete` receipt with only final passages should not show that warning.
5. In the debug synthetic UI fixture (`--ui-testing --summary-fixture`), inspect draft saving, original source access and retained versions. The fixture is visibly labeled and does not run real inference.

ONY-245 PR #146 is merged on `main` and this lane now consumes its completion/review contract. Physical inference, language-qualified UI/output review and real-speech quality remain open acceptance gates. Simulator fixtures and a tested PR are separate from device qualification or release.
