# DoodleNote native mobile foundation

This is the fresh iPhone/iPad implementation approved on September 6, 2026. It was created independently of `apps/ios`; no implementation or project setup was copied from that directory. The [approved specification](docs/discovery/doodlenote_Specification_v1.md) governs the complete first release.

## Current checkpoint

This checkpoint includes the native foundation, journaled audio recovery, and an experimental on-device speaker pipeline within the native feasibility stage. It is not a completed feasibility study or a beta release.

- Native SwiftUI library, standalone notes, text search, and dedicated compact/regular-width editing layouts.
- Atomic local note documents containing typed text, PencilKit drawings, transcript passages, and capture state. Unreadable/future-format documents remain untouched. A previously active recording is marked interrupted when reopening.
- Microphone pipeline with a bounded writer queue and rolling PCM CAF files. Closed chunks remain independently readable; normal stopping drains the queue and closes the final chunk. Disk/backlog errors stop capture visibly. Live speech failure leaves audio capture running.
- Local playback across saved chunks and passage timestamp navigation. Journaled open PCM tails are repaired into separate validated copies on startup; originals remain untouched.
- Optional streaming speaker labels using a pinned FluidAudio/Sortformer model, explicit checksum-verified download, four speaker slots, provisional labels, confirmed names, and optional device-local remembered voices. Speaker processing has a separate bounded queue so a slow model cannot silently drop saved audio. Voice profiles are excluded from notes sync, archive copies and generation payloads.
- Apple's SpeechAnalyzer/SpeechTranscriber integration with runtime device/locale/installed-asset checks, explicit model download, bounded input, audio conversion, provisional/final results, and cancellation requested after a finalization timeout. No network transcription fallback.
- English, Danish, Spanish, French, and German are selectable **spoken-language candidates**. This does not establish recognition availability or accuracy for all five on real hardware. This foundation's interface is still English; the accepted five-language UI remains required work.
- PencilKit canvas with a tool picker, drawing persistence, zoom, and ordinary system text entry. Physical Pencil, Scribble, pressure/latency, and accessibility acceptance are still open.

The optional speaker model download retrieves four pinned public files from Hugging Face (240,139,774 bytes); inference runs locally. Model assets and voice profiles are outside note documents and excluded from operating-system backup. Microphone audio never enters cloud notes sync or optional external AI.

## Build and test

Prerequisites: Xcode 26 with the iOS 26 SDK and XcodeGen. The initial local verification used Xcode 26.6 (17F113), iOS 26.5 simulators, and XcodeGen 2.45.4. iOS 26 is a **prototype API requirement**, not the finalized release device floor.

From this directory:

```sh
xcodegen generate
xcodebuild -project DoodleNoteNative.xcodeproj -scheme DoodleNoteNative \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO test
```

Use any installed compatible simulator name/OS. The Xcode project is generated and excluded by the repository's existing ignore rules. `project.yml` and `Config/Info.plist` are the reproducible project sources. No legacy iOS project is required. The prototype bundle ID is `ai.doodlenote.native.prototype`; physical installation needs a development team and provisioning. Production signing and store configuration are not included.

Tests cover local text/ink/transcript round trips, crash-state recovery without deleting audio, corrupt/future documents, provisional transcript replacement, chunk frame preservation, source-format preservation during speech conversion, and UI note persistence after terminating/relaunching the app. The UI test uses a separate app storage directory and generates synthetic text. Audio tests use synthetic PCM buffers and do not activate a microphone.

## Storage and failure behavior

Application Support contains one UUID directory per note. `note.json` is atomically replaced and protected until first device unlock; `audio/` contains rolling recordings. This is an internal prototype schema, not the future cloud protocol or backup archive format. No data migration from the old iOS app is attempted.

Recording metadata is persisted before the engine starts. Audio is closed roughly every five seconds and on a normal stop. The writer journals each open chunk; startup repairs supported PCM headers and incomplete final frames into a separate copy, validates its frame count, and selects that copy for playback without duplicating the original. Synthetic torn-tail tests pass. Actual process-kill, power-loss, and low-storage behavior still require device testing; bytes never flushed to storage cannot be recovered. PCM storage is intentionally straightforward for measurement, but needs storage-budget, low-space, and two-hour tests before release decisions.

Note writes currently encode the complete document. Transcript UI is lazy, but indexing, incremental persistence, large-ink performance, and long-session memory behavior still need evaluation. A write failure keeps edits visible and shows an error. The app has no Trash or permanent-delete action yet.

## Next implementation gates

1. Qualify live three/four-speaker labeling, remembered-voice matching and unknown rejection on physical iPhone and iPad with authorized material. Resolve model redistribution notices before release; see [speaker evaluation](docs/speaker-evaluation.md).
2. Run the integrated mic/transcript/speaker/Pencil path on physical iPhone and iPad, using authorized test material. Measure five-language recognition, attribution, latency, thermals, memory, storage, interruption/route behavior, screen lock, restart, and complete two-hour preservation. Simulator success cannot satisfy this gate.
3. Add audio import, recovery/retry controls for unsupported damaged recordings, complete model management and readiness UX, and all five interface languages. Preserve the full approved scope if the first engine candidate fails.
4. Implement local summary versions and six meeting formats, source-grounded meeting/library Q&A, full-history retrieval, and optional explicitly enabled text AI providers.
5. Implement direct Google/Microsoft calendars, optional existing cloud sync with private ink/conflict/Trash extensions, encrypted archive restore, PDF/Markdown exports, and account isolation. Production migration and OAuth configuration need their own reviewed rollout.
6. Complete device/accessibility/Pencil/localization acceptance and reviewed TestFlight/App Store preparation. No source checkpoint implies release approval.

## Evidence

See [validation notes](docs/validation.md) for completed checks and remaining limits. The current installed Speech SDK was inspected for the exact APIs used here. Apple's [SpeechAnalyzer documentation](https://developer.apple.com/documentation/speech/speechanalyzer) and [sample](https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app) describe compatible audio conversion and streaming analysis; those documents do not prove this app's accuracy or speaker support.
