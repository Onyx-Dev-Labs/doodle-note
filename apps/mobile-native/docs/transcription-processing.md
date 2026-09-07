# Local transcript processing (ONY-245)

The Apple Speech adapter remains a runtime-gated candidate. This implementation does not qualify accuracy, latency, accents, noisy meetings or all five launch languages. No authorized human reference corpus or physical-device measurements were available. The existing benchmark scorer tests validate scoring code, not recognition quality. Danish, English, French, German and Spanish each require measured samples before a release claim.

## Source and state contracts

- Passage identities survive provisional/final updates. A late provisional result cannot downgrade a final passage. Inconsistent final overlap retains the earlier text and marks the transcript for review.
- Corrections retain their passage identity, source interval and text. An exact final result finalizes the corrected passage without replacing its words. Changed boundaries that intersect a correction retain the prior source and mark review required. A stale correction editor keeps its draft and reports that its original passage changed.
- `cloudTranscriptStatus` is the shared optional completion contract, now also written by local processing. Recording begins `partial`; unsuccessful processing/cancellation writes `interrupted`; only successful complete input/finalization without gaps, provisional results or ambiguous corrections writes `complete`. Audio capture completion alone is insufficient. Absent legacy status is unknown, not completed. A persisted `partial` attempt remains retryable after restart, with no stuck in-memory processing claim.
- Optional local `speechSessions` retain each capture's selected language and start/end source times. Changing the selection for a later recording cannot change the earlier recording language. Legacy recordings without receipts use the note's previously stored language. Receipt absence cannot recover historical choices that were never stored.
- All new fields are optional for old JSON. Immutable revision snapshots retain original passage text and correction metadata. Source files are not rewritten by retry. Personal notes, title, ink, folders and summary versions are preserved by scoped updates.

## Saved audio retry

Retry uses validated `AudioTimeline` receipts, including missing ranges and previously removed audio origins. It never compresses gaps into earlier source times. Contiguous files from one recording session/language share one analyzer and converter. Five-second CAF rotation does not reset speech context. A missing interval, session boundary or language change starts a separate group.

`SavedAudioInput` pulls bounded one-second input buffers through the SDK-compatible audio converter. One converter persists across file boundaries; it flushes once and trims filter padding after the exact source endpoint. Explicit group-relative sample times are shifted by the preserved group start when results are committed. Format changes without a recording boundary fail visibly rather than guessing a new timeline. Finalization is awaited after all input is consumed, and the result stream must complete with final passages. A duration-scaled deadline cancels a stalled operation; it is not a measured latency promise.

Each completed group is committed against the currently authorized active note, not a stale whole-note snapshot. Source-plan and recording-session changes invalidate the result. Cancellation keeps the operation busy until its task drains. Restarting or retrying replaces uncorrected source hypotheses within the processed interval, retains corrected text, and does not append duplicate passages. Partial work already durably committed remains available after cancellation.

No audio upload, language auto-switch, automatic model download, alternate cloud recognizer or paid service is added. Missing models and unsupported locales leave audio and typed notes available. The retry UI exposes progress, cancellation, failures, correction review and timestamp playback.

## Verification and remaining QA

Focused iPhone tests cover five-language Unicode correction/coding, stable IDs, inconsistent final overlap, stale correction-editor identity, saved session languages, missing audio timestamps, cancellation with concurrent personal edits, unavailable inference, repeated retry and bounded conversion across chunks. A structural two-hour fixture checks that 1,440 contiguous five-second entries form one analyzer group; it is not a two-hour inference or hardware benchmark. The DEBUG transcript UI fixture is synthetic and enabled only with both `--ui-testing` and `--transcript-fixture`.

Check this:

1. On a qualified iPhone with the selected language model installed, record, watch provisional text, correct a passage and stop. Its corrected text must survive finalization and reopen.
2. Select another language for a later capture. Retry saved audio; each recording must use its retained language and timestamps.
3. Cancel retry, close/reopen, then retry again. Earlier committed text, original audio, personal edits and corrections must remain; no duplicate passages should appear.
4. Remove a synthetic audio segment or use an unsupported locale. Expect an incomplete/error state, preserved later source times and no claim of complete transcription.
5. Run the approved real-speech quality and latency rubric for all five languages and device classes. This remains required human/device qualification, separate from source and simulator checks.

Primary references: [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer), [AnalyzerInput](https://developer.apple.com/documentation/speech/analyzerinput), and the installed Xcode 26.6 Speech.swiftinterface. Newer online APIs absent from that SDK are not used. Rollback should retain the source files and new JSON metadata; do not downgrade by rewriting documents with an older client that drops optional fields.
