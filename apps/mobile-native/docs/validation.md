# Native foundation validation

Date: 2026-09-06. Branch: `codex/mobile-native-foundation`; this continuation builds on foundation commit `df4cec8`. Changes are confined to `apps/mobile-native` and its dedicated CI workflow. Existing iOS source was not inspected or reused.

## Completed locally

| Check | Evidence |
| --- | --- |
| Fresh native build/launch | Built and launched on iPhone 17 Pro and iPad Pro 11-inch (M5) simulators, iOS 26.5, using Xcode 26.6 (17F113). |
| Unit and UI suite | iPhone: 18 tests passed, zero failures/skips, including opt-in Core ML inference. iPad: 17 regular tests passed plus the inference test passed separately. Unit cases use synthetic PCM, not microphone audio. |
| Note persistence | Typed text, language, a nonempty PencilKit drawing, transcript, and speaker annotations survive disk round trips. UI creates/edits a note, terminates the app, and checks the text after relaunch. |
| Recovery metadata | Previously recording notes become interrupted at startup, retaining associated audio. Corrupt/future-schema files remain unchanged while readable notes load. |
| Speech text updates | Overlapping provisional results are replaced; a repeated draft cannot overwrite finalized text for the same interval. No inferred speaker name is assigned. |
| Saved audio | A 12-second synthetic 16 kHz stream preserves all 192,000 source frames across three closed CAF chunks. Appends after finish are rejected. |
| Speech conversion | A two-second synthetic 48 kHz stereo stream preserves 96,000 source frames and produces a 16 kHz mono speech stream. The test exposed a converter tail left buffered at stop; an explicit end-of-stream drain fixed it. |
| Open audio recovery | A real nonzero stereo PCM fixture with an unknown data length and torn final frame recovers into a validated copy, preserving the original byte-for-byte and avoiding duplicate playback on repeated startup. Malformed input is reported and preserved. |
| Speaker pipeline | Exact pinned model compiled and processed synthetic silence with frame progression. Four-slot display, conservative overlap/coverage rules, session-scoped name corrections, hash-corruption rejection, and audio preservation on speaker queue overflow passed. |
| Built configuration | Inspected the built Info.plist: background audio is an array containing `audio`, version/build are present, and multiple scenes are disabled. |
| iPad layout | Inspected the XCTest screenshot showing separate ink and transcript panes and the PencilKit palette. Recording controls were moved above the editor to avoid the floating palette. |

Final full-suite result bundles on the local build host:

- iPad regular suite: `test_sim_2026-09-06T18-36-37-252Z_pid65562_e294bfd7.xcresult`
- iPad actual model: `test_sim_2026-09-06T18-40-36-286Z_pid65562_31f423df.xcresult`
- iPhone complete suite after final error-display changes: `test_sim_2026-09-06T18-41-11-482Z_pid65562_e7a3554a.xcresult`

Bundles are in the XcodeBuildMCP `Doodle-Note-194c8b9beb19/result-bundles` directory. The final iPad palette-layout check also passed: `test_sim_2026-09-06T18-02-27-886Z_pid58085_11916b15.xcresult`. These are local evidence, not repository CI artifacts. A dedicated `Native mobile` workflow now generates the project and runs simulator unit/UI tests on changes to this app. Its normal run skips only the opt-in model inference test. Remote CI status must be checked on the PR; local evidence does not imply remote success.

## Not established

- No physical device installation, microphone recording, human voice enrollment, or speech model download was performed during these checks. The simulator reports speech unavailable and keeps note editing usable.
- No real speech accuracy, diarization, saved speaker matching, language-quality, live latency, thermal, battery, or two-hour measurement exists yet.
- Pencil hardware behavior, Scribble, long-document performance, interruption/route changes, low-storage handling, and real process-kill/power-loss recovery need device tests. Synthetic recovery cannot recover unwritten audio or establish power-loss durability.
- No cloud/schema/OAuth/App Store configuration was changed. Calendar, sync, offline generation/Q&A, import/export/Trash, and translated UI remain accepted release requirements, not completed features.

This evidence supports review of the foundation only. It does not satisfy stage 1 of the full specification or authorize a release.
