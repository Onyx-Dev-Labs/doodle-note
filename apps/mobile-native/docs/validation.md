# Native foundation validation

Date: 2026-09-06. Branch: `codex/mobile-native-foundation`; this continuation builds on foundation commit `df4cec8`. Changes are confined to `apps/mobile-native`, its dedicated CI workflow, and root contributor pointers to the fresh app. Existing iOS source was not inspected or reused.

## Completed locally

| Check | Evidence |
| --- | --- |
| Fresh native build/launch | Built and launched on iPhone 17 Pro and iPad Pro 11-inch (M5) simulators, iOS 26.5, using Xcode 26.6 (17F113). |
| Unit and UI suite | iPhone and iPad: each passed 23 tests, zero failures/skips, including opt-in Core ML inference (21 unit tests and two UI tests). Unit cases use synthetic PCM, not microphone audio. |
| Note persistence | Typed text, language, a nonempty PencilKit drawing, transcript, and speaker annotations survive disk round trips. UI creates/edits a note, terminates the app, and checks the text after relaunch. |
| Recovery metadata | Previously recording notes become interrupted at startup, retaining associated audio. Corrupt/future-schema files remain unchanged while readable notes load. An injected recovery metadata write failure leaves the original bytes unchanged and still exposes the readable note, ink and transcript. |
| Speech text updates | Overlapping provisional results are replaced; a repeated draft cannot overwrite finalized text for the same interval. No inferred speaker name is assigned. |
| Saved audio | A 12-second synthetic 16 kHz stream preserves all 192,000 source frames across three closed CAF chunks. Appends after finish are rejected. |
| Speech conversion | A two-second synthetic 48 kHz stereo stream preserves 96,000 source frames and produces a 16 kHz mono speech stream. The test exposed a converter tail left buffered at stop; an explicit end-of-stream drain fixed it. |
| Open audio recovery | A real nonzero stereo PCM fixture with an unknown data length and torn final frame recovers into a validated copy, preserving the original byte-for-byte and avoiding duplicate playback on repeated startup. Malformed input is reported and preserved. |
| Speaker pipeline | Exact pinned model compiled and processed synthetic silence with frame progression. Four-slot display, conservative overlap/coverage rules, session-scoped name corrections, hash-corruption rejection, and audio preservation on speaker queue overflow passed. |
| Recording preparation | Suspended permission and language-probe tests verify playback is excluded throughout preparation and navigation cannot replace the recording language. |
| Speaker conversion | Persistent 16 kHz conversion preserves the source clock and waveform across 44.1/48 kHz input packet sizes. Independent left/right channel tests verify downmix includes both channels. End-of-stream filter padding does not extend the recording clock. |
| Built configuration | Inspected the built Info.plist: background audio is an array containing `audio`, version/build are present, and multiple scenes are disabled. |
| iPad layout | Inspected the XCTest screenshot showing separate ink and transcript panes and the PencilKit palette. Recording controls were moved above the editor to avoid the floating palette. |

Final full-suite result bundles on the local build host:

- iPad complete suite: `test_sim_2026-09-06T19-15-43-127Z_pid65562_e8c8baae.xcresult`
- iPhone complete suite: `test_sim_2026-09-06T19-19-09-519Z_pid65562_321678ba.xcresult`
- Stereo downmix regression first failed with silent right-channel output, then passed after explicit downmix; targeted green run: `test_sim_2026-09-06T19-15-34-747Z_pid65562_d0bd7c94.xcresult`

Bundles are in the XcodeBuildMCP `Doodle-Note-194c8b9beb19/result-bundles` directory. The final iPad palette-layout check also passed: `test_sim_2026-09-06T18-02-27-886Z_pid58085_11916b15.xcresult`. These are local evidence, not repository CI artifacts. A dedicated `Native mobile` workflow now generates the project and runs simulator unit/UI tests on changes to this app. Its normal run skips only the opt-in model inference test. Remote CI status must be checked on the PR; local evidence does not imply remote success.

## Not established

- No physical device installation, microphone recording, human voice enrollment, or speech model download was performed during these checks. The simulator reports speech unavailable and keeps note editing usable.
- No real speech accuracy, diarization, saved speaker matching, language-quality, live latency, thermal, battery, or two-hour measurement exists yet.
- Pencil hardware behavior, Scribble, long-document performance, interruption/route changes, low-storage handling, and real process-kill/power-loss recovery need device tests. Synthetic recovery cannot recover unwritten audio or establish power-loss durability.
- No cloud/schema/OAuth/App Store configuration was changed. Calendar, sync, offline generation/Q&A, import/export/Trash, and translated UI remain accepted release requirements, not completed features.

This evidence supports review of the foundation only. It does not satisfy stage 1 of the full specification or authorize a release.

## ONY-240 review handoff

Three read-only subagents reviewed capture/recovery, storage/speaker handling, and all roadmap dependencies. Findings were addressed on the existing branch and PR #124. Focused second passes reported no remaining blocking findings; this is agent review, not GitHub human approval.

Reproduce the suite with the README XcodeGen/xcodebuild commands. For the local model smoke test, pass `TEST_RUNNER_DOODLENOTE_SPEAKER_MODEL=/absolute/path/Sortformer_v2.1.mlpackage` to xcodebuild after obtaining and verifying the manifest-pinned model. Model execution uses synthetic silence and proves neither recognition nor attribution accuracy.

Check this:
1. Generate/open `DoodleNoteNative.xcodeproj`, select its scheme and an iOS 26 simulator. Create a note, type text, draw nonempty ink, return to the library, and reopen it. Expect both edits retained and usable compact/regular layouts.
2. With speech unavailable or no model installed, open a note and use its editor. Expect an explicit readiness explanation and fully usable local text/ink editing.
3. On supported physical hardware with microphone permission and saved audio, start recording and immediately navigate between notes. Expect playback disabled during preparation/capture, the chosen recording language retained, and recording controls visible above the Pencil palette. Physical hardware is unavailable for this check today.
4. Review the synthetic failure tests and preservation assertions for recovery metadata write failure, damaged audio originals and speaker queue overflow. Expect readable notes and saved source audio to remain available; a speaker failure must not claim the recording stopped.

Remaining gates: required human review/product QA and explicit merge approval. The disconnected external SSD contains earlier uncommitted recovery work; reconcile it non-destructively when available. The internal fixes do not claim that comparison occurred. Retain this workspace because the untracked roadmap and unavailable external work still need preservation. ONY-241 and ONY-242 require ONY-240 to land before implementation; the other feature issues inherit those dependency gates.
