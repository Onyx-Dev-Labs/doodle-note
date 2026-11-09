# DEV-256 Windows refinement follow-up

Issue: https://app.notion.com/p/3e2f0f846ee481e590b0f1d9bbc8e584

This follow-up corrects reproduced control-flow defects. It does not establish the cause of the reported customer transcript or change the recognition model. Keep DEV-256 In Review until Windows accuracy and installed acceptance are complete. DEV-374 owns the separately approved Windows release and updater qualification.

## Findings and changes

- The batch worker emits both streaming and final-model results. Previously, an empty final-model result left the streaming text in the result map, allowing uppercase provisional text to masquerade as successful refinement. Finals now identify their quality. Missing final-model completion or empty final output over usable provisional text fails atomically and preserves the previous transcript.
- Audio finalization failure previously skipped refinement silently. The recorder now reports that the live transcript was retained. Raw recorder exceptions are not logged. Repeated Stop during refinement is ignored, and a late result cannot replace a disposed session.
- Windows ignored the existing `BatchOptions.channels` contract. Ordinary imports now mix file channels once and use the neutral `Speaker` identity. Saved DoodleNote split recordings explicitly retain microphone/system provenance, including a silent microphone slot in system-only recordings. No individual-speaker diarization is added.
- Model choice, capture permissions, saved-audio preference, cloud behavior, and macOS recognition are unchanged. No transcript is rewritten merely to change its casing.

## Automated evidence

Six initial regression cases failed against main before the fixes. Focused coverage includes empty/missing final results, atomic split-channel failure, normal casing and acronym preservation, final-only neutral identity, silence, system-only attribution, mixed stereo deduplication, multichannel input, audio-finalization fallback, and repeated Stop. These are synthetic transport/control-flow fixtures, not recognition-quality measurements.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter desktop test
pnpm --filter desktop typecheck
pnpm --filter desktop build
pnpm lint
pnpm audit --prod --audit-level=low
```

The Windows CI job builds an unpublished installer, runs the recorder and refinement regressions with packaged Electron, checks single-instance behavior, loads packaged native modules, and reports Authenticode state. Its downloadable artifact is tied to the exact CI revision. Packaging does not validate physical audio capture or model accuracy. No version bump or updater publication is part of this follow-up.

## Check this on Windows

Use a disposable Windows test profile and the candidate from this PR's passing Windows job. Preserve the production profile and recordings. Record the exact commit, Windows version, CPU/RAM, candidate installer hash/signature, model assets, capture mode, and elapsed processing time. Capture only sanitized status/timing evidence.

| Setup and action | Expected observable result |
| --- | --- |
| Independently captured mic/system call; speak distinct phrases on both sides, then Stop | Live captions remain available. Local refinement runs. Final wording retains source attribution, timing, and audio playback. Source channels do not claim individual remote identities. |
| Mic-only, system-only, combined; immediate Stop and repeated Stop while refining | Ending audio survives. Exactly one final completion occurs. Silent input produces no invented person or copied streaming success. |
| Ordinary mono, dual-mono stereo, and multichannel import | One mixed transcript uses `Speaker`, not `You`/`Them`; duplicate stereo is not transcribed twice, and content beyond the first two channels is not silently discarded. |
| Re-transcribe a saved split DoodleNote recording | Microphone/system mapping remains intact, including system-only audio. Successful replacement is atomic. |
| In a disposable profile, make the final model unavailable while keeping the live model cached, then record offline and Stop | The usable live transcript and any saved audio remain. A clear fallback is visible. Re-transcribe can retry once the model is available. No raw local path appears in the error. |
| Refine, close/reopen, Copy, export, generate notes, and sync | Corrected casing, acronyms, text, source labels, and seek anchors survive. Check each surface separately. |
| Repeated Resume, long recordings across 25-second windows, restart during finishing | No lost/duplicated segments, premature completion, or destructive replacement; recoverable saved audio remains usable. |
| Headset, loudspeaker/echo, and two people sharing one microphone | Compare saved audio to text. Shared microphone capture cannot identify individual people. Mic-only live labels still use the existing source defaults; acceptance for an explicit shared-microphone mode remains unresolved. |

For the existing packaged synthetic capture smoke, on Windows:

```text
node apps/desktop/scripts/smoke-windows-refinement.cjs <candidate-DoodleNote.exe> <cached-models-dir> <approved-synthetic-16k-mono.wav> <expected-phrase>
```

This requires the documented Playwright runtime and cached live/final models. It creates an isolated profile and is distinct from physical microphone QA.

## Remaining quality and release gates

Compare the shipped streaming baseline and candidate final model on the same authorized audio and audio-verified reference. Include two-person speech, numbers/names, varied pace/accents, short utterances and long-window boundaries. Record substitutions, deletions, insertions, sentence endings, processing time and memory. Agree a measured accuracy target before accepting the quality gate. Earlier model benchmarks in Notion are historical evidence, not fresh acceptance of this revision.

The customer's capture mode, whether the excerpt was live or final, original audio availability, actual installed executable, Windows tester/device, and new accuracy target remain unverified. Website 0.4.23 beta is the tracker-reported reproduction baseline. Do not infer missing words or speakers from the text alone.

Review and Windows physical QA precede approval to merge/release. No beta or production feed is changed. Recovery before release is to reject/revert this focused PR; any published rollback belongs to the separately approved DEV-374 delivery.
