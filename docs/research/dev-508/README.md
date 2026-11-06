# DEV-508: recoverable capture boundaries

Research decision and synthetic prototype, October 17, 2026. [Notion DEV-508](https://app.notion.com/p/3fcf0f846ee481cb978de6d689803b34). Human acceptance: **pending Sean's review**. This is a report/fixture PR, not a production implementation or release.

## Decision

**Keep the current stop-on-renderer-reload/crash policy in production.** A main-owned, reattachable macOS capture session is a credible follow-up design, but the experiments below do not establish safe native renderer survival. Its release prerequisites are an independently available Stop control, capture/attempt ownership, bounded queues, persisted coverage/replay identity, and native host-death tests. Do not remove the existing `engine.stop()` calls based on this report.

The prototype demonstrates that an absent renderer need not own a synthetic capture, and that transcript replay can be idempotent while preserving manual edits. It does not prove AVFoundation, ScreenCaptureKit, CoreAudio taps, FluidAudio, Electron crash/reload behavior, hardware flushes, recognition accuracy, or power-loss durability. Granola is background inspiration only: no runtime comparison, superiority claim, or inferred renderer-survival guarantee is made.

## Source baseline and existing strengths

Source baseline: `main` at `b53c078685b00d901a321192e886574ff0c17701`, desktop 0.4.33. This branch began empty at inherited `43f4850`; it was rebased onto freshly fetched main with zero unique commits, excluding the parent's vault report. Only this research directory is changed.

The following are source observations, not new regressions attributed to this PR:

- [Main lifecycle and capture wiring](../../../apps/desktop/src/main/index.ts) deliberately stop capture on renderer loading/crash (lines 256–263); closing an active Mac window hides it. Main binds capture checkpoints and serves snapshots (lines 443–574), and quit disposes the engine before a normal-process hard exit (lines 749–765).
- [TranscriptSession](../../../apps/desktop/src/main/transcript-session.ts) already assembles and checkpoints text independently of panel visibility. It retains errors in snapshots, flushes tails on terminal events, and writes a separate session recovery JSON. [Capture checkpointing](../../../apps/desktop/src/main/capture-transcript-checkpoint.ts) preserves other meeting fields through a patch and does not recreate discarded/trashed meetings. These strengths must remain.
- [SegmentAssembler](../../../apps/desktop/src/main/segmenter.ts) already namespaces IDs per capture/batch part using a random session ID. That prevents cross-part collisions. A new assembler on replay would mint a different namespace: persistent replay IDs still require a mapping from source intervals to stable segment identity.
- [EngineProcess](../../../apps/desktop/src/main/engine-process.ts) keeps a warm `serve` sidecar, falls back to a per-session process, fences callbacks by child identity, restarts serve after crashes, and bounds Stop escalation (25 seconds serve / 20 seconds classic; teardown grace 4 seconds). Restarting a process currently ends its active session; it is not ASR checkpoint replay.
- [AudioService](../../../apps/desktop/src/main/audio-service.ts) retains multipart directories, excludes the active directory from orphan recovery, and retries failed orphan merges on later launches. Directory allocation uses a wall-clock timestamp, not a persisted capture identity. Its `audio` callback uses the active directory; timestamps/event presence must not substitute for verified ownership or coverage.
- [Native recorder](../../../engine/Sources/engine/AudioRecorder.swift) tees each source into approximately 30-second 16 kHz Float32 CAF chunks, records source epochs, and merges into AAC. Open CAF tails and orphan merging are valuable recovery mechanisms. Chunk discovery sorts existing filenames; unreadable chunks are skipped. Missing chunks are not a persisted interval map, so successful merge alone cannot prove an uninterrupted original timeline. Rotation is not a verified 30-second power-loss bound. The serial writer queue and [ChannelPipeline's AsyncStream](../../../engine/Sources/engine/LiveCommand.swift) have no explicit byte/count admission cap at these call sites.
- [LiveCommand](../../../engine/Sources/engine/LiveCommand.swift) installs an opt-in stdin EOF watchdog before starting the live session; it synchronously drops registered capture taps before requesting drain. The first-buffer watchdog retries the mic after 3 seconds and can fall back from a pinned device to the default. This is not a continuous per-source replay watermark. [ServeCommand](../../../engine/Sources/engine/ServeCommand.swift) drops taps on stdin EOF after model loading and awaits drain. This preserves host-death intent; it does not establish an OS-independent completion deadline when native work hangs.
- [MeetingFileStore](../../../packages/meetings-store/src/store.ts) writes a temporary JSON and renames it. There is no explicit file/directory fsync in that path. TranscriptSession's session JSON is a direct `writeFileSync`. Neither an engine/provider acknowledgement nor successful rename should be called power-loss durability.

Related active production work remains owned by DEV-504 [PR #222](https://github.com/Onyx-Dev-Labs/doodle-note/pull/222). Inspected `14efcc74595d14e1d9528e4a505e9b52be6ee859`: per-source saved-audio failure flags persist/OR-merge across Resume, writer reasons are sanitized, explicit stale capture IDs are rejected, and pre-start failures keep their attempt identity. Subsequently inspected `c1b7feb5c2d43d8210ce2f969d8ef89bc1d43eee`: pending meeting binding is separate; active meeting/base/snapshot ownership commits on `started`. Verification of that new production revision belongs to its lane. Neither revision is cherry-picked here.

The ownership hazard reported during this research is explicit: after empty capture A ends, binding B previously changed only the meeting metadata. B failing before `started` could expose A's snapshot/warning under B, and an empty `every()` check did not disprove ownership. The prototype exercises empty A → pending B → failed B → retried B, rejects an old attempt's start and A's terminal event, and never relabels A. Binding metadata is not a captured session, much less a durable one.

DEV-362's shipped Mac continuity/orphan work remains credited and closed. Mobile DEV-269 has its own physical interruption/storage qualification. Windows DEV-374/#201 and its DEV-336 auto-stop work remain separate; this report neither takes ownership nor closes their gates.

## Proposed state and identity contract

These are proposed production requirements; the deliberately small model implements only the subset identified below.

Use an immutable identity hierarchy: `libraryId / meetingId / attemptId / captureId / source / sourceEpoch / frameRange`. A start **attempt** reserves a destination and may fail before any capture exists. Only a matching accepted `started` transition creates a capture, binding its destination/base revision atomically. A pending attempt cannot mutate an old session's owner, warning, checkpoint callback or snapshot. Resume creates a new capture; it does not reuse old interval IDs. A renderer generation identifies a subscription, never a new capture. A worker generation fences asynchronous ASR results independently of a source/device epoch.

Stable segment IDs must survive retry, process restart, renderer replacement and transcript refinement. Persist the source interval-to-segment mapping before relying on replay deduplication. The fixture simplifies this to one fixed segment per one-second chunk, `capture-source-sequence`; device changes advance a generation but never reset the sequence. Real variable-length ASR segmentation needs an explicit replacement/revision transaction, not deduplication by text or timestamp. Production must validate provenance, sample format, byte length and checksums on recovery.

For each source maintain interval sets plus contiguous prefixes, not only a highest-seen offset:

| Position | Meaning | What does not advance it |
| --- | --- | --- |
| C: captured | Frames accepted from that source, in its sample clock; attach format/device epoch | Start requested, `ready`, silence inferred from wall time, another source's progress |
| A: retained audio committed | Verifiable source intervals plus manifest/identity saved under the chosen storage durability contract | A provider ack, buffer queued to a writer, CAF filename or successful merge by itself |
| T: transcribed | ASR output accepted for the exact capture, source interval and worker generation | Partial text, a stale callback, a failed decode, audio merely captured |
| D: transcript committed | Stable IDs/revisions and their provenance committed to local storage | Renderer display, T, queued writes, provider ack, a renamed file with an unknown durability boundary |

`T ⊆ C`, `A ⊆ C`, `D ⊆ T` by interval provenance. T can lead A when the audio writer fails; do not invent audio recovery. A can lead T during an ASR hang. Transcript text can cover only some intervals; a silence/no-speech result must itself carry coverage evidence if used to advance a processed prefix. A gap never becomes transcribed by moving a scalar watermark. A and D have different retention purposes: committing text does not authorize deleting original user audio.

Session transitions: `idle → pending attempt → starting capture → recording → stop requested → capture stopped → finalizing → ended`, with explicit failed/interrupted outcomes. Stop requested is neither capture stopped nor all files committed. An early start failure terminates only the matching attempt. Terminal events and checkpoint completions must match their immutable capture/meeting owner; restarting the ASR worker invalidates only its generation. Renderer reattach reads a versioned snapshot and subscribes after that revision, reconciling overlap once without triggering start or generation a second time.

Per-source health is independent: `starting → healthy`, then optionally `ASR stalled / replaying`, `device changing / unavailable`, `audio persistence failed`, `gap`, or `retry/capacity exhausted`. Record these as separate production dimensions: continuing transcript does not clear an audio failure; mic failure does not mean system failure; restoring a device does not erase historical gaps. The fixture has one diagnostic health string per source and separate coverage sets; it does not implement the full multidimensional UI state.

Manual changes are authoritative overlays by stable ID with an expected revision. Replay may fill absent machine rows but cannot overwrite an existing manual revision, note, speaker correction, deletion or Trash action. This fixture persists text corrections with compare-and-set revisions and rejects stale edits. It does not model rich notes, speaker/ink fields or tombstones; existing preservation tests and a future explicit schema contract remain necessary.

## Bounded retention, retry and shutdown

The fixture uses generated int16 PCM at 16 kHz, exactly 32,000 bytes/second/source, two sources, four pending chunks/source (256,000 bytes total), 32 records/source/session, at most two sessions and two worker generations. One decode is in flight, with a 200 ms deadline and at most two attempts/record. Consecutive failed commit attempts are limited to two. Maximum transcript text/correction is 256 characters/row. No timers retry forever. Session/record caps deliberately terminate this experiment; these are **not proposed recording-duration limits**.

At capacity, stop admission and preserve pending input rather than silently evicting it. A missing/short PCM file is reported as a gap; later audio keeps its original frame positions. The model drops committed disposable PCM only after the local commit call returns. Production must retain original audio under the user's existing policy; a separate replay cache can reclaim verified intervals only when both its audio/recovery and transcript requirements are met. Persist gap/error records before any intentional cache eviction. Longer production sessions need paged on-disk ledgers and bounded working sets, not these fixture arrays.

The 256 KB metric is a logical pending-audio bound, **not a bound on total process RSS**. Buffers are generated/read one at a time, worker IPC carries descriptors, and the test runner records its end-of-run memory usage. There is no native/ASR allocator, memory-pressure benchmark, or hard OS memory limit here. Journal serialization retains at most 128 rows across the fixture's two sessions. The model is single-threaded and trusts fixture inputs; it is not a production parser or concurrent storage implementation.

The proposed capture owner must expose Stop through a main-owned menu/tray/native surface that remains usable without the document renderer. Existing tray recording state should not be assumed to provide that independent Stop. A bounded escalation must first stop taps, preserve recoverable files, then time-bound ASR drain/finalization; it must not wait for ASR before releasing capture. On host death, an inherited pipe/OS lifetime mechanism must stop all capture children even while UI and inference are unavailable. Persistent hang, sleep/wake, shutdown and inherited-descriptor leaks require platform-specific testing. The synthetic host test uses stdin EOF and a separate stop command; no actual tray or device is exercised.

## Commit boundary experiment and recovery loss bounds

`atomicJSON` writes a temporary file, fsyncs it, renames it, fsyncs the directory, then returns. A real child is SIGKILLed at each marked boundary; a separate reader opens the resulting path. No in-memory committed counter is used to infer disk contents. A separate lost-ack experiment leaves one on-disk row with zero in-memory acknowledgements; replay reads that journal and commits exactly one row. Injected pre-rename EIO leaves the old journal byte-identical. A real ENOTDIR failure exercises an OS error without filling or altering a real volume.

| Kill boundary | Acknowledged | Rows reopened in this run | Interpretation |
| --- | --- | --- | --- |
| Temporary file fsynced, before rename | No | 0, previous journal intact | New row is not committed at the target name |
| Rename returned, before directory fsync | No | 1 | Process-crash visibility only; does not prove power-loss persistence |
| Directory fsync returned, before ack | No | 1 | Requested sync calls completed; lost ack must reconcile idempotently |

`fsync` and rename are distinct APIs ([Node filesystem documentation](https://nodejs.org/api/fs.html#fsfsyncsyncfd)); the fixture does not request Apple's `F_FULLFSYNC` or emulate storage-device cache loss. Apple's [disk-write guidance](https://developer.apple.com/documentation/xcode/reducing-disk-writes) also distinguishes flushing and best-effort persistence. No power-loss, filesystem-corruption, removable-volume or absolute crash-durability claim follows from these process-kill results.

Measured loss bounds are conditional:

- Synthetic ASR restart with all six retained chunks: **0 of 96,000 captured frames missing from committed transcript coverage**, six unique IDs, zero duplicate rows. This is checksum output, not speech recognition.
- Missing middle mic chunk: **16,000 frames / 1 second explicitly unavailable**; committed intervals are `[0,16000)` and `[32000,48000)`, contiguous prefix only 16,000. The gap is never compressed out of the model timeline.
- Capacity exhaustion: up to **64,000 frames / 4 seconds per source** await transcription, retained on disk in this run. Unadmitted future audio is not captured. Two exhausted storage attempts retain one 16,000-frame input with zero committed transcript frames. A retry is not claimed to recover unavailable storage.
- Writer kill before rename loses at most the one proposed row in this bounded experiment; after rename the row reopened here. This does not bound application-wide/native loss.
- **Host capture ledger recovery is not implemented**: the model's captured descriptors and gap list are in memory; PCM files are file-fsynced but their directory/identity ledger is not committed. The host-death experiment proves synthetic shutdown only. Uncommitted transcript reconstruction after full host loss, including discovering orphan PCM and persisting manual edits/gaps, remains a production prerequisite. There is no justified native loss bound from this prototype.

## Fault matrix and measured evidence

See [receipt.json](receipt.json) for emitted, transcribed, disk-reopened committed IDs, coverage, pending bytes and process timings. All source material is generated locally; no personal recording, model, profile, library or network endpoint is used by the fixture.

| Fault | Experiment type | Observable result |
| --- | --- | --- |
| ASR hang/restart | Real Node child ignores request; deadline; SIGKILL; new child computes PCM checksums | Six emitted IDs → six committed IDs, 0 gaps/duplicates; old-worker result rejected; two workers, maximum two attempts |
| Missing audio chunk | Actual generated file deletion; model replay | One explicit 1-second hole, two of three IDs committed, contiguous prefix does not cross hole |
| Disk write failure | Injected EIO before rename; real ENOTDIR; persistent failure budget | Old journal unchanged, no premature ack, manual edit retained; two failed writes then Stop/admission refusal |
| Lost commit acknowledgement | Actual file+directory sync; injected lost return | Disk row present with zero model ack; retry yields one row |
| Device change | State model only | Old source-generation callback rejected; sequence continues; other source generation unchanged |
| Stale terminal / empty prior session | State model only | B pre-start failure cannot expose A; A terminal cannot stop B; reused capture ID rejected |
| Renderer replacement | Subscription-generation model only | Same capture, two of two rows committed, duplicate start refused; independent model Stop remains callable |
| Host shutdown / Stop | Real host and synthetic capture grandchild; host SIGKILL vs explicit stop pipe | Both cease ticks, persist shutdown receipt and exit; measured latency in receipt, not a native SLA |
| Retention/retry exhaustion | State model with real PCM files | 256,000 pending bytes maximum; four chunks/source retained; two decode attempts; no silent eviction |
| Commit-process death | Real writer SIGKILL at three boundaries | Prior/new journal outcomes above; no power-loss simulation |

## Platform differences and production acceptance

Mac capture is in the Swift sidecar, so a renderer replacement could in principle reattach without moving audio ownership. Windows [win-capture.ts](../../../apps/desktop/src/renderer/src/lib/win-capture.ts) owns Chromium microphone/loopback streams and ships PCM to main; [win-audio-recorder.ts](../../../apps/desktop/src/main/win-audio-recorder.ts) tees rotating Float32 checkpoints and merges WAV. Keeping only the Windows ASR worker alive cannot preserve destroyed renderer media streams. A Windows survival feature would need a separately reviewed capture owner/process and permission/loopback lifecycle design. Do not port the Mac decision or declare parity from shared tests. DEV-374 remains its owner.

A separately scoped production proposal must be reviewed before implementation and demonstrate:

1. Pending attempt, active capture, meeting/library destination and base revision are immutable/fenced together; include empty A → failed B, Resume, stale `audio`/`done`/checkpoint completions, worker restart, deleted/trashed meetings and richer mobile fields. Integrate DEV-504's accepted ownership/failure contract rather than duplicating it.
2. Persisted per-source frame/format/epoch and segment provenance, explicit gaps and replay cursor; reopen after actual host/engine kills at every audio/manifest/transcript transaction boundary. Prove manual notes/corrections, speaker edits and tombstones win. Include lost ack, malformed/torn file, missing middle chunk and all-write failure.
3. Native queue byte limits and backpressure under prolonged ASR stalls, model warm-up and slow/unavailable disk; a user-visible overflow policy preserving source originals. Measure maximum RSS, queue latency, retry count, retained bytes and exact missing ranges during long recordings. Avoid a silent duration cutoff.
4. In a disposable native Mac candidate, crash/reload renderer while capturing independently controlled synthetic devices; verify independent keyboard/native Stop, truthful indicator, no extra capture, reattach without duplicate text, and explicit failure if reattachment expires. Test host SIGKILL, quit/update, sleep/wake, ASR deadlock, device removal and ScreenCaptureKit teardown. Include permission denial/revocation without automatic restart.
5. Choose and verify the storage failure model (process crash vs OS/power loss), including flush/barrier support, atomic metadata references and safe recovery on supported local/removable filesystems. Reject an unverified durability guarantee. Benchmark sync costs off the realtime path.
6. Human review/acceptance by Sean and configured CODEOWNERS, exact-source packaged Mac QA and rollback retaining all existing libraries/audio. Windows native acceptance is separate. No cloud fallback, external sends, model replacement or production policy changes belong to this research result.

## Reproduce and verification

From repository root, Node 22+ on macOS; no install is needed for the fixture:

```sh
DEV508_RECEIPT=/tmp/dev508-receipt.json node --test docs/research/dev-508/resilience.test.mjs
```

It creates only disposable `dev508-synthetic-*` OS temp directories, runs bounded children, and removes generated data. `DEV508_RECEIPT` is an optional explicit output path for the synthetic report. The committed receipt is one run, not a performance distribution. Directory fsync behavior is platform-specific; this is not a qualified Windows harness. The research command is manual and is not added to the production CI workflow.

Local environment: macOS 26.6.2 (25G83), Apple Silicon, Node 24.22.0, pnpm 10.33.2. A scoped frozen offline install reused 758 cached packages, downloaded zero, ignored native postinstall scripts and left the lockfile unchanged. No engine build or application install ran. When `/usr/bin/git` began requesting Xcode-license acceptance, the existing `/Library/Developer/CommandLineTools/usr/bin/git` was used; no license or developer selection changed.

Checks on this artifact and unchanged main source:

- Fixture: **12 passed, 0 failed/skipped**; syntax checks on all three `.mjs` files passed. The prototype has no production imports, so desktop typechecking does not typecheck its JavaScript; runtime assertions are its executable checks.
- Focused existing contracts: **23 passed** using `pnpm --filter desktop exec tsx --test src/main/transcript-session.test.ts src/main/capture-transcript-checkpoint.test.ts src/main/recording-start-coordinator.test.ts src/main/engine-process.test.ts`.
- `pnpm --filter desktop test`: **362 passed, 8 skipped, 0 failed** (370 total). Skips: six native Swift audio-import tests, one opt-in Whisper/model test, one Windows-only PCM recovery test. These are baseline checks, not verification of unmerged DEV-504 changes.
- `pnpm --filter desktop typecheck`: node and renderer typechecks passed. No native build required because no native source/harness changed. Staged `git diff --check` passed; report relative links and all 15 measurement records were checked.
- No failed test run occurred during this spike; expected fault assertions are not suite failures. Hosted CI/CodeQL and independent human acceptance are separate gates; see PR for current status.

Check this: run the single fixture command and inspect the missing-chunk receipt for 48,000 captured / 32,000 committed / 16,000 contiguous frames; inspect the ASR case for equal emitted/committed ID sets; inspect the storage case for retained input and unchanged manual revision; inspect the host-death receipt for `host-eof`. Accept those as synthetic evidence only. The remaining decision is human acceptance of this bounded report and separately scoped production criteria, not permission to ship renderer survival.
