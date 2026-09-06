# Native foundation validation

Date: 2026-09-06. Source base: `d624cfb` on a separate `codex/mobile-native-foundation` branch. All implementation changes are confined to `apps/mobile-native`. Existing iOS source was not inspected or reused.

## Completed locally

| Check | Evidence |
| --- | --- |
| Fresh native build/launch | Built and launched on iPhone 17 Pro and iPad Pro 11-inch (M5) simulators, iOS 26.5, using Xcode 26.6 (17F113). |
| Unit and UI suite | Seven tests passed with zero failures/skips on each simulator. Unit cases use synthetic PCM, not microphone audio. |
| Note persistence | Typed text, language, ink data, and transcript survive disk round trips. UI creates/edits a note, terminates the app, and checks the text after relaunch. |
| Recovery metadata | Previously recording notes become interrupted at startup, retaining associated audio. Corrupt/future-schema files remain unchanged while readable notes load. |
| Speech text updates | Overlapping provisional results are replaced; a repeated draft cannot overwrite finalized text for the same interval. No inferred speaker name is assigned. |
| Saved audio | A 12-second synthetic 16 kHz stream preserves all 192,000 source frames across three closed CAF chunks. Appends after finish are rejected. |
| Speech conversion | A two-second synthetic 48 kHz stereo stream preserves 96,000 source frames and produces a 16 kHz mono speech stream. The test exposed a converter tail left buffered at stop; an explicit end-of-stream drain fixed it. |
| Built configuration | Inspected the built Info.plist: background audio is an array containing `audio`, version/build are present, and multiple scenes are disabled. |
| iPad layout | Inspected the XCTest screenshot showing separate ink and transcript panes and the PencilKit palette. Recording controls were moved above the editor to avoid the floating palette. |

Final full-suite result bundles on the local build host:

- iPad: `test_sim_2026-09-06T17-59-54-221Z_pid58085_ddd87a48.xcresult`
- iPhone: `test_sim_2026-09-06T18-00-56-455Z_pid58085_434c836a.xcresult`

Bundles are in the XcodeBuildMCP `Doodle-Note-194c8b9beb19/result-bundles` directory. The final iPad palette-layout check also passed: `test_sim_2026-09-06T18-02-27-886Z_pid58085_11916b15.xcresult`. These are local evidence, not repository CI artifacts. The existing repository CI is not a native-mobile test gate; a dedicated native workflow remains to be added.

## Not established

- No physical device installation, microphone recording, human voice enrollment, or speech model download was performed during these checks. The simulator reports speech unavailable and keeps note editing usable.
- No real speech accuracy, diarization, saved speaker matching, language-quality, live latency, thermal, battery, or two-hour measurement exists yet.
- Pencil hardware behavior, nonempty drawing round-trip interaction, Scribble, long-document performance, interruption/route changes, low-storage handling, and crash-tail audio repair need device tests and further implementation.
- No cloud/schema/OAuth/App Store configuration was changed. Calendar, sync, offline generation/Q&A, import/export/Trash, and translated UI remain accepted release requirements, not completed features.

This evidence supports review of the foundation only. It does not satisfy stage 1 of the full specification or authorize a release.
