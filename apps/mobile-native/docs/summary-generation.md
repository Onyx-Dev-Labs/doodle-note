# Offline summary generation

ONY-250 adds a reviewable generated draft and immutable retained versions to the native Summary pane. The six formats are General, Client discovery, Project/status, One-to-one, Interview, and Training/workshop. Output initially uses the note's recording language, with an explicit override among English, Danish, Spanish, French, and German. Personal text, ink, transcript language and audio are not changed.

## Source and inference contract

The generator uses the existing on-device generation engine and its independent language/device readiness checks. It makes no network request and has no cloud fallback. Synthetic fixture success does not qualify Apple's model on a physical device or prove language quality.

Every nonempty typed paragraph and transcript passage is included in ordered bounded source batches. Fragments retain the original immutable note revision and paragraph/passage anchor. Summaries are never fed back as original evidence. Final, unambiguous speaker labels are supplied as separate source data; provisional or overlapping attribution is omitted. A label is not a guessed task owner.

A response must have bounded JSON items, a supplied source ID, and a nonempty verbatim quote from that source. These checks reject malformed or fabricated citations. They do **not** prove that the generated claim follows from the quote. Every retained generated output therefore contains an explicit unverified-draft notice, labels decision/action groups as candidates to verify, and includes the original-language quotes beside translated claims. A valid-quote/adversarial-action fixture demonstrates this limit. Human review must check names, dates, commitments, contradictions and attribution before acting. A six-format/five-language fixture matrix tests routing and preservation, not semantic accuracy.

Recording/interrupted/nonfinal sources and finished captures with no transcript are visibly incomplete. Imported partial/interrupted transcript status also marks the draft incomplete without implying local audio exists. An imported typed-only note with status none is not treated as a failed recording. The shared optional completion field is backward compatible. Full transcription coverage and importer integration remain dependent on ONY-245/262 acceptance. Visiting every supplied source fragment does not prove that every recorded word was transcribed or that every significant fact was selected by the model. Audio and ink are not transcribed or interpreted by this generator.

## Version and cancellation contract

Generation begins from a saved authorized note revision. A changed revision or authentication generation invalidates the result. Cancel and view dismissal discard a pending draft; late model responses cannot publish it. The engine may remain busy until an underlying request returns, and readiness/errors remain visible without changing prior content.

Saving appends a generated version with its own identity and original source anchors. It never mutates a prior version. Selecting a new generated version over an edited selected version requires confirmation; the edited version stays retained. Editing any version appends an edited child. Retrying persistence uses the existing save-error flow; no success is claimed from an unsaved state.

## Check this

1. On a qualified physical device, generate each format in each supported language, including output language different from recording language. Check full source coverage, quote fidelity and unsupported owner/date/commitment claims with the agreed quality rubric.
2. Create a generated version, edit it, then regenerate. Review the draft, confirm selection and reopen the note. All versions and original personal text should remain.
3. Cancel generation, switch accounts, edit the source or remove model readiness during a request. A stale result must not become selected or cross library boundaries.
4. Generate from an interrupted recording or a finished recording without transcription. Expect an incomplete-source warning, not a claim of complete audio processing.
5. In the debug synthetic UI fixture (`--ui-testing --summary-fixture`), inspect draft saving, original source access and retained versions. The fixture is visibly labeled and does not run real inference.

Physical inference/language quality and complete ONY-245 transcription integration are open acceptance gates. Simulator fixtures and a tested PR are separate from device qualification or release.
