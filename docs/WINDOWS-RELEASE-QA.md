# Windows release acceptance

The current delivery target is a Windows x64 beta. A working short transcript
does not establish production readiness. Keep ONY-231 open until the installed
candidate has passed the physical checks below.

## Automated recording smoke

Run recorder regressions with the actual Electron runtime:

```sh
node apps/desktop/scripts/test-electron-runtime.cjs apps/desktop/release/win-unpacked/DoodleNote.exe
```

For end-to-end capture, install Playwright 1.62.1 separately and set
`DOODLE_PLAYWRIGHT_MODULE` to its module directory if it is not resolvable.
Prepare a synthetic speech WAV and a model cache containing
`sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming`, `silero-vad` and
(for the import) `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`, the folders the
app creates under `asr-models`. Use only synthetic or explicitly approved
fixtures.

```sh
node apps/desktop/scripts/smoke-windows-refinement.cjs <packaged-exe> <models-directory> <synthetic.wav> <expected-phrase>
```

The script creates an isolated temporary profile, injects synthetic microphone
audio, and verifies live captions, model token confidences, casing and
punctuation, Stop, saved audio, playback data, session persistence and an audio
import (one neutral speaker). It also asserts that no post-stop refinement runs.
It terminates only its own application process tree. The source profile and
the user's installed app are not modified. The expected phrase is a flow check;
use the benchmark below for accuracy.

Two more packaged smokes use the same setup:

```sh
# Real recorder UI: a ~36 s utterance with no pause is transcribed completely
# across forced cuts, the saved transcript is in time order, and a forced
# engine backlog (DOODLENOTE_ASR_TEST_STALL_MS, a QA hook honoured only unpackaged or in a
# DOODLENOTE_CHANNEL=dev package, capped at 30 s; any dev-channel package honours it, and dev packages
# are QA builds with no update feed and no publish target, electron-builder.dev.yml) shows and
# then clears "Live captions are running behind on this PC".
node apps/desktop/scripts/smoke-windows-meeting-ui.cjs <packaged-exe> <models> <long.wav> "<phrase>|<phrase>"
# Model recovery: an updated profile with only the cached Zipformer records at
# once with an honest notice and gets a transcript while Parakeet downloads;
# a Parakeet model with damaged contents is verified and downloaded again.
node apps/desktop/scripts/smoke-windows-asr-recovery.cjs <packaged-exe> <models> <synthetic.wav>
```

`node apps/desktop/scripts/test-windows-asr-runtime.cjs <packaged-exe>` runs the
real first-run model download in an isolated profile (or copies
`DOODLE_WINDOWS_ASR_MODELS` when set), loads the packaged speech runtime and
checks the live model, its calibration and a finalized stream.

## Windows speech engine

Windows transcribes on the CPU with sherpa-onnx (`sherpa-onnx-node` 1.13.4,
bundled ONNX Runtime pinned by `windows-asr-runtime.ts`). Models download on
first use from the k2-fsa `asr-models` release, are verified by size and
SHA256, resume after an interrupted download (each worker kind has its own
partial file), are unpacked into a private staging folder and promoted with
one rename. Size checks run at every start; if a model fails to load, or a
previous load never finished (a damaged model can abort the native loader),
the engine hashes every file and downloads a damaged model again. Retrying
setup, or starting a recording, restarts an engine that died while loading.

- **Live captions** (both channels): Silero VAD detects speech; the pipeline
  forms utterances itself (end at a 0.5 s pause, hard cap 8 s) and NVIDIA
  Parakeet Unified 0.6b (the Mac's live model; int8 full-context export)
  decodes each one with real token timestamps and confidences; casing and
  punctuation come from the model. No audio is ever dropped: every sample from
  an utterance's start is kept until decoded. At the cap the utterance is cut
  at the quietest 100 ms of the last 3 s; the part after the cut is decoded
  from 1 s before it, and its words near the cut are aligned with the words
  the first part committed in its last 2 s (words heard the same way, within
  1 s of each other: compared without case or punctuation, with number words
  as digits and "OK" as "okay"; words of up to four letters must match
  exactly, longer ones may differ by a quarter of their letters, such as
  "Priya" and "Pria"; a split word such as "follow up" matches "follow-up").
  The alignment keeps the most matches and pays for every second-decode word
  it skips before a match, so it does not jump ahead to a repeated word. The
  part resumes after its last aligned word, also skipping words that start
  with (within 0.4 s) and mostly overlap a committed word left unaligned (the
  same word heard differently, such as "Siobhan" and "Shivon"); if nothing
  aligns it keeps the words after the last committed one, and after a cut in
  silence it keeps everything. This is a best effort: a word both decodes got
  wrong differently at shifted times can still be doubled or lost at a cut.
  Padding never reaches into audio already decoded. Silero's own buffer of the speech in progress is
  reset (at a cut) after 60 s of continuous detection, so hours of continuous
  audio such as music cannot grow it without limit. While someone speaks, the utterance in progress is
  re-decoded after 1 s and then each time it grows by half, up to the cut, so
  captions keep growing. First-run download: 502 MB.
- **Imports and Re-transcribe**: the same pipeline without interim captions
  (1 s pause, 30 s cap) using the Mac's batch setting and models: Parakeet TDT
  0.6b v2 (English, default, 482 MB on first import) or v3 (Multilingual,
  487 MB on first use). An import depends only on its own model, not on the
  live model. Settings -> Recording transcription offers exactly these two
  options on Windows; Whisper remains Mac-only. External stereo files are mixed
  once to a single neutral `Speaker`; only saved DoodleNote recordings keep
  microphone/system channels.
- **Updating from an earlier build**: earlier builds downloaded
  `sherpa-onnx-streaming-zipformer-en-2023-06-26` (live) and
  `sherpa-onnx-whisper-tiny.en` (post-stop refinement). If the Zipformer is
  cached and Parakeet Unified is not yet installed, live captions use the
  Zipformer, so an offline or slow-link user can record at once and gets a
  transcript; the recorder says "Transcribing with the previous speech model
  while the new one downloads". Parakeet downloads in the background (the
  worker is not closed as idle while it does) and is used from the next
  recording. If the download fails the notice says so, and it is retried,
  resuming its partial file, after each recording on the previous model.
  These folders are never deleted (about 0.6 GB); the tiny.en folder is no
  longer used at all.
- **No post-stop refinement**: like the Mac, the live transcript is final when
  Stop finishes. Saved Windows transcripts are put in time order at Stop, and
  the still-open segment's committed words are checkpointed (at most every 5 s)
  so a crash keeps them. A crash can still lose the words not yet committed:
  the utterance in progress (up to the 8 s cap) plus up to 2 s of mic words
  held for echo ordering, so about 10 s; the saved audio keeps them for
  Re-transcribe.
- **Echo**: mic timings are held until the system channel has committed the
  same stretch of time, so the segmenter can flag speaker echo even when the
  far side's longer utterance is decoded later. The hold is bounded to 2 s of
  wall time, so a stalled or ended system channel cannot keep mic text out of
  the transcript, and held words stay in the mic caption meanwhile.
- **Slow machines**: at startup the live engine decodes a fixed 4 s signal and
  measures its real-time factor. Above 0.2 (about twice this reference
  machine's cost) captions switch to utterance-only updates; committed text
  still follows each pause and all audio is still transcribed. Measured on
  Dev04 with the benchmark pinned to fewer logical CPUs: 4 logical CPUs gave
  calibration 0.107 and two-channel RTF 0.49 with interims (interim mode);
  2 logical CPUs gave calibration 0.201 (utterance mode) and RTF 0.70 even with
  interims, with the same 10.5% meeting WER. While recording, interim decodes
  are skipped whenever decoding used more than half of the last 10 s or a frame
  waited 1.5 s. While any channel's frames wait more than 5 s, the recorder
  shows "Live captions are running behind on this PC"; it stays at least 10 s,
  clears once every channel has been under 1 s for 5 s, and can appear again. After Stop the worker may
  finish queued speech as long as it keeps producing text (it is ended only
  after 15 s without progress).
- **Memory**: the loaded live worker uses about 765 MB while idle. After
  5 minutes without a recording it is closed; the next recording starts
  capture at once, buffers its audio (up to 2 minutes) while the model reloads
  (about 4.7 s to the first decode on Dev04) and loses nothing. A reload
  slower than that still records everything, but the audio past 2 minutes is
  given to the transcriber as silence (so later words keep their time in the
  saved audio) and is not transcribed live; Re-transcribe covers it. The reload
  reuses the first calibration and does not count as lag. If the reload fails
  (for example the model cannot be prepared) or the worker crashes while
  reloading, the recording ends at once with that error, and its audio is
  still merged and saved for Re-transcribe.
  `WinEngineHost.setKeepWarm` keeps the worker loaded for features that need
  instant starts.
- **Capture**: the renderer pumps microphone and loopback audio through an
  AudioWorklet (bundled as a same-origin script for the CSP), not the
  deprecated main-thread ScriptProcessorNode. On Stop each pump hands over its
  last partial frame before the engine finalizes. Microphone constraints are
  unchanged.

## Speech accuracy benchmark

`apps/desktop/scripts/asr-bench` measures models with the app's own pipeline
and sherpa addon. `manifest.json` pins every source (URL, size, SHA256) and
every prepared clip's SHA256; audio is downloaded on demand and never
committed. Fixtures are real human speech with trusted references:

- **read**: 60 CMU ARCTIC prompts from four speakers (US male, US female,
  Indian English, Scottish English).
- **meeting**: 35 AMI Meeting Corpus clips (Mix-Headset; ES2004a, IS1009a,
  EN2002a, TS3003a) — spontaneous, accented, far-from-ideal meeting speech,
  each a single speaker's manual transcript.
- **long**: the complete 30.3-minute AMI IS1009c meeting, plus its speaker-A
  headset as a second channel. Overlapping speech makes its WER an upper bound;
  it is mainly for stability, memory and timestamp drift.

WER uses one stated normalization, `dn-asr-v1` in `scoring.cjs`: case and
punctuation are ignored, numbers are spelled out on both sides, hesitations
(uh, um, mm-hmm...) are removed. Casing and punctuation are reported
separately. Prepare once (Python 3 standard library only), then run natively:

```sh
python3 -I apps/desktop/scripts/asr-bench/prepare-fixtures.py <cache>
# Windows (from apps/desktop): one configuration per process
node node_modules/tsx/dist/cli.mjs scripts/asr-bench/run-windows.ts --config pipeline-live:unified-offline \
  --models <models> --fixtures <cache>/prepared --channels 2 --out live.jsonl
# Mac (from the repository root): the Swift engine on the same fixtures
node apps/desktop/scripts/asr-bench/run-mac.cjs --engine engine/.build/release/engine \
  --fixtures <cache>/prepared --mode stream --out mac-live.jsonl
node apps/desktop/scripts/asr-bench/run-mac.cjs --engine engine/.build/release/engine \
  --fixtures <cache>/prepared --mode transcribe --model v2 --out mac-batch.jsonl
```

`--realtime` paces input like capture and records memory, lag and CPU every
30 s; `--sets long` adds timestamp drift against the AMI word times. The Mac
runner has not been run yet; its numbers are the parity check still to do.

### Results on ODL-WIN-Dev04 (November 6, 2026)

Intel Core i7-10700T (8 cores / 16 threads, 2.0 GHz base), 16 GB, Windows 11
Pro build 26300, Node 22.23.4, sherpa-onnx-node 1.13.4, int8 models on the CPU.
WER is corpus WER (errors / reference words) under `dn-asr-v1`. RTF is decode
seconds per audio second; "2 ch" is the total for two simultaneous channels.
Peak is the benchmark process's maximum resident memory.

| Model and path | Role | read WER | meeting WER | 30-min WER | RTF 1 ch | RTF 2 ch | Peak |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Zipformer streaming, 2 threads | previous live | 12.1% | 37.0% | 32.1% | 0.067 | 0.134 | 568 MB |
| Whisper tiny.en, 25 s windows, 2 threads | previous final/import | 7.7% | 19.1% | 23.0% | 0.074-0.088 | n/a | 744 MB |
| Parakeet Unified streaming 1120 ms, 4 threads | Mac's live export | 5.0% | 17.5% | not run | 0.97-1.29 | 1.78 | 888 MB |
| Parakeet Unified streaming 560 ms, 4 threads | Mac's live export | not run | 14.7% (12 clips) | not run | 3.03 | not run | 866 MB |
| **VAD + Parakeet Unified per utterance (8 s cap), 2 threads** | **new live** | **3.6%** | **10.1%** | **14.3%** | 0.29 | 0.47-0.49 | 1.96 GB |
| **VAD (1 s, 30 s cap) + Parakeet TDT v2, 4 threads** | **new import, English** | **5.2%** | **10.5%** | **15.1%** | 0.09 (long 0.10) | n/a | 1.82 GB |
| **VAD (1 s, 30 s cap) + Parakeet TDT v3, 4 threads** | **new import, multilingual** | **3.8%** | **10.7%** | **16.7%** | 0.09 (long 0.10) | n/a | 1.90 GB |

Earlier candidates (measured before the utterance-bound fix, so their
30-minute numbers are not comparable): VAD + TDT v2 for live 5.4% / 11.8%,
RTF 0.25 / 0.45; Parakeet CTC 110M 5.4% / 18.6%, two-channel RTF 0.12.
Unified streaming 240 ms was probed only (RTF about 6 on one 7.4 s clip).
Interim captions are included in live RTF (the clip runs ran 92-99% of
scheduled interims). The benchmark scores both the final text and the
token -> segment path users see; they were identical in every run. All
Parakeet paths produced casing and punctuation; the previous live path did not.

- Buffered streaming exports of Unified re-encode 5.6 s of left context every
  step, so on this CPU they cannot keep up with one channel and are less
  accurate on meetings than the same weights decoded per utterance.
- Live (Unified, per utterance) and batch (TDT v2) are within noise of each
  other (10.1% vs 10.5% meeting, 14.3% vs 15.1% on the 30-minute meeting), so
  Windows matches the Mac with no post-stop refinement. The previous tiny.en
  refinement took 133 s after Stop for the 30-minute meeting; Stop now waits
  only for the last utterance (median 0.35-0.40 s, maximum 0.9 s on clips).
- Utterance cap versus delay (30-minute meeting, live, words committed after
  they end; measured with single-word stitching): 8 s -> 14.6% WER, mean
  4.4 s, p90 7.1 s; 12 s -> 15.3%, 6.0 s, 10.4 s; 15 s -> 15.1%, 7.1 s,
  12.8 s, so live uses 8 s. With the final alignment-based stitching the 8 s
  cap gives 14.3% with the same delay (4.4 s, p90 7.05 s). Imports (30 s cap):
  TDT v2 15.1%, v3 16.7%.
- First text appears after a median 1.02 s (read) / 1.28 s (meeting) of audio,
  versus 1.02 / 1.54 s for Zipformer and 1.79 s for Unified streaming.
- Timestamps do not drift: against AMI word times the live median offset is
  +0.29 to +0.33 s in every 5-minute window of the 30-minute meeting (TDT
  batch: +0.03 to +0.07 s). The RNNT model emits words about 0.3 s late; the
  offset is constant.
- Before the utterance-bound fix, the pipeline lost speech in utterances
  longer than its buffer (reproduced: a 98 s headset utterance decoded as 40 s,
  63 s of speech never decoded in the live settings).

30-minute live session paced like capture in the Electron 44.10.0 runtime the
app ships (the AMI IS1009c mix and its speaker-A headset as two simultaneous
channels, Unified, 2 threads, shipped session options and caps):

- Kept up for the whole session: 1.05 logical CPUs busy on average (of 16),
  decode time 0.47 s per second of audio for both channels together. Queue
  lag stayed under 1 s in 56 of 61 samples (maximum 2.0 s; the warning needs
  5 s).
- Memory was flat: resident 983-1042 MB from the first to the last minute
  (peak 1.11 GB). Silero was reset 6 times across 127-172 s speech runs.
- WER 14.3% on the mix channel, identical to the unpaced run; 209 forced cuts,
  longest decode 9.0 s; timestamp offset constant (above).
- Committed words trailed speech by 4.4 s on average (p90 7.05 s). Captions in
  between come from interim decodes; under this load (both channels speaking
  continuously) the guard skipped 51% of scheduled interims.

Raw rows, logs and the exact commands are in the QA evidence for this change;
reproduce with the commands above.

## Physical acceptance

- Test both a built-in microphone and a USB/Bluetooth headset on supported
  Windows devices. Record exact OS, CPU, app version and microphone model.
- Say “The final confirmation number is seven four nine,” then immediately
  click Stop. Do not speak the testing instruction. Confirm the final transcript
  contains “final confirmation number” and the complete number.
- Record varied names, dates, numbers, pauses, accents and speaking speeds.
  Compare saved audio with the live captions and the saved transcript. Record word
  substitutions, omissions and additions; do not accept a model based on one
  successful sentence.
- Capture microphone only, system audio only, and both together. Verify labels,
  chronology, playback seeking and final words. Start a recording immediately
  after app launch to exercise startup recovery.
- Test a 30–60 minute meeting, Stop/Resume, several recording parts, microphone
  switching, sleep/wake, and disconnect/reconnect. Confirm no lost or duplicated
  speech, runaway memory, or indefinitely pending finalization.
- Verify fresh-profile model setup (502 MB), interrupted download and retry
  (the next attempt resumes), offline use after setup, the first import's
  482 MB TDT v2 download, and a multilingual import (487 MB v3 download).
- On a slower PC, confirm whether captions run in interim or utterance mode
  (the main process logs `[win-asr] ready ... calibrationRtf=... captionMode=...`
  at startup) and that no "running behind" warning appears in a normal
  two-person call.
- Reopen the app and confirm transcript persistence, re-transcription, notes,
  export and configured sync. Keep personal recordings out of issues and logs.
- Upgrade an existing beta through Settings: discovery, download, progress,
  cancellation, retry, explicit Restart to update and the resulting version.
  Interrupt the network during a download: after 90 seconds without new bytes,
  Settings should show a short error and offer Retry update.

## Install folder

Builds before this change installed per-user to `<UserProgramFiles>\desktop`
(normally `%LocalAppData%\Programs\desktop`): electron-builder names a one-click
per-user folder after the package (`desktop`). New installs go to
`<UserProgramFiles>\DoodleNote`. `apps/desktop/build/windows-installer.nsh`
moves an existing install on upgrade:

1. `customInit` redirects an install that would land in exactly
   `%LocalAppData%\Programs\desktop` (after normalising case, a trailing
   separator and short names) to the sibling `DoodleNote` folder. An install with
   `/D=<folder>` is left alone, and so is one recorded in any other folder named
   `desktop` (an earlier `/D=X\desktop`): it is upgraded in place, nothing is
   moved or deleted. It treats the old folder as an install to move only when the guards in
   `apps/desktop/build/windows-install-guards.nsh` prove it is one: exactly
   `%LocalAppData%\Programs\desktop` after normalising case, separators, `..`
   and short names; a real folder (not a junction, symbolic link or mount
   point) holding `DoodleNote.exe`; resolving (`GetFinalPathNameByHandle`) to
   that same place and not onto or into the new folder; the new folder, if it
   exists, a real folder too; neither overlapping the profile
   (`%APPDATA%\desktop`), compared both as written and resolved: every path in
   the comparison (old, new, profile) is resolved by handle, a missing one through
   its deepest existing parent, and equality or containment either way refuses
   (so a profile that is a junction into the old install, a `Roaming` folder that
   is one, or a `Programs` folder that is a junction into the profile all
   refuse). Every registered uninstall command must also be exactly the old (or
   new) folder's own uninstaller, `"<dir>\Uninstall DoodleNote.exe" /currentuser`
   with the whole exe path compared normalised (short names such as
   `C:\Users\LONGUS~1\...\UNINST~1.EXE`, expanded while the file exists, and
   case; a short name for an uninstaller that is gone cannot be expanded and
   counts as foreign); any other command could not be parked and
   electron-builder would run it before the new copy exists, so the install is
   upgraded in place and the journal is left alone (the one-click installer
   shows no details and keeps no install log: the reason is recorded as
   `LastReason` = `uninstall-command`, see "Where an install records what it
   decided" below; the exit code stays 0, as for any in-place upgrade). Anything
   else is upgraded in place, as before.
2. `customCheckAppRunning` closes copies running from exactly the old exe and
   exactly the new exe, each checked on its own, through `Win32_Process`
   executable paths (never electron-builder's path-prefix match, which also
   matched `Programs\DoodleNote QA`, or its `taskkill` by image name). It asks
   each to close, waits, then stops only the PIDs that still match. It closes
   only with consent: when the app started the update (`--updated`) or the user
   says OK. A silent install nobody asked the app for (`/S` without `--updated`)
   closes nothing: with the old app running it quits with exit code 2, exactly
   like an in-place upgrade whose app is running (installing the new copy beside
   it would leave the old app running, starting at login and holding the
   single-instance lock until it quit). It quits before anything is closed,
   parked, extracted or deleted: no file, folder, shortcut or process is touched.
   `customInit` has run by then, though, and may already have made these registry
   repairs, each also made by any other run: (a) journal and record values
   missing from `HKCU\Software\{APP_GUID}` written back from the recovery copy,
   which is then deleted (only after an earlier run stopped mid-update; see below);
   (b) the old folder's own uninstall command, parked by an earlier unfinished
   run, put back as `UninstallString` when nothing is registered and that
   uninstaller exists; (c) the `DesktopLink` / `StartMenuLink` answers of a journal
   that is not trusted deleted. Every CIM query has a 10 s
   timeout, the closer script a 25 s budget, and the installer runs it through a
   watchdog (`CreateProcess` + `WaitForSingleObject`, 30 s to find, 45 s to
   close, then the child is terminated), so a stalled WMI provider cannot hang
   the installer or uninstaller; a timeout counts as "cannot be established". If
   the old folder's app cannot be closed, or which processes are ours cannot be
   established (no PowerShell, a timeout, or an unreadable process with the same
   name), the new copy is installed and the old folder is kept for the next run.
   **The installer's closer still needs Windows PowerShell** (the app's record path
   does not since round 7). If PowerShell cannot start (removed, blocked by
   AppLocker / WDAC) or runs in ConstrainedLanguage mode (as an application-control
   policy imposes: the closer's `[Diagnostics.Stopwatch]` call is refused, exit 3),
   the answer is "unknown": the move does not happen, the old folder stays, and the
   old exe keeps starting at login from its Run value until a later run succeeds.
   That is the fail-safe direction and it is visible: the status key and the install
   log read `close / close-keep / unknown-process`. The harness proves both (a closer
   that names no PowerShell, and the real closer downgraded to ConstrainedLanguage
   first, with the old app really running; `d5b-missing`, `d5b-clm`). It
   then parks the old uninstall command in the journal
   `HKCU\Software\{APP_GUID}\InstallMigration` (the GUID derives from `appId`),
   so electron-builder's "uninstall old version" step does not delete the old
   folder before the new one exists. The journal records the identity
   (`APP_GUID`, the old and the new folder name) and both folders; a later run
   uses it, to finish an interrupted move or to put back the parked command
   for Apps & features, only when all of them match and the old folder still
   passes the checks above, and only puts back exactly the old folder's own
   uninstaller. electron-builder's uninstaller, which "uninstall old version"
   runs with `--updated` on every update once the uninstall entry names an
   installed copy, deletes `HKCU\Software\{APP_GUID}` with the journal and the
   `MigrationRecord` in it. Right before that step both are copied to
   `HKCU\Software\DoodleNote-InstallRecovery\{APP_GUID}` (outside the deleted
   subtree, still one per identity; `RecoveryFor` written last, so a copy cut
   short is ignored) and written back first thing in `customInstall`. If the
   installer stops in between (killed, extraction failed), the next run's
   `customInit` puts them back before anything reads them, after checking the
   copy: written for this identity, the journal complete (`Identity`, `SourceDir`,
   `DestDir`) and naming this identity and exactly `Programs\desktop` →
   `Programs\DoodleNote`, the record complete and naming those same two folders.
   Every journal value that is missing or empty is written (`Identity` last, so a
   journal cut short is incomplete and never trusted, and the next run fills in
   the rest); the record is one value, written whole. The copy is deleted only
   once every value in it reads back from the live keys exactly, and then
   `DoodleNote-InstallRecovery` itself if no other identity's copy is in it. A
   copy that fails its checks is left alone (and reported); a user uninstall
   deletes it. Every one of these writes can be cut short (the guard harness kills
   the installer right after each one) and the next run finishes the job. So a move kept by a held file stays armed for
   as many runs as it takes, and a record the app has not read yet survives
   another update, even an interrupted one (before this, an update interrupted
   before the first launch after a move lost the record, and with the old folder
   already gone the app never repointed its login item or MCP entries). A user
   uninstall (not `--updated`) deletes the copy with the rest.
3. `customInstall` verifies the new copy (exe, `app.asar`, uninstaller, and the
   uninstall entry pointing at it), then pins the old folder before checking it
   again (`dnPinLegacy`): it opens the old folder itself (never what a link there
   points to, `DELETE` access, no `FILE_SHARE_DELETE`, so nobody can rename or
   replace it) and, as they are now, `Programs`, the profile and the new folder;
   runs every check above; and checks the same facts again on those very handles:
   the pinned folder is a real folder, its final path is the pinned `Programs`'s
   final path plus `desktop`, it holds `DoodleNote.exe` (opened through that final
   path), and it is neither the profile nor the new folder nor overlaps them
   (final paths and volume serial + file index of the same handles). Only then
   does it remove exactly that pinned folder, never re-opening it by path: a
   `Programs` junction retargeted between the checks and the removal makes the
   path no longer open as the pinned folder, so removal stops ("unsafe") and the
   journal stays armed; and the walk never enters a folder whose identity is the
   profile's or the new folder's, however it was reached. It removes the old
   folder with a walk that deletes a junction or link but never what it points to
   (NSIS's own `RMDir /r` follows junctions, verified on Dev04) and deletes
   `DoodleNote.exe` last, so a folder that is only partly removed is still
   recognised next time. The walk is handle-based: each folder is held open
   (`FILE_FLAG_OPEN_REPARSE_POINT`, no `FILE_SHARE_DELETE`, so no other process
   can rename or replace it meanwhile), must still be the folder it opened (volume
   serial and file index) before it is listed, and each entry is opened without
   following links and must be that folder's own entry (its final path is the
   folder's plus its name) before it is deleted through that handle
   (`SetFileInformationByHandle`); a folder swapped for a junction between a check
   and its use is never entered. If any identity check fails, removal stops at
   once, the rest stays and the journal stays armed. Before the old version is touched, `customCheckAppRunning`
   records (in the journal, so an interrupted run's leftovers cannot change the
   answer) whether the user still had the old desktop and Start menu shortcuts;
   electron-builder recreates both for the new exe, and `customInstall` deletes
   again whichever the user had deleted. Every taskbar pin (`*.lnk` in
   `User Pinned\TaskBar`, any name) whose target is exactly the old exe is
   repointed to the new exe (its icon and working folder too where they named
   the old ones; arguments, description and AppUserModelID kept); no other
   shortcut is written and none is created. If the new copy is incomplete the
   old folder is kept.
   Only when the old folder is really gone does it write the record, one value
   `HKCU\Software\{APP_GUID}` `MigrationRecord` =
   `DNMR1|{APP_GUID}|desktop|DoodleNote|<old folder>|<new folder>|<UTC>|END`,
   read back, and only then clear the journal. A run that stops between the
   removal and the record leaves a complete journal whose old folder is gone; the
   next run (which then has nothing to move) writes the record and clears the
   journal after verifying the new copy (`LastStep` `install`, `LastReason`
   `journal-completed`).
4. Uninstalling the new copy (not an update's `--updated` run) while a move is
   unfinished also removes the old folder it left (same checks, same
   handle-based removal), since the uninstaller deletes the journal. Its app is
   closed only with consent: started from Apps & features (no `/S`), the
   uninstaller asks, as it does for the copy being uninstalled; with `/S` it
   closes nothing. (A one-click uninstaller switches itself to silent mode before
   the uninstall section runs, so this is decided in `customUnInit` from the
   command line; before, it never asked and never closed the old app.) If that
   app keeps running (the user said Cancel, or `/S`) or a file there is held, the
   old folder stays as a stale copy without an uninstall entry; the next install
   of the same identity finds it at the old default folder and moves it away.
   Meanwhile it would start at every sign-in from this identity's "Open at login"
   entry (`HKCU\...\CurrentVersion\Run`, value = the `appId`), so that entry is
   deleted, with its Task Manager state (`...\Explorer\StartupApproved\Run`),
   when it starts exactly the old exe or the exe being uninstalled (quoted path
   compared normalised, short names expanded); an entry that starts anything else
   is left alone. The log records it (`step=login-item`).

`apps/desktop/scripts/test-windows-installer-guards.cjs` compiles the guards
with electron-builder's makensis and runs them against real folders, junctions,
held files and real processes in a temporary sandbox (CI "Check Windows
installer migration guards"; 1188 cases before round 7, see the CI log for the
current count): the junction overlap cases above, a
second process swapping folders for junctions to an outside folder while the
old folder is removed (nothing outside is touched), a second process
retargeting the `Programs` junction onto the profile's parent or onto a decoy
install at a pause between the checks and the removal (a harness-only build,
`DN_TEST_PAUSE`; nothing anywhere is deleted and the journal stays armed, in an
update and in the uninstall clean-up; a control run without the retarget removes
the folder), short-name and foreign
uninstall commands, a file held across two runs with the uninstaller's key
deletion simulated each time and a third run finishing, the uninstall clean-up,
an installer killed right after the "uninstall old version" step (twice: once
mid-move, once on an update before the first launch) whose next run recovers the
journal and the record, the app's own record handling
(`scripts/consume-install-record.ts`) reading the recovered record, running and
clearing it, tampered or foreign recovery copies ignored, a closer that never
answers (`unknown` in about 4 s) and the silent quit-with-exit-code-2 case, the
recorded status of each outcome and the log (see "Where an install records what it
decided"), a user uninstall that keeps the old folder dropping only this
identity's login entry for it, and (a harness-only build, `DN_TEST_STEPS`, that
terminates right after a named registry write) an installer killed after each
write of the recovery, of the journal, of the recovery copy and between the
removal and the record, each finished by the next run, mismatching and tampered
copies kept, the empty recovery parent removed, and the app leaving an
incomplete or foreign record untouched. Round 7 adds: a record with any time
in `src/main/fixtures/install-record-times.json` judged as the app judges it,
a malformed live record replaced from a valid recovery copy and a save that
never copies one over it, the app recording `read-failed` (record untouched)
while its reader is unavailable and consuming it on the retry, and an
uninstaller built in electron-builder's hook order recording a `/S` uninstall of
the running app and a cancelled close prompt. Durability: each write a later
run depends on (the journal's `Identity`, the record, a complete recovery copy,
a restored record) is followed by `RegFlushKey` on HKCU, so it survives a power
loss right after it, not only a killed process; a power loss between two
writes leaves the incomplete states the checks above handle.

`appId`, the shortcut name and so the uninstall key are unchanged, so Start and
Apps & features keep a single entry. The profile, `%APPDATA%\desktop`, holds the
library location, settings and accounts; it is named after the app (package
name `desktop`), not the install folder, and is not moved. Keep the package name
and `appId` as they are unless a profile migration is written too. On the next
launch the app repoints the "Open at login" entry (keeping a Task Manager
disable) and MCP client configs (Claude Desktop, Claude Code, Codex) that
launched the old exe (`src/main/windows-install-migration.ts`). "Launched the old
exe" is decided with 8.3 short names expanded on both sides (`isInsideFolder`):
an MCP command or Run value the old app wrote while it was started through a
short path (`C:\Users\PATRIC~1\...\desktop\DoodleNote.exe`) still matches, since
the old folder's parent exists and expands; in the old folder's own place an
unexpanded alias of its name counts (`DESKTO~1` for `desktop-qa`; Windows' hashed
form after `~4` does not). The Run value is read as written, through the speech
worker's registry access, because Electron's own lookup compares plain strings;
the progress marker's exe is compared the same way. This happens only on the
installer's record: it must be complete and for this identity (version, the
identity's `APP_GUID` and both folder names, both folders, a UTC time of exactly
the shape `YYYY-MM-DDTHH:MM:SSZ` (ASCII digits; the installer's `dnRecordCheck`
requires the same shape, so a record one calls complete the other does too, and
recovery replaces a live record with a malformed time from a valid copy rather
than keep it; `src/main/fixtures/install-record-times.json` holds the cases both
are tested against), `END`),
its new folder must be the running exe's own folder, and the old exe must be
gone. A record that is there but not complete for this identity is left exactly
as it is (logged `install record left for the installer`) for a later installer
run to repair from its copy. When every step has succeeded the app deletes the
record. A copy of the exe started from any folder
that merely is named `DoodleNote` (a DPI capture, a portable copy) finds no
record naming its folder and changes nothing. The app reads, writes and deletes
these registry values through its speech worker (`src/main/windows-registry.ts`:
`RegGetValueW`, `RegSetKeyValueW`, `RegDeleteKeyValueW` through the FFI the worker
already loads), never through PowerShell or `reg.exe`: no child process, so an
execution policy or AppLocker rule for PowerShell cannot stop it, and the record's
folders read back exactly when the user folder is not ASCII (`reg.exe query`
prints the console's OEM code page: `Jörg Ñandú 李雷 😀` comes back as `J�rg �and� ?? ??`
under code page 437; `evidence/step5-fix-7/reg-unicode-probe.log`). The worker may
read any value under `HKCU\Software`, write only `AppMigration*` values in the
identity's status key, and delete only `MigrationRecord` in `Software\{APP_GUID}`.

What the app did is recorded beside the installer's values, in the same
`HKCU\Software\DoodleNote-InstallStatus\{APP_GUID}` key, and in
`%APPDATA%\<package>\install-migration-status.json`, at every launch that finds a
record or cannot read it (a launch with no record and nothing unfinished writes
nothing): `AppMigrationReason`, `AppMigrationLastAttempt` (UTC) and, last,
`AppMigration`:

| `AppMigration` | `AppMigrationReason` | Retried |
|---|---|---|
| `complete` | `repointed`; `record-not-cleared` (the next launch deletes the record) | no |
| `pending` | `steps-pending:<steps>` (`login-item`, `mcp-clients` or client ids that failed) | yes |
| `pending` | `record-incomplete`, `record-foreign`, `record-format`, `record-time` (left for the installer), `record-other-folder` (a copy started elsewhere), `old-exe-present` | no (next start) |
| `read-failed` | `reader-unavailable` (the speech worker could not start or ended first), `reader-timeout` (no answer in 60 s), `reader-unsupported` (the FFI did not load), `reader-<code>` | yes |
| `none` | `no-record`: an earlier `pending` / `read-failed` is over without a record | no |

"Retried": again after 1, 5 and 30 minutes in the same session; every start tries
once anyway. Nothing is repointed or cleared without a complete record. While the
state is `pending` or `read-failed`, Settings > Updates shows "Finishing the
Windows upgrade…" or "Couldn't finish the Windows upgrade" with the reason, and
says that Open at login and connected agents may still start DoodleNote from the
old folder, which the installer removed, until it finishes. Client configs are replaced atomically
(a temporary file in the same folder with the original's mode, then a rename;
a symbolic link is followed to the file the file system itself reaches,
`fs.realpathSync.native`, never by joining link texts lexically; a dangling link
to the name inside its folder's real path, where `writeFileSync` would create it;
where that cannot be determined, nothing is written), only when their content changes, and not at all if
the client rewrote the file in the meantime (the update starts over from the new
text).

Those rules, and the strict Codex reading (a `config.toml` the TOML 1.0 statement
scanner cannot read is refused and left unchanged; every definition of our server
is removed; a definition inside another inline table is refused), the JSON byte
order mark, an empty file read as none, a read error never treated as "no file",
and mode 0600 for a new file, apply **on Windows only**. macOS (every platform but
Windows) keeps the code of win/bark 9355b87 (`src/main/mcp-clients-logic-base.ts`,
pinned by SHA-256) with one change: the write is a temporary file renamed over
the config, in the file the base's `writeFileSync` wrote (the same resolution;
where it cannot be determined, or the place holds no file, the base's in-place
write). `src/main/agent-access-darwin.test.ts` compares a darwin service
with the base service, byte for byte, on Connect, Disconnect and the status, and
on 14 symbolic link topologies (a `..` after a folder link, dangling targets in
linked folders, chains, loops) requires both writers to change the same file and
nothing else.

### Where an install records what it decided

A one-click installer runs without a details page and writes no log of its own
(`SetDetailsPrint none`; `customInit` runs in `.onInit`), so every decision of
the move is recorded in two places, by the installer and by a user uninstall:

- `HKCU\Software\DoodleNote-InstallStatus\{APP_GUID}` (one per identity,
  outside `Software\{APP_GUID}`, which electron-builder's uninstaller deletes on
  every update): `LastRun` (UTC, ISO 8601), `LastStep`, `LastResult`,
  `LastReason`, overwritten at each decision, so after a run they say how it
  ended (or where it stopped). They stay after an uninstall on purpose.
- `%TEMP%\DoodleNote-install-<appId>.log` (`DoodleNote-install-com.doodlenote.desktop.qa.log`
  for QA): the same decisions, one line each, appended (UTF-16):
  `<UTC> installer version=<v> step=<step> result=<result> reason=<code> [from=<old folder>] [to=<new folder>]`.
  Past 64 KiB it is renamed to `<log>.1` (replacing an older one) and a new one
  starts. The only paths in it are the install folders; nothing about the
  profile, accounts or library.

| `LastStep` | `LastResult` | `LastReason` |
|---|---|---|
| `recover` | `recovered`, `recover-incomplete` (copy kept), `recovery-ignored` (nothing in the copy passed its checks; kept) | `restored`; the first reason the copy must stay: `journal-mismatch` / `record-mismatch` (a live value differs from the copy's after the write), `journal-incomplete`, `journal-identity`, `journal-folders`, `record-format`, `record-identity`, `record-time`, `record-folders`; `recovery-foreign` (another identity's) |
| `plan` | `plan-move` (the move starts) or `plan-in-place` | `legacy-found`, `journal-resumed`; `no-legacy` (already moved), `fresh-install`, `custom-dir` (`/D`), `not-default-folder`, `uninstall-command`, or the refusing check: `legacy-link`, `legacy-no-exe`, `legacy-missing`, `legacy-not-folder`, `legacy-resolves-elsewhere`, `dest-link`, `dest-open-failed`, `dirs-overlap`, `dirs-same`, `profile-overlap`, `profile-overlap-resolved`, `profile-invalid`, `resolve-failed`, `open-failed`, `path-invalid` |
| `close` | `close-ok`, `close-keep`, `exit-2`, `cancelled` | `none`, `closed`; `app-running`, `unknown-process`; `app-running-silent` (old app, `/S` without `--updated`), `app-running` (in-place); `user-cancelled` |
| `park` | `parked`, `refused-park` (exit code 2) | `parked`, `nothing-to-park`; `uninstall-command` |
| `remove` | `moved` or `kept` (journal stays armed) | `removed`; `app-running`, `unknown-process`, `file-in-use`, `identity-check`, or the refusing check: `pin-open-failed`, `pin-not-folder`, `pin-read-failed`, `pin-moved`, `pin-no-exe`, `pin-profile-overlap`, `pin-dest-read-failed`, `pin-dest-overlap`, any `legacy-*` / `dest-*` / `profile-*` code above |
| `record` | `moved` | `record-written`, `record-failed` (record did not read back; the journal stays, so the next run writes it) |
| `install` | `in-place`, `kept`, `moved` | the plan's code; `incomplete-install`; `journal-completed` (an earlier run removed the old folder but stopped before the record) |
| `uninstall` | `uninstalled`, `uninstalled-legacy-removed`, `uninstalled-legacy-kept` | `no-pending-move`, `removed`; `app-running`, `unknown-process`, `user-declined`, `file-in-use`, `identity-check`, or a `pin-*` / `legacy-*` code |
| `login-item` (log only; `uninstall` is written after it) | `login-item-removed`, `login-item-absent`, `login-item-kept` | `run-value-deleted`, `no-run-value`, `not-ours`; only after `uninstalled-legacy-kept` |

An uninstaller records its earliest exits too: electron-builder's `un.onInit` runs
the app-running check (`customCheckAppRunning`) before `customUnInit` and the
uninstall section, so the status destinations are set in that check. A `/S`
uninstall while the app runs from the install folder records `close` / `exit-2` /
`app-running` (`uninstaller step=close …` in the log) and exits with 2; a cancelled
close prompt records `close` / `cancelled` / `user-cancelled`. The one exit nothing
records is the one-click uninstaller's own "Are you sure?" box answered No: it
comes before any hook electron-builder offers. The guard harness checks both
recorded exits with an uninstaller built from `build/windows-installer.nsh` in
electron-builder's order (`scripts/test-windows-uninstaller-hooks.nsi`), and
`release-packaging.test.ts` pins that order in electron-builder 26.15.3's templates.

The log also has `note` lines that do not change the registry values
(`journal-ignored` with the reason the journal was not trusted:
`journal-foreign`, `journal-incomplete`, `journal-other-dest`, `journal-<check code>`). A run whose
`LastStep` is `plan`, `close` or `park` with no `exit-2` / `cancelled` stopped
before `customInstall`. The guard harness checks these values for every outcome
above, the line format, rotation, and that a log that cannot be written never
stops the run.

### Upgrade test: QA identity only

**Never run this procedure against the production identity in a real Windows
account.** A production build's installer, login item and MCP entries are the
owner's real ones. The test uses the QA identity, a build-time mode that changes
every identity-bearing name from the one entry in
`apps/desktop/src/shared/app-identities.json` (checked by
`src/main/app-identity.test.ts`):

| | Production | QA identity |
|---|---|---|
| `appId` (uninstall key, `APP_GUID`) | `com.doodlenote.desktop` | `com.doodlenote.desktop.qa` |
| Product name, exe, shortcuts | `DoodleNote`, `DoodleNote.exe` | `DoodleNote QA`, `DoodleNote QA.exe` |
| Package name, profile | `desktop`, `%APPDATA%\desktop` | `desktop-qa`, `%APPDATA%\desktop-qa` |
| Old / new install folder | `Programs\desktop` / `Programs\DoodleNote` | `Programs\desktop-qa` / `Programs\DoodleNote QA` |
| AppUserModelID and the "Open at login" Run value | `com.doodlenote.desktop` | `com.doodlenote.desktop.qa` |
| MCP entry in client configs | `doodle-note` | `doodle-note-qa` |
| MCP opt-in file and client configs | the real home directory and `%APPDATA%\Claude` | all of them in a sandbox in the profile (`%APPDATA%\desktop-qa\agent-access-home`: its own `.doodlenote\mcp.json`, `.claude.json`, `.codex\config.toml` and `AppData\Roaming\Claude`), like the dev channel; neither `%APPDATA%` nor an inherited `DOODLE_NOTE_MCP_CONFIG` is consulted |
| MCP server launch spec | `ELECTRON_RUN_AS_NODE` | also `DOODLE_NOTE_MCP_CONFIG` (the sandbox opt-in file, absolute) and `DOODLE_NOTE_MCP_IDENTITY=qa`; the server then reads only that file, only if it was written for `qa`, and never falls back to `~\.doodlenote\mcp.json` |
| Profile data at first launch | an older profile's meetings, folders, settings and chat are adopted | starts empty: the sibling `%APPDATA%\desktop` is the production profile and is never copied (meetings, settings with the encrypted cloud API key, chat) |
| Local AI models (meeting notes) | its profile's `models`, then `%APPDATA%\DoodleNote`, `%APPDATA%\desktop` and `%APPDATA%\DoodleNote Local` `models`, then `~\.cache\doodle-note\models` | only `%APPDATA%\desktop-qa\models`: download them in the QA build (or copy test models there); the production profile and the shared cache are never read |
| Default global dictation shortcuts (fresh profile) | toggle `Control+Alt+D`, paste last `Control+Alt+Shift+V`, copy last `Control+Alt+Shift+C` | toggle `Control+Alt+Shift+D`, paste last and copy last off: only one app can register a global shortcut, so production's keep working while QA runs |
| Migration journal | `HKCU\Software\f85f8dcf-...\InstallMigration` | `HKCU\Software\320d0756-...\InstallMigration` |
| Completed-move record (`MigrationRecord`) | `HKCU\Software\f85f8dcf-...` | `HKCU\Software\320d0756-...` |
| Update feed | (off on Windows until activation) | never: no `app-update.yml`, checks disabled |

`pnpm package:win:qa` builds it: the app code with `DOODLENOTE_QA_IDENTITY=1`
(electron-vite bakes in `__DOODLENOTE_IDENTITY__`) and the package with the
`electron-builder.qa.cjs` overlay, into `release-qa\`, unsigned (signing
variables are dropped). The packaged app refuses to start if its code identity
and its package name disagree, so a production bundle can never be packaged as
QA or the reverse. `node scripts/package-win-qa.cjs --legacy-layout` builds the
starting point: the same QA identity without the migration include, so it
installs to `Programs\desktop-qa` exactly like builds from before the rename
(output `release-qa-legacy\`). The Bark helper names its output-mute
coordination after the identity it is launched with (`DICTATION_HELPER_IDENTITY`
= the build's `appId`: `Local\DoodleNote-Bark-output-<appId>` and
`%TEMP%\DoodleNote-Bark-output-<appId>.json`), so production and QA no longer
share it.

CI proves the QA package is the production package apart from its identity
(`scripts/test-windows-package.cjs --same-files-as … --negative-control`, in
"Check the QA package ships exactly the production package's files"): every
app.asar entry, every app.asar.unpacked file and every other file of the two
`win-unpacked` folders is compared by SHA-256. Only these may differ, each only
in the stated way: `package.json` `"name"`; in `out/main/index.js` the identity
block and the helper digest (which must be the package's own); the exe's name
and, inside it, the version strings `FileDescription` / `InternalName` /
`ProductName` (each the package's product name) and Electron's ASAR integrity
record (the package's own app.asar header hash), with every byte outside the
resource section equal; the Bark helper's csc.exe time stamp and module version
id (also in its `<PrivateImplementationDetails>` class name, which must be the
file's own id); the helper manifest's `sha256` / `authenticodeSha256` (which must
describe that package's helper); and `resources\app-update.yml`, which exactly the
production package has. The negative control changes one byte in each kind of
file (including next to each allowance) and adds a feed file to the QA package,
and requires each to be reported exactly.

Production and QA can run at the same time, but they still share the Windows
session. While both run, **do not**:

- give QA production's global shortcuts. Windows gives a global shortcut to the
  first app that registers it; the second one's registration fails (Settings
  shows it as a conflict). A fresh QA profile defaults to `Control+Alt+Shift+D`
  with paste last / copy last off for that reason; do not change them to
  `Control+Alt+D`, `Control+Alt+Shift+V` or `Control+Alt+Shift+C`, and to test
  paste last / copy last pick keys production does not use.
- turn on Bark's hold key (or the hold mouse button) in both apps. Each app runs
  its own helper with its own low-level hooks, so one press starts both and both
  type the transcript into the focused field. Turn Bark on in QA only, or quit
  production for the Bark part of the pass.
- sign the QA build in to the owner's DoodleNote account (or any account that
  holds real data). QA's cloud sync would then read and write the owner's real
  meetings. Stay signed out, or use a disposable test account.
- copy anything from `%APPDATA%\desktop` into `%APPDATA%\desktop-qa` (meetings,
  settings, models): see step 1.

Steps (fresh Windows user state for the QA identity: no `Programs\desktop-qa`,
`Programs\DoodleNote QA`, `%APPDATA%\desktop-qa` or QA journal before starting):

Before step 1, check the QA identity's registry keys are clean. Unreleased QA
builds of this change (before the record became one value) wrote three values,
`MigratedFrom` / `MigratedTo` / `MigratedAt`, which today's installer and app
ignore as no record at all (so they would neither be repointed nor reported):

```
reg query "HKCU\Software\320d0756-c91c-52c4-9287-55a7f514978d" /s
reg query "HKCU\Software\DoodleNote-InstallRecovery\320d0756-c91c-52c4-9287-55a7f514978d" /s
reg query "HKCU\Software\DoodleNote-InstallStatus\320d0756-c91c-52c4-9287-55a7f514978d"
```

Each should answer "unable to find the specified registry key" on a machine that
never ran the QA build. On a QA machine that did, uninstall every QA copy first;
then, only for these QA keys (`320d0756-…` is the QA `APP_GUID`; never the
production `f85f8dcf-…` ones), `reg delete "<key>" /f` each that is still there.


1. Install `release-qa-legacy\DoodleNote QA-<version>-setup.exe`. The QA profile
   starts empty: seed it with test data only (import a test recording or create a
   few test meetings; never copy anything from `%APPDATA%\desktop`). It finds no
   local AI models until they are downloaded in the QA build (or test models are
   copied into `%APPDATA%\desktop-qa\models`): it never reads production's. Turn on Open
   at login, enable agent access and connect the three MCP clients (they are
   written in the sandbox above, never the real `~/.claude.json`,
   `%APPDATA%\Claude\claude_desktop_config.json` or `~/.codex`; check those
   real files are byte-for-byte unchanged). Record the
   QA Run value (`com.doodlenote.desktop.qa`) and confirm the production one, if
   any, is unchanged.
2. Run `release-qa\DoodleNote QA-<version>-setup.exe` (also with `/S --updated`).
   Check: `Programs\DoodleNote QA` exists and `Programs\desktop-qa` is gone; one
   "DoodleNote QA" entry in Apps & features whose uninstaller is in the new
   folder; Start menu and desktop shortcuts start the new exe (repeat once with
   the legacy Start menu shortcut deleted and once with the desktop one deleted:
   they stay deleted); a taskbar pin of the legacy app, also one renamed, starts
   the new exe and other pins are unchanged; the profile and
   library are unchanged; the QA Run value and the sandboxed client configs name
   the new exe (`install-migration.json` in the profile says `complete`); the QA
   journal key is gone; right after the installer and before the first launch
   `HKCU\Software\320d0756-...` holds `MigrationRecord`
   (`DNMR1|320d0756-...|desktop-qa|DoodleNote QA|...\desktop-qa|...\DoodleNote QA|<UTC>|END`),
   and after the first launch it is gone; `HKCU\Software\DoodleNote-InstallRecovery`
   does not exist (unless another identity's copy is in it); nothing of production
   changed (its folder, Run value, uninstall key and real MCP configs).
3. Repeat with the legacy QA app running (closed only after the OK prompt; with
   `/S` and no `--updated` the installer exits with code 2 and nothing changes),
   with a file in the old folder held open across two runs (the folder and its
   exe stay, the journal stays armed after each, a third run finishes), with
   `Programs\DoodleNote QA` replaced by a junction to `Programs\desktop-qa`
   before step 2 (nothing is moved or deleted; the install is upgraded in place),
   with the QA uninstall entry's `UninstallString` rewritten in 8.3 form (still
   moved; the parked command is put back verbatim if the run is cancelled), and
   by uninstalling `DoodleNote QA` from Apps & features while a move is pending
   (both folders are gone afterwards; with the legacy QA app running it asks
   first, and after Cancel the old folder stays but the QA Run value
   `com.doodlenote.desktop.qa` and its `StartupApproved` entry are gone, the
   production one untouched, and `LastResult` is `uninstalled-legacy-kept`).

### Installer end-to-end in CI (substitute for the desktop pass's installer items)

Smart App Control on the QA machine (ODL-WIN-Dev04) blocks every freshly compiled
unsigned executable, installers and uninstallers included (Code Integrity events
3033 / 3077). It is never bypassed, excluded or disabled. Until the owner decides
about it on the test machine, or the builds are signed, the installer items of the
desktop pass run on the throwaway GitHub Windows runner instead: CI job
`windows-installer-e2e` (`.github/workflows/ci.yml`), script
`apps/desktop/scripts/test-windows-installer-e2e.cjs`. It refuses to run without
`CI` (or `DOODLENOTE_E2E_THROWAWAY_MACHINE=1`), installs only the QA identity, and
stops only processes it started.

It builds the QA installer (`package-win-qa.cjs`), then from the same
`win-unpacked` (`--prepackaged`, stored rather than compressed to save time) the
legacy-layout QA installer and a kill-step QA installer
(`build/windows-installer-test-steps.nsh`: `DN_TEST_STEPS` plus a kill point,
`DN_TEST_STOP_AT=after-stock-uninstall`, in electron-builder's last hook before
`customInstall`; no release build includes it). Each step is timed in the job
summary and the artifact `installer-e2e-<sha>` (timings, the install log, the
final status key).

| Scenario | What it does | What it asserts |
|---|---|---|
| A basic | legacy `/S`; seed a Run value (8.3 path) and the three sandboxed MCP configs naming the old exe; current `/S --updated`; launch the installed app; uninstall `/S /currentuser` | after the install: old folder gone, new folder complete, exactly one QA uninstall entry naming the new folder, `MigrationRecord` complete (`DNMR1|<GUID>|desktop-qa|DoodleNote QA|<old>|<new>|<UTC>|END`), journal, recovery copy and its parent gone, status `record / moved / record-written`, log `plan-move legacy-found → close-ok → parked → recovered restored → remove moved removed → record moved record-written`, Start menu and desktop shortcuts start the new exe, the Run value still names the old exe; after the first launch: `AppMigration = complete / repointed`, record consumed, Run value and all three MCP entries repointed (Codex project table kept), `install-migration-status.json`; after the uninstall: folder, uninstall entry, `Software\{GUID}`, recovery keys and shortcuts gone, status `uninstall / uninstalled / no-pending-move`, profile, status key and `%TEMP%` log kept |
| B interrupted | legacy `/S`, seed; kill-step `/S --updated` stopped right after "uninstall old version" (exit 9); current `/S --updated`; launch; uninstall | after the kill: old folder kept, journal armed with the parked command, the new copy registered, no record; the next run's stock step runs the new copy's uninstaller (deleting `Software\{GUID}`), the recovery copy restores the journal (`recover / recovered / restored`) and the move finishes; then as A |
| C consent, held file | legacy `/S`; start the legacy app; current `/S` (no `--updated`); stop the app; hold a file in the old folder; current `/S --updated` twice; release; once more; uninstall | `/S` without `--updated`: exit 2, `close / exit-2 / app-running-silent`, app not closed, nothing moved; held: journal armed after each of two runs, `remove / kept / file-in-use`, one uninstall entry, no record; the third run completes as in A |

Covered by the job: the basic move (silent), the running-app and held-file
cases (silent), recovery after an interrupted update, the silent user uninstall,
the sandboxed MCP configs and Run value being repointed (including an 8.3 path),
and the record and status values: what a real installer, uninstaller and the
installed app do to the registry, folders, Run value, shortcuts and MCP configs.
Still needs a real desktop: taskbar pins (Explorer), DPI and multi-monitor
captures, notifications and the tray, every interactive prompt (the "close it?"
and "Are you sure?" boxes, Cancel paths, Apps & features), the junction-profile
and 8.3-uninstall-command cases on a real profile, elevated and
production-plus-QA runs, a non-ASCII account, and the packaged smoke (Bark, live
captions, the Settings rows).

## Automatic updates (off until activation)

Windows builds ship with automatic updates OFF. `updateAvailability` in
`apps/desktop/src/main/update-policy.ts` reports Windows as unsupported unless
the build was made with `DOODLENOTE_WINDOWS_UPDATES=on`, which electron-vite
bakes into the main bundle (`__DOODLENOTE_WINDOWS_UPDATES__`). Off means no
launch check, no 6-hour check and no manual check (Settings shows "Automatic
updates are not on for Windows yet"); nothing on an installed PC can turn it
on. macOS is unaffected. Neither CI nor `package:win` sets the variable, and a
test fails if either does.

The rest of the updater is already wired the same way as on the Mac:
electron-updater with the shared generic `publish` feed
(`https://www.doodlenote.ai/updates`, single-range requests), the NSIS target
writes `latest.yml` and a `.blockmap` (differential downloads, like the Mac
ZIP), and the packaged app carries `resources/app-update.yml`. On Windows the
policy reads the `beta` channel (`beta.yml`) without downgrades. The live
`beta.yml` (0.4.37) and stale `latest.yml` (0.3.4) are older than this build, so
nothing an existing 0.4.x tester receives changes until a new manifest is
published, and CI only uploads its manifest as a workflow artifact.

To activate, in one release change:

1. Require a valid signature first (Artifact Signing, below, including
   `publisherName`); never publish an unsigned build to a feed.
2. Choose the channel: keep `beta` for testers, or change `applyUpdatePolicy`
   to the default channel (`latest.yml`) for production.
3. Build the release with `DOODLENOTE_WINDOWS_UPDATES=on` (for example in
   `release:win`) and update the "default to off" test so CI still builds off.
4. Publish with `pnpm release:win` (signature gate, `latest.yml`) or
   `publish:win-beta` (`beta.yml`). Installed builds from before activation never
   check, so their users install the first activated build by hand.

## Code signing (Microsoft Artifact Signing)

Signing for Onyx Dev Labs LLC uses Microsoft Artifact Signing (formerly Trusted
Signing) through SignTool and the Artifact Signing dlib
(`Microsoft.ArtifactSigning.Client` 1.0.151 from nuget.org, pinned by SHA-256 in
CI, running on .NET 10). `apps/desktop/scripts/sign-windows.cjs` is
electron-builder's `win.signtoolOptions.sign` hook (SHA-256 only, `signExts`
adds `.dll` and `.node`), so it signs the app exe, Electron's DLLs, the unpacked
native modules (sherpa/ONNX, llama, Koffi), the installer and the uninstaller;
files that already carry a valid vendor signature (Microsoft's
`d3dcompiler_47.dll`, `dxil.dll`) keep it. electron-builder never offers
single-file `extraResources` to its signer, so `package:win` signs
`engine\.build\windows\dictation-helper.exe` itself right after building it.
Anything that records the helper's signature must run after that step. The
order is helper build, helper signing, `write-dictation-helper-manifest.cjs`
(win/bark: the signing-invariant Authenticode digest, and for a signed helper
the signer's exact CN and certificate thumbprint, which electron-vite bakes into
the app), electron-vite, electron-builder; pinned by `helper-integrity.test.ts`
and `dictation-platform.test.ts`. `pnpm package:win:qa` runs the same order
(unsigned).

A PFX supplied the electron-builder way (`CSC_LINK` / `WIN_CSC_LINK`) is refused
with an error: the helper step never receives electron-builder's certificate,
so the helper would ship unsigned while everything else was signed. This is
deliberate and also applies to an otherwise unsigned build: with `CSC_LINK` or
`WIN_CSC_LINK` set anywhere in the environment (a shell profile, a CI variable
left from the old PFX setup), `pnpm package:win` fails at the helper-signing
step instead of building; unset them. `pnpm package:win:qa` drops them, so a QA
build is unaffected. SignTool is
pinned: `SIGNTOOL_PATH`, else Windows SDK `10.0.26100.0`'s x64 `signtool.exe`
(never "the newest one found"), and before first use the script checks that it
is validly Authenticode-signed by Microsoft (`CN=Microsoft Corporation` or
`CN=Microsoft Windows`, `O=Microsoft Corporation`), that its version resource's
`OriginalFilename` is `signtool.exe` (case-insensitive; any other
Microsoft-signed binary, `ping.exe` say, is refused) and that it is at least
10.0.22621.755 (the dlib's minimum). Dev04 has no Windows SDK, so the exact
signer subject of SDK 10.0.26100.0's SignTool (`CN=Microsoft Corporation` is
expected) has not been seen natively yet: confirm it on the first
`windows-sign.yml` run, or on any machine with the SDK, with
`Get-AuthenticodeSignature` before relying on the check.

Where signing runs: never in PR or branch CI. The `windows-package` job in
`ci.yml` runs PR-controlled scripts, so it references no secrets at all and
always builds unsigned (`signing skipped: no credentials`); if an installer it
built ever carried a signature, it runs the full verification below anyway.
Signed builds come only from `.github/workflows/windows-sign.yml`, started by
hand on `main` or a `v*` tag, in the GitHub Environment `windows-signing`. It
rebuilds from the approved commit, signs, runs the package check and
`scripts/verify-windows-signature.ps1` (installer, helper and every shipped
`.exe`, `.dll` and `.node` validly signed; the same check gates `release:win`),
and uploads the artifact. It publishes nothing. Before anything else it checks
that the commit is on `main` (`git merge-base --is-ancestor $GITHUB_SHA
origin/main`, full history fetched): the environment matches a `v*` tag by name
only, so without this a tag pushed onto any commit would be signable.

**Create the environment with its protection rules before adding any secret**
(Settings > Environments > New environment `windows-signing`): required
reviewers (the owner), "Prevent self-review" if available, deployment branches
and tags limited to `main` and `v*`, and no admin bypass. Also restrict who can
create release tags (Settings > Rules > Rulesets > New tag ruleset: target
`v*`, restrict creations, updates and deletions, bypass list = release
maintainers only), so a `v*` tag cannot be created by anyone with push access.
Only then add the
secrets to that environment (never as repository secrets, which any workflow
could reference): `ARTIFACT_SIGNING_ENDPOINT` (for example
`https://eus.codesigning.azure.net`, matching the account's region),
`ARTIFACT_SIGNING_ACCOUNT`, `ARTIFACT_SIGNING_PROFILE`, and an Entra app
registration with the Artifact Signing Certificate Profile Signer role:
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. A partial set
fails the build.

**Preferred credential once the Azure app registration exists: OIDC, no stored
secret.** Add a federated credential to the app registration for GitHub Actions
with subject `repo:Onyx-Dev-Labs/doodle-note:environment:windows-signing` and
audience `api://AzureADTokenExchange`, so only jobs running in the protected
environment can obtain a token. The signing job then gets `permissions:
id-token: write`, requests a GitHub OIDC token for that audience, writes it to a
file under `$RUNNER_TEMP` and passes `AZURE_FEDERATED_TOKEN_FILE` (with
`AZURE_TENANT_ID` and `AZURE_CLIENT_ID`) instead of `AZURE_CLIENT_SECRET`.
`sign-windows.cjs` accepts exactly one of the two (both set is an error), and
tells the dlib's `DefaultAzureCredential` to try only the configured one
(`WorkloadIdentityCredential` for the token file, `EnvironmentCredential` for
the secret); the Azure CLI's session, managed identity, Visual Studio and
browser logins stay excluded. GitHub's OIDC tokens are short-lived and SignTool
runs once per file, so on the first OIDC run confirm the token lasts for the
whole signing step (refresh the file before the packaging step if needed). The
workflow change (`id-token: write`, the token step, dropping the secret) is made
together with the app registration; until then the secret path above is what
`windows-sign.yml` uses. The old `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD`
repository secrets are no longer read by any workflow and should be deleted if
they exist.

When the account is approved: create the environment as above, add the six
secrets, run the workflow on `main` and confirm it signs and verifies, set
`win.signtoolOptions.publisherName` to the certificate's subject CN
(electron-updater then refuses an update installer signed by anyone else), and
only then consider activating updates (above). Local plumbing checks can use
`DOODLENOTE_SIGN_TEST_CERT_SHA1` with a temporary CurrentUser\My certificate
(refused when `CI` is set); delete it from CurrentUser\My and CurrentUser\CA
afterwards. Such a build is not trusted by Code Integrity.

## High DPI and multiple monitors

All window geometry is in DIPs and follows the display: caption-button insets
come from the `titlebar-area-*` environment variables, the dictation pill and
the meeting prompt are placed inside the work area of the display they are on,
and the notification-area icons carry 16, 20, 24, 32, 40 and 48 px images.
The main window opens on the display under the pointer, sized to fit its work
area (1080p at 200% leaves about 960x500 DIPs, less than the 1180x760 default
and the 560 DIP minimum height). After a move, a scale change or a removed
display it is left alone whenever it is fully visible, including a window
deliberately spanning two monitors and larger than either; it is brought back
only when less than half of it is on any work area, and shrunk only when the
display under its center became smaller (another display, or a higher scale)
and the window is larger than the combined work areas it overlaps. macOS keeps
its own window handling. The pill is placed again whenever scaling changes or a
display is added or removed.

`capture-windows-dpi.cjs` must run a copy of the app from a folder that is not
an installed identity's folder; the app never repoints a login item or MCP
client configs unless the installer recorded a move into the folder it runs
from, so a copied exe cannot change them.

`apps/desktop/scripts/capture-windows-dpi.cjs <DoodleNote.exe> <out-dir>
--profiles <isolated-profiles-dir>` launches the packaged app with
`--force-device-scale-factor` 1.25, 1.5 and 2, each with a fresh profile,
captures Home, Settings and (when Bark is enabled in that profile) the pill
with their native caption buttons, and fails if the window exceeds the work
area. It opens visible windows. The notification-area icon and its menu are
drawn by the shell at the system scale, so check them by changing the display
scale in Windows Settings or on a second monitor with another scale.

## Production gate

### Installer follow-up in 0.4.23

The two-launch regression reproduced two independent app/updater owners in
0.4.22. Windows now claims one instance per profile and routes another launch
to the existing app. The regression script is
`apps/desktop/scripts/test-single-instance.cjs <packaged-exe>` and uses the same
external Playwright module setting as the capture smoke above.

The updater now displays an installing state, dismisses its ready notification
when installation starts, and permits another attempt when the handoff reports
an error. Local `updates.log` in the app profile records lifecycle events,
process IDs and version numbers, with rotation at 512 KiB. It does not record
transcripts, audio, URLs, error messages or credentials.

These changes do not yet establish the cause of the reported NSIS Retry/Cancel
dialog. Verify the actual installed upgrade and retain the exact dialog text
plus update lifecycle log if it recurs. The 0.4.22-to-0.4.23 upgrade still runs
the 0.4.22 updater; the new handoff behavior applies to subsequent updates.

Outstanding production acceptance: code signing, first-attempt installed
upgrades, varied physical microphones/system audio, long meetings, device
interruptions, and fresh-machine model setup. Notes-generation speed is a
follow-up unless generation fails or prevents normal app use.

Record candidate commit, installer hash, observed checks, skipped environments
and remaining failures. Require a valid Windows Authenticode signature before
production publication through `release:win`. An unsigned beta is suitable for
authorized testing only; do not promote it by replacing `latest.yml`.

Earlier builds used Whisper tiny.en for a post-stop refinement pass, which
misrecognized a synthetic access-code digit. Current builds use the Parakeet
models above with no refinement pass; the benchmark above replaces one-sentence
acceptance, but physical microphones and real calls still need the checks in
this document.

## Bark (dictation) on Windows

Bark is ported to Windows (off by default; Settings → Bark). Speech uses the shared
Parakeet worker with a mic-only, raw dictation capture; a small C# helper (built with
the inbox .NET Framework 4.8 compiler and shipped as `resources/engine/dictation-helper.exe`)
watches the hold-to-talk key and types the text. Delivery is clipboard + Ctrl+V with the
clipboard restored (privacy markers preserved; a newer copy made during delivery is never
overwritten).

Typing fallback: it is available in classic Windows text boxes only (the Win32 Edit and
RichEdit controls, such as Notepad, WordPad and classic dialogs). The class is decided from its
name alone (an exact list; an unknown name only when RealGetWindowClass names a listed class), and
no message is sent to a window before it is accepted. So a RichEdit superclass with its own name is
refused, and so is RichEdit20A (its lengths can count bytes under a DBCS locale). There, each key is confirmed
before the next one: the field's own text length must move by exactly that key, and the field is
checked for the password style before every key. Browsers, Electron apps, WebView2/CEF, Firefox,
Java, Qt, XAML/UWP and Office are reachable only through UI Automation, whose state lags the
app, so they get no typing fallback. Paste is the only way in, and when a paste cannot be
confirmed the text is kept on the recovery card for copying. Settings → Bark → Permissions says
the same.

Line breaks in the typing fallback:
- An Edit gets a Unicode CR, never a Return key, so no dialog or form can press its default button.
- A plain Win32 Edit without ES_WANTRETURN does not take a line break in a dialog. Text with a line
  break is refused there before any key is sent.
- A RichEdit needs a real Return key. A dialog turns a Return key it is not asked for into OK
  (IsDialogMessage sends IDOK even without a default button), and a WinForms form into its
  AcceptButton (managed code; the button need not have BS_DEFPUSHBUTTON). So it is sent only when the
  box itself has ES_WANTRETURN. Otherwise the text is refused up front ("This box doesn't accept
  Enter from dictation"), with nothing sent. This includes Windows 11 Notepad (RichEditD2DPT, no
  ES_WANTRETURN): there a dictation with a line break goes in by paste, never by typing.

Every key is checked just before it is sent: focus, password style, password character and
read-only. Nothing can be proved about changes the app makes after the key has been queued.

Paste follows the same order: the provider's focus and password reads, the classic box's
EM_GETPASSWORDCHAR and the wait for held modifiers come first; foreground, focused window, password
and read-only styles and the clipboard's ownership are checked last, immediately before Ctrl+V,
with nothing that can block in between. The same limit applies: checks are sampled, a change
between two samples or after Ctrl+V is queued cannot be seen, and a cross-process check and the
input it guards are never one atomic step.

Clipboard: the helper writes to the clipboard only over a save that is POSITIVELY established (round 20-21,
below); otherwise it does not touch the clipboard at all, and the text is typed (classic text boxes) or kept for
copying. A copy the user makes while we save is never overwritten. How long the save takes is bounded by a slow
owner's render, not by us. Our own write (open, empty, set,
close; round 33: clipboard operations only, no journal: see the journal below) runs on its own thread; the paste waits
for it at most 1 s. Past that (an owner that answered the WM_NULL probe and then stalls in WM_DESTROYCLIPBOARD; until
round 32 also a journal on a slow disk) the paste gives up (typing may still run), while the write thread itself goes on for as long as its
step takes. Round 31: a write whose abandonment is observed at the check right before its EmptyClipboard does not
empty the clipboard at all (nothing to put back: "untouched"); one abandoned later, while EmptyClipboard waits, still
empties and rolls back. (The check is a point in the write's own sequence, not a scheduling guarantee.) Otherwise, when it ends, the late path puts the user's content back (never pastes ours); if another
app changed the clipboard meanwhile (added a format, replaced a text form, copied its own content), its change stays
and the saved content is kept as an offer, until the user's Restore. The app is told either way and updates the
warning it showed. Round 30: the log says where the write was when the 1 s ran out and when it ended (opened,
emptied, set, closed, each with its time; until round 32 also its journal steps), never a guessed cause; round 31: the user's Restore logs its own timeline the same way (lock taken, state read, liveness checked,
payload read, decrypted, opened, looked, emptied, put back, closed, settled, files deleted; round 33: the close before
every file step). The timelines
locate time in steps: a "journaled" step is the whole journal call (serializing the state, the file operations, the
flush, the replace), not the disk's flush alone.

In CI the late path has its own end-to-end cases, forced by test-build gates under the real 1 s budget (before
emptying; after our write closed; and a change before the late confirmation, checked byte for byte and by sequence);
every other case runs with a 60 s budget so its outcome is the path it tests, whatever the runner's speed. **The gap,
stated plainly:** that longer budget means those cases would not notice an ordinary write getting slower. Two checks
stand in for it: every ordinary write of the run (its timeline) must stay within gross bounds (median under 500 ms,
none over 5 s; a failure), and a canary runs ten ordinary writes under the real budget: their outcome is checked (an
"untouched" late result with the clipboard's bytes and sequence unchanged is a correct outcome), their median must
stay at or under 300 ms (round 32: a failure), and a single write over budget or over 500 ms raises a CI warning, not a
failure (a slow runner window can take one write past 1 s, as attempt 1 of run 42842819157 did). A regression that
moves single writes but not the median shows only as that warning.

Each paste is a clipboard transaction with a record: the saved clipboard (DPAPI-encrypted for the
user, with whether the save was complete, the transaction's random nonce and the dictated text's
SHA-256) and a plain journal of its stage in %TEMP% under the app identity (record files are matched
exactly: identity X never reads X-foo's, and a dev and a production identity never see each other's
records or offers).

**The journal (round 33, an owner-decision item: the journal moved out of the paste's budget; the owner may veto).**
Two state writes are LOAD-BEARING and durable (flushed to the disk, and published only while the record is not settled
or given up): the first state and "settled". The offer-only and unrestored facts of a live record are flushed too
(round 34, stated as the code does it: they are what a later look reports about the record, and flushing them costs
nothing on the paste, they are queued after the close), but nothing depends on them: no record read from disk grants
authority (round 18). Every other write is a DIAGNOSTIC (no flush). No stage is a proof of anything, and a sequence number on disk never grants a write (since round 18; the
confirmed sequence lives in the live transaction): recovery decides by CONTENT, except that "settled" is deleted on
sight and ONE narrowly scoped equality proof, below (1b), permits a deletion (never a write).

| Write | When | Durable | Inside a clipboard open | In the paste's 1 s | If it fails |
|---|---|---|---|---|---|
| the first state, "emptying" ("may be emptied", with the save's capture sequence and window station), then the encrypted payload | Begin, before any EmptyClipboard of ours | yes (both) | no | no (Begin waits about 2 s at most: a sliced wait that also checks the delivery's deadline; round 35: its answer takes no lock that is ever held across a file or clipboard operation, and does no file work: the writer cleans up) | not established: no paste, nothing emptied ("no-record", or "deadline"); the writer removes what it had published |
| emptied / written (our write), restore-emptied (a restore or the write's own rollback) | after the clipboard is closed, queued to one serialized background writer | no | never | no | nothing changes (logged) |
| offer-only and unrestored facts of a live record (a keep, a failed restore) | the same writer, after the close | yes (flushed; informational) | never | no | nothing changes (logged); the record still leaves in-flight |
| the user's Restore: settled, or recovering-emptied when its put-back failed | after its put-back, once the clipboard is closed | settled: yes | never | (not a paste) | settled: logged, the record deleted anyway |
| settled (a live transaction restored) | on the background writer, before the record is deleted; it stays in flight until then | yes | never | no | logged, deleted anyway |

**Which records are proofs.** The payload on disk is the precondition of our EmptyClipboard (Begin waits for it, about
2 s at most, outside the 1 s write budget, which now measures clipboard operations only): the user's content is never off the
clipboard without being on disk (until round 32 a paste went ahead after 250 ms). The first state is "emptying"; there
is no "saved" stage any more, and the old rule that deleted a non-offer "saved" record as "nothing had been emptied" is
gone. **The proof that no new loss window opens:** a record is deleted without the user only when (1) its saved
content is exactly, completely on the clipboard (the content-equality proof, a whole save only), (1b, rounds 34-35) its
first state still says "emptying" and a COMPLETE look at the clipboard (an incomplete enumeration proves nothing)
shows the save's capture sequence, in the same logon, boot and WINDOW STATION (sequence numbers are per window station
and one session can have several; the state names the capture's station, and a state without it, as round 33-34 wrote
them, gets no such proof): unchanged since the capture, since our EmptyClipboard would have moved it; used only to
delete, never to write; it covers an INCOMPLETE save, whose content proof cannot hold. One case it does not see, and
why it costs nothing: if a delayed-render owner exits with formats it never rendered without moving the sequence (CI
case 53 reports what the CI runner's Windows build does: Windows Server 2025, 10.0.26100, where the sequence MOVED
from 7765 to 7766 when such an owner exited, so there the proof does not apply; other builds are not observed), the proof can delete a record while that unrendered content has gone,
but those bytes were never in our payload (a save holds only what renders), so the deletion loses nothing we held, (2) it is "settled" (its restore ran), (3) its payload
is positively absent, damaged or unrecoverable, or (4) a retention or boot-limit policy ends it. A crash before our
EmptyClipboard therefore leaves a record deleted by (1b) or (1) at the next start, or, if the user copied something
meanwhile, a SPURIOUS OFFER (nothing lost; Dismiss deletes it). An unchanged clipboard does not ALWAYS allow the
deletion: in another logon or boot (1b does not apply) with a live foreign owner whose formats cannot be read without
rendering, an unreadable format, an incomplete save, or an originally empty save, the content proof fails and the
record stays an OFFER; for an incomplete one the card says the clipboard may still hold all of it (Dismiss keeps it as
it is; Restore would put back only the saved part). A crash after the EmptyClipboard, before any further
journal, leaves "emptying" on disk: the clipboard does not hold the saved content, so it is offered (the old
stage rule would have deleted it: the CI mutation check proves the case catches that).

**The crash windows.**

| Crash between | On disk | At the next start |
|---|---|---|
| the save and Begin's durable writes | nothing, or a lone .state.tmp (swept after 10 minutes) | nothing offered; the clipboard was not touched |
| Begin's state and its payload's rename | "emptying" + a partial or complete payload .tmp (or none) | a complete .bin.tmp is adopted, then judged as below; a partial one is no usable payload: the state is deleted; nothing was emptied |
| Begin's writes and our EmptyClipboard | "emptying" + payload | unchanged since the capture: deleted (1b); the saved content still there: deleted (1); the user copied: a spurious offer; an incomplete, empty or unreadable save in another logon or boot: an offer |
| our EmptyClipboard and its close | "emptying" + payload | offered (the clipboard does not hold the saved content) |
| our close and the queued "written" | "emptying" (or "written") + payload | offered, never restored on its own (round 18) |
| a restore's put-back and its queued "settled" (wider since round 33: the close and the queue are in it) | the last diagnostic stage + payload | the saved content back exactly: deleted (1); else offered again: a spurious offer, never a loss |
| "settled" and the deletion | "settled" | deleted on sight |

A stalled journal never holds the clipboard open (no journal call runs inside an open) and never holds up a
delivery: only Begin's durable writes are waited for, about 2 s at most (round 34: in slices that also check the
delivery's own deadline, and given up by a compare-and-swap, never by waiting on the lock the writer holds across its
renames, nor the recovery lock: CI case 50 stalls each rename, case 52 a recovery retry inside the recovery lock;
round 36: neither does a privacy-marked, memory-only transaction's settlement, CI case 54), and the delivery's own
deadline is checked again right after them. The delivery's own kept-records check BEFORE Begin takes the recovery lock
and does file and clipboard work, which cannot be bounded in place (until round 35 its wait was therefore UNBOUNDED;
the deadline check after it only prevented a late paste). Round 36: it runs on its own thread, and the delivery waits
for it only while its deadline allows and at most 5 s; not done by then, the paste is refused ("own-busy" since round 39, or
"deadline") with nothing emptied, and the check finishes on its own (it never writes the clipboard: CI case 55) (a paste that no longer fits empties nothing).
Round 37 caveat (Opus, Astra P2), as round 36 shipped it: a check its delivery gave up on still ran once it got the
lock, and a LATER delivery could be writing by then; it, like the 30-minute retention check (pre-existing), opens the
clipboard with the helper's SAME window, which takes a running write's open over (the write fails, the record is kept
as an offer: a spurious offer, not a loss); and every delivery during one stall started another check, so waiting
checks accumulated without a bound. Round 37 fix: recovery never opens the clipboard while a delivery is in flight.
Every automatic look (a delivery's check, a retry, the retention check) holds a look lock from before it reads the
in-flight set to its close, and skips ("a delivery is in flight: no clipboard look now"; kept, checked again later)
when a delivery is in flight; a delivery, once its record is in flight, waits for a look already inside (at most 1 s;
past it, "own-busy" since round 39, nothing emptied). There is ONE delivery check at a time, shared: a delivery joins the
outstanding check while it still waits for the lock, or waits (within its own allowance) for a running one before
starting the next; a check that no delivery waits for any more does nothing once it gets the lock, and stops between
records (CI case 56: three deliveries during one stall, one check thread; case 57: the retention check during a held
write). Round 38 (Opus, Astra P2): the delivery's wait for a look already inside stops once its allowance is gone
("deadline", nothing emptied); stated exactly (round 39, Astra P3): it polls in slices of up to 50 ms plus scheduling
delay, so it can end about that much after the allowance (CI 58a allows under 900 ms for a 400 ms allowance), and it
is the deadline check right after the wait, before the write, that keeps a paste that no longer fits from writing (CI
case 58b: the delivery's own deadline expired right after the wait, the production predicate refuses; its mutant,
the check removed, is caught: it writes). The late-write wait (below) polls the same way.
Round 38, option (b) of the two offered for the late write (refuse while it is outstanding, not a process-wide open
lock): a late rollback is SEVERAL opens (its confirmation, then its put-back) with our late text on the clipboard in
between, so a lock around each open would still let a delivery save our own text as the user's in a gap; refusing
for the whole late transaction closes that too, and is a counter check with no lock order (it cannot deadlock).
(Opus, round 38: the save itself runs in the READER process, which a process-wide lock in this one would not cover
at all.) Stated exactly (Astra, round 38): the write's count goes up right AFTER its thread starts (LateBegin follows
thread.Start), so it is not literally up before the write's first open; that is safe because until the write is
abandoned the request that started it still owns the request queue (no delivery or Restore can start), and its record
is already in flight (no automatic look opens the clipboard). The queued steps run before the helper exits, inside
its usual exit wait; past it, a record left behind is judged by content at the next start. The background writer
serializes every write (one queue, in order) on immutable snapshots, and a record settled meanwhile is never written
again, so an older queued write can never overwrite the settlement or recreate a deleted state. Every state write goes
through its .tmp and is renamed over the state in one call: MoveFileEx in the same directory with REPLACE_EXISTING (plus
WRITE_THROUGH when durable), which the API documents as a single replacement, with no "~RF" temporary; a process kill
leaves either the old state (and the .tmp) or the new one (CI case 51 kills around that rename; a rename cannot be
stopped half-way, so a kill INSIDE it is exercised by timing, not by construction). That is not a proof of power-loss
safety: same-volume rename durability rests on NTFS's metadata log, which is flushed lazily; a power loss can lose an
unflushed diagnostic (a zero-filled state is rebuilt as an offer), and a power loss right after an EmptyClipboard could
undo the first state's rename, leaving the payload without its state (swept after 10 minutes): a power-loss window,
not a process-kill one. From round 10 (commit 033a56cd, which replaced a delete-then-move with the same kill window:
a kill between its delete and its move left a record without its state) to round 32 the state was
replaced with File.Replace, which first moves the old state aside to a "~RF....TMP" temporary: CI found such files left
by helpers killed during a journal write, and a kill between its steps could leave a record without its state (its
payload then swept as an orphan after 10 minutes). That window existed only in unreleased Windows builds: no user was
exposed. Leftovers of the old way (a state copy, no user content) are deleted only when nothing can still be replacing
through them (rounds 34-35): only while NO other helper process runs at all (any identity, any pid: the copies name
the helper that wrote a state, not one that may be replacing it, and an open handle is no protection), older than 10
minutes, naming this session and a helper proven not running, and the record's own state, if present, naming one too;
anything unknown is kept (round 36: a process whose name cannot be read for any reason other than having exited counts
as running). The helper's own clipboard reader has the same image name, so it blocks the sweep while it is alive: the
sweep effectively runs at the helper's start, or whenever no reader is running. A leftover whose record has no state is not rescued (a state copy cannot be told current;
this concerns unreleased builds only): it is swept like the others. The CI check that no journal write runs inside a
clipboard open is LOGGING (an ERROR line every state write makes on a thread that holds an open), scanned by the CI
run: it shows that no state write ran on such a thread in that run, not a guarantee enforced by the code. The crash
cases kill only after the asynchronous "written" step is logged (so that a kill does not land mid-write by accident);
case 51 is the one that kills during it.

Every record carries its logon identity: the
window-station session, the logon session (LUID), Windows' boot counter, the tick count and a per-logon
random key in a volatile registry value (HKCU\Software\DoodleNote.Bark.Session). Volatile means it is
removed when the user's hive is unloaded (logoff, reboot); the LUID covers a new logon while the hive
stayed loaded, and the boot counter a new boot. A key of that name found as a normal (persistent) key
is replaced by a volatile one. The wall clock is not used. Another session or boot is "different";
a key created after the record (deleted by a cleaner, or replaced), another LUID in the same session
(an elevated helper) or anything missing is "unknown", never a reason to delete.

Policy (round 18, an owner decision; a deliberate, conservative behaviour change). Automatic restore authority
NEVER comes from disk. The only automatic write-back of the user's clipboard is the one made by the live,
in-memory transaction that wrote the dictated text, in the helper process that wrote it (its restore after the
paste, or after a failed paste), and only while the clipboard is provably still its write: it was confirmed under
the clipboard lock and still has our window as owner at the confirmed sequence, or it still holds exactly our
write (every format compared byte for byte) within the sequence allowance below. Our window owning the clipboard
is never proof by itself. Every record that the recovery machinery reads back from disk is OFFERED, unconditionally.
That covers a record after a helper crash, kill or restart, on a retry tick, on a sweep, after an adoption or a
rebuild, after a failed or interrupted restore, and from another boot, logon or session. Nothing read from disk is
ever WRITTEN to the clipboard without the user's Restore. Records are not offered, but left or deleted, only as
the deletion contract below lists: another session's record is left alone; deleted without writing anything are a
record whose saved content is already exactly on the clipboard (a whole save), one journaled "settled", one whose
payload is positively absent, damaged or unrecoverable, and those the retention and boot-limit policies end (round
33: no longer one "that never emptied anything" by its stage: see the journal above). What the user sees: after a helper crash or kill mid-dictation the saved clipboard
is offered on the card ("Put back what you had copied before?") instead of being put back silently. The user's
Restore and Dismiss are unchanged.

What "restored" means (stated exactly; unchanged since round 17): EmptyClipboard and every SetClipboardData for the
saved formats returned success under our own open, and then we closed it (CloseClipboard's result is logged, not
used: a failed close does not change the answer). It is not a later observation of the
clipboard: no instantaneous check can guarantee what the clipboard holds afterwards (round 18 tried one after the
close and reverted it in round 19; see the PR). Every put-back writes one log line with the native result and error
of EmptyClipboard, each SetClipboardData and CloseClipboard, the sequence around it and the format count after the
close (no content; neither count nor sequence needs an open, but the log line itself is a synchronous write).

The save (rounds 20-21; the cause of the one loss of the user's clipboard CI ever showed, ESTABLISHED). The reader
process used to open the clipboard with a NULL window. CI 34 shows on the runner's Windows build that another
process's OpenClipboard(NULL) then SUCCEEDS while the reader holds it, and the reader's own EnumClipboardFormats
fails with ERROR_CLIPBOARD_NOT_OPEN (1418): the listing came back empty while Windows counted 5 formats, and that
empty save let our write destroy the only copy (round 19, CI 25(a)). Caught in round 20 as "listed 0, counted 5,
enumeration error 1418" before a retry. With its own window the reader keeps its open: the other OpenClipboard
fails with access denied. So: the reader opens with its own message-only window and proves before trusting any
result, and before it closes, that it still has the clipboard open; a lost hold is a failed capture. A save is
ESTABLISHED only when its listing ended with no error, listed exactly as many formats as CountClipboardFormats
counted in the reader's own open, named every registered format, and the sequence was non-zero and unchanged; and
then every listed format was saved (a complete framed reply of its declared length, of the kind its format
allows: "emf" only for CF_ENHMETAFILE, "data" for every other, never above the requested cap) or skipped for a
named reason (a measured excess over the cap, an explicit format policy, or the round-22 classes below). Listed 0,
counted 0, no error is a positive empty, the only zero-item save that can report "restored". Provenance (round 22):
the listed count and the name and reason of everything not kept are written into the record (round 21 claimed this
but kept the count in memory only), and a save that listed formats but kept none is never "restored". Anything else
is retried as a whole under the same 1.5 s deadline with a fresh reader, then the paste does not happen (nothing
emptied, nothing written). With no time left, no listing is requested at all. Stated plainly, the cost: while the reader waits in an owner's
render it now holds the clipboard with its own window, so another app's OpenClipboard fails meanwhile, as it does
while any app reads a format rendered on demand. Every other proof (the confirmation, the paste gate, the
"untouched" check, the size shown on a changed offer) uses one complete enumeration (no error at the end, the
count matching): an incomplete one proves nothing. A record that cannot go back whole (a registered format whose
name is lost, a metafile that cannot be rebuilt) is incomplete: a put-back of it is never "restored" and never
deletes it. A zero sequence is no evidence anywhere (round 22): one function reads the sequence for every check (the
transaction's start, inside our write, the confirmation, the quick looks before Ctrl+V, both proofs of the restore,
what a failed restore says the clipboard holds, and the view the user's Restore and the recovery take), and a zero
there refuses or fails that proof, never matches. Before the transaction a zero means no record is begun and nothing
is touched; inside or at the confirmation it rejects our write (kept, as an offer); at the user's Restore nothing is
emptied. Two cases follow from that contract (CI 25d, 25e): over an originally EMPTY clipboard there is
nothing to set back, so the restore reports "restored", leaves the clipboard empty and deletes the record (also
the user's Restore of one kept after a kill). A save in which every format was over the cap (16 MiB per
transaction) is, since round 23, NOT established (the one rule below): nothing is pasted and the clipboard is left
as it was (round 22 established it as a zero-item "skipped" save that emptied the clipboard and put back nothing).

Owner decision (round 22): skip-with-notice vs refuse for owner-unrendered formats. A listed format whose data the
save cannot read falls in one of three classes. The rest of the save rule stands unchanged.

THE ONE RULE (round 23, owner decision): if nothing with the user's content goes back, the save is not established
and nothing is pasted. User content excludes CF_LOCALE, the privacy markers, the presence-only flags, our sentinel
and bookkeeping (OLE, "Preferred DropEffect"). It covers every skip below (class 3, a cap, a policy) when nothing else
is kept, and a delayed-render text owner that renders nothing for its text while its CF_LOCALE reads. A positively
empty clipboard is not this case. Stated plainly: a clipboard holding only an oversize image (a 4K screenshot's DIB
is about 31.6 MiB, over the 16 MiB cap) now refuses to dictate by paste instead of destroying the screenshot; raising
the cap is the alternative. The user is told why: "Your clipboard holds something too large to save (such as a large
screenshot), so DoodleNote did not paste with it and left your clipboard as it was." When the text was NOT inserted,
it adds "Copy something smaller first, or copy the dictated text from DoodleNote and paste it yourself."; after a
typing fallback that put the text in it does not (round 24: no double paste). Scope, stated exactly (round 26): every
REFUSAL BEFORE OUR EMPTYCLIPBOARD, in the save and in the write up to its empty, gives the app a reason, and each has
its own sentence (round 24): too-large, unrendered,
nothing-savable, owner-unresponsive, zero-sequence, clipboard-changed (it changed during the save), clipboard-busy
(another app held it when the write went to open it; round 25), own-busy (round 39: DoodleNote's OWN clipboard work,
never another app's: the kept-records check before the paste not done in time, a recovery look still inside, or an
earlier dictation's late write still putting the clipboard back; rounds 36-38 sent clipboard-busy for these, whose
sentence blamed another app), empty-failed (EmptyClipboard failed; round 25), no-record (the
transaction, or the write's own first journal, could not be written down), deadline, no-window, unreadable; an
unknown reason falls back to the plain sentence. Other paths that do not paste report through their own channels,
not this notice: a target that fails validation, a delivery past its deadline and the guards after our write
(focus, password, modifiers, the clipboard changing before Ctrl+V) keep the text on the recovery card with their
own message; a failed input injection is its own failure; an abandoned write and its rollback report the late
clipboard result; and a foreign clipboard found right before Ctrl+V goes to typing with the clipboard reported
user-changed. The one rule applies at the user's Restore too (round 24): an
incomplete record with no user content (an all-skipped record of an earlier build, or one whose only content format
was lost on read-back) is never restored: the helper answers "nothing-to-restore" before emptying anything, the offer
counts the user content it holds (`content`, not `formats`, which also counts flags and CF_LOCALE), and its card
offers no Restore, only Dismiss.

The overlay card (round 24, Astra; Windows only since round 25): on Windows its window grows to fit the title, the
warning and at least one line of the dictated text (an estimate, at most 300 px); on macOS every card keeps its
exact pre-round-24 size (pinned by a unit test). The page bounds every block on both: the buttons never shrink, the
text keeps one line (1lh), and a long warning scrolls inside the card. CI renders every Windows notice variant in
Electron's Chromium with the BUNDLED font (the check fails unless that face loads; round 25) at the size the app
gives it, checks that exactly the buttons the view asked for are shown and in view with a line of the text, and
clicks each button through the overlay window's own URL pattern. An offer card's buttons name the record the page
shows, and the app acts only on that record (a click never reaches an offer that became current since). A Restore
that got no answer in time is matched to its later result by its record (round 25: a rebuilt record has no
delivery). An event that names neither a delivery nor a record never changes a notice.

The clipboard notice model (round 28; dictation-notice.ts, a pure reducer with its own tests). The app keeps ONE notice
slot, separate from the offer card and from every other panel; the overlay shows the slot's notice while one is
current. (a) A Restore request completes exactly once, by whichever of its recovered event or its reply comes first
(the other is consumed; a request whose reply was "no answer in time" completes by its later event), and a completion
with something to say sets the slot. While a record's Restore is outstanding its card reads "Restoring…" (not
clickable; Dismiss stays) and a further click is ignored; after the reply a retry works. (b) A later ACCEPTED user
interaction with the current UI supersedes the notice for good: Dismiss of any card, a click on the card shown, a
new dictation (a start accepted after its prerequisite checks and the capture ownership), a transform; no path
shows it again. A stale click naming a withdrawn card is rejected and supersedes nothing. (c) Offer-gone,
offer-added and offer-list refreshes never change the slot. (d) A newer completion or delivery report replaces an
older notice. (e) While current, the notice is what the overlay shows, except that a live session, a recovery card
and an error or status notice keep their priority. It ends only by (b), (d), its own six-second timer (which
starts when the notice is set: a completion arriving during a recording can expire while hidden and never be
seen), or, for a delivery's own report only, its withdrawal by that delivery's late result. The overlay page
rebuilds every button's link on every render from a fixed action (round 29); CI renders same-page transition
sequences (pending, reply, timeout and retry, Dismiss and its confirmation, repeated pending, expiry) and fails on
any page error. A permutation test (11,160 orderings of ten scripts, one and two records, timers mocked) runs the
production client and the service and compares the shown title after EVERY step with an independent model of the
events (the last notice-bearing completion unless a Dismiss, an accepted start or its expiry came after it); with
every completion notice suppressed, 6,904 of the orderings fail.

| Class | What | The save | The put-back | What the user is told |
| --- | --- | --- | --- | --- |
| 1. Known presence-only flags (matched ignoring case, as RegisterClipboardFormat is) | Clipboard Viewer Ignore (clipboard viewers and history tools skip an entry that carries it: Ditto tests its presence only; KeePass sets it, with data, ClipboardUtil.CfnViewerIgnore; round 23: a copy carrying it is never written to disk, in memory only, like a privacy-marked one); MSDEVColumnSelect, MSDEVLineSelect and VisualStudioEditorOperationsLineCutCopyClipboardTag (Scintilla and Visual Studio: the copy was a column or a whole line; Scintilla's ScintillaWin.cxx checks their presence only) | saved as presence only, never read | set again with no data (presence) | nothing (the copy goes back whole) |
| 2. Privacy markers | ExcludeClipboardContentFromMonitorProcessing, CanIncludeInClipboardHistory, CanUploadToCloudClipboard, present but not cleanly read (over their cap, none, nosize, unlocked) | established; the marker forces the conservative markers (no reported skip) | the three markers set to "exclude" | nothing (the content stays excluded); such a save is never written to disk |
| 3. Anything else its owner did not render | none, nosize or unlocked for a listed format under the reader's PROVEN hold with the sequence unchanged, on the second whole-save attempt (the first stays strict) | established with a NAMED, REPORTED skip, only beside user content that does go back (the one rule) | everything else; the result is "skipped" | "Your clipboard was put back except: FileContents (not provided by the app that copied it)." An offer of such a record says so on its card before Restore |

Still NOT ESTABLISHED (no paste): a lost hold, an enumeration error, listed != counted, a sequence change, a framing
error (malformed, fragmentary, out of order, "<id> end" with nothing between, a negative reply whose error is not a
number), busy, an owner that does not answer before a render ("unresponsive", after one more ping within the
remaining budget), an overrun, and the one rule. The cost of class 3, stated plainly: the user's clipboard comes back
without that format (Explorer's or Outlook's FileContents: a pasted file attachment is then missing; the file list
CF_HDROP, when the owner offered one, goes back), and the user is told so by name. The alternative (refusing) blocks
the paste for every copy from such an owner (the text is then typed in a classic text box, or kept on the recovery
card). Follow-up: capturing FileContents through OleGetClipboard and IDataObject (FILEGROUPDESCRIPTOR and the
streams) so it can be put back too.

Incomplete records and the user's Restore (round 22). A record of which part could not be saved or read back (a
class-3 or cap skip, a policy skip, a registered format whose name is lost, an EMF that could not be written down or
rebuilt) is INCOMPLETE. Its offer says so: "Part of this clipboard could not be saved: <names>. Restore puts back the
rest." The helper empties nothing for it unless the app's request says the user was shown that (acceptIncomplete);
otherwise it answers "incomplete" with the names and the card then shows them. When it runs, it puts back everything
that survived and answers "restored-partially" with the names, which the app shows; that accepted partial Restore
settles and deletes the record (round 23: the user chose it; before, a record with content lost on read-back stayed
offered). Round 23: an incomplete record is NEVER "already on the clipboard": its retained part back on the
clipboard proves nothing more can go back, but it is settled only by an accepted partial Restore, Dismiss or the
retention, never deleted as untouched nor answered "restored". The names travel with the reply AND with the events
(recovered, late-restore), and a completed Restore is reported even when its offer was withdrawn before the reply.
Every name is named: a bitmap, palette or metafile picture that cannot be rebuilt too. The card shows at most three
(+N more), so its buttons stay in view, and says "None of this clipboard could be saved" when nothing goes back.

The false-negative risk of the strict save, stated plainly: every refusal above is a blocked paste (the dictated text
is typed in a classic text box, or kept on the recovery card for copying). That is the chosen cost: a paste over a
save that is not established could destroy the user's clipboard.

Liveness (round 22). Whether another helper still runs is asked of Windows. Only a positive answer that it does not
(no such process, exited, another start time) lets its records be judged. A query Windows refuses (a protected process
that reused the pid) is UNKNOWN: the record is kept offer-only and not offered, a Dismiss is refused, and the
unreadable-payload bounds (24 h, two boots) end it; an invalid state is left to that helper until it is older than the
retention; a silenced output device is given back after an hour.

Native gates (not runnable in CI; the owner's list, round 22): Excel (a saved and an unsaved workbook), Word,
PowerPoint shapes, an Outlook message and an attachment, Explorer files (a normal folder and inside a zip), an image
copied in a browser, Teams, Snipping Tool, KeePass and Bitwarden, a Remote Desktop session, a slow or modal renderer
with the clipboard lockout measured, and a third-party app that opens the clipboard with a NULL window. Round 23
(Opus), corrected in round 24 (Astra): copy a column in Notepad++, dictate, let the helper exit or restart, then
paste in Notepad++. NOT ESTABLISHED: whether the presence-only flags the put-back set (as delayed rendering from the
helper's window) survive that window being destroyed. Windows documents that unrendered formats are removed when
their owner goes (WM_RENDERALLFORMATS); after a completed put-back the record is settled and deleted, so nothing
would be offered: the editor would lose its column or line paste mode (the text itself stays). No mitigation in this
PR (a window cannot re-set formats after it is destroyed).

EmptyClipboard audit, stated exactly: three sites in the RELEASE build (our write, the live transaction's restore,
the user's Restore); the test build has a fourth (the __seed op).

The user's Restore and the deliveries share the request queue, so a Restore never runs while a delivery is under
way; since round 38 it also answers "busy" while an earlier dictation's late write (whose delivery already returned)
still runs. (Until round 38 this said the Restore checked only its own record and could run during another delivery.)
Test-build exception: the __seed op (TestSeed) opens and empties the clipboard without the late-write exclusion; it
is compiled out of the release helper.

Test-build hooks are compiled out of the release helper. One of them, the keyboard-layout hook used by CI 31, is
CI-only: it activates another input language for the write thread and activates the previous one again when the
write ends, because on a real desktop with one input method for all apps it could switch the user's language.

The confirmation: a READ that fails under its open rejects the write (the flag below). An open that could not be
obtained DEFERS: nothing was observed, so nothing is rejected, and any later automatic restore still needs the full
content check behind the one guard (or the user's Restore).

The one guard. The live transaction carries one flag, set once and never cleared, checked at the top of the only
in-process path that writes the clipboard after our write (its restore; every caller goes through it: the normal
restore, the restore after a failed paste or an exception, the late-write thread, the uninspectable path). It is
set by:
- a confirmation that rejects our write (not exactly ours, the sequence beyond our close, or a read that failed);
- every keep-as-offer (an owner change, an owned but changed clipboard);
- an incomplete put-back;
- a stage that could not be journaled;
- the write's own put-back;
- settlement (the transaction leaving in flight).

The record's persisted offerOnly field is kept in the state schema as an informational fact. Nothing read from disk
depends on it being written in time.

Text forms (unchanged from round 15 in what is pasted): our write sets only CF_UNICODETEXT (plus the markers and the
sentinel). Windows sets CF_LOCALE when we close the clipboard (the input language of our write thread) and
synthesizes CF_TEXT and CF_OEMTEXT from our text on that locale's code pages, exactly as it always did. The locale
Windows will set is pinned in the live transaction and stated in our sentinel. A look compares CF_LOCALE with the
pinned value, and CF_TEXT and CF_OEMTEXT with Windows' conversion of our exact text on the pinned locale's default
ANSI and OEM code pages, up to their terminator. A sentinel that states another locale is not ours. Windows renders
none of the three inside our own open, so there is nothing to read back there (round 17 found this on the runner;
round 18 removed the attempt). CI checks:
- the conversion byte for byte against Windows' own synthesis, under en-US, ru-RU, pl-PL and ja-JP, for non-ASCII,
  best-fit, unmappable and surrogate-pair text;
- that the CF_LOCALE Windows stamps is the pinned locale, also when the write thread uses another input language
  and when another thread uses a third.

A difference on some other system would make a write look changed: a false rejection (nothing pasted, the record
offered), never a wrong paste.

The sequence allowance (a continuity limitation, stated plainly). The confirmation and the later looks accept a
sequence up to Windows' close moves plus the three forms it synthesizes (2 + 3) beyond the one sampled inside our
write. Within that allowance, a foreign rewrite of an existing text format with the SAME bytes is not detected
(the smallest undetected foreign action is one such replacement after the confirmation). It is harmless by
content: what is pasted or put back is byte-identical. The allowance is not tightened: that cannot be validated
natively, and a false rejection would leave an offer after an ordinary dictation.

STRICT STATE. A state file is valid only when it is exactly one this helper writes:
- every field present, with its type and range;
- nothing else;
- a known stage;
- this format and this record's id.

No default ever stands in for a missing field. Anything else proves nothing and takes one route: `{}`, a missing
stage, an unknown stage, a missing or mistyped identity, extra fields, or truncated or zeroed bytes.
- If a payload is there (adopted from .bin.tmp if need be) and names the record, or cannot be decrypted or looked at
  now, the state is rebuilt. The rebuilt state has stage "unknown" and an UNKNOWN identity (session -1, no logon or
  key, pid 0), and the record is offered.
- If the payload is positively absent, the state is removed.
- An invalid state is checked for its boot first, as a valid one is. One of an earlier boot is rebuilt and offered
  here; one of this boot that names another session, or a running helper, is left alone.

A rebuilt record has no session, so it is offered, and can be restored or dismissed, in ANY session of this user
that shares %TEMP%. It is offered in the boot it is rebuilt in only (counted as its second offer boot), and an offer
tick of this boot that the damaged state still shows is kept. So damage cannot extend the retention as long as that
timing information is recoverable; a state damaged beyond it starts a new, bounded clock. Its delivery id is lost.

A state journaled "settled" is deleted on sight, never offered. Stated plainly: if journaling "settled" fails AND the
file deletion fails too, the record keeps its earlier stage and can be offered again after a successful restore (the
user's Restore of it then finds the saved content already there and deletes it, or asks again). "Settled" is written before a restored record's
file cleanup, for both the transaction's own restore and the user's Restore, and the offer is withdrawn at the same
moment.

PRESENCE. File.Exists is false on any error, which is no proof of absence. Every destructive or deletion-deciding
look uses a three-state probe (GetFileAttributesW):
- ABSENT only for "file not found" and "path not found";
- PRESENT when attributes are read;
- UNKNOWN otherwise.

These act only on ABSENT: "missing payload" cleanup (a state is deleted for a missing payload only when both .bin
and .bin.tmp are positively absent), adoption, the orphan and stray-.tmp sweeps (an unreadable file time is never
"old"), the deletion's own checks, and Dismiss. UNKNOWN keeps the record whole. The retention and boot limit are
DECISIONS: when one ends a record whose file cannot be looked at, the deletion is deferred (reported as such) and a
later check retries; there is no guaranteed physical bound while a file stays unreadable. A state file that cannot be
read at all is kept and checked again before any retention processing (its clock cannot be read either). A payload that cannot be looked at,
read or decrypted now is kept offer-only and bounded by the unreadable-payload policy below, so nothing loops for
ever.

Every other state is pending:
- The record is kept, nothing is written, and the app shows "DoodleNote may have changed your clipboard while
  dictating. Put back what you had copied before?" with Restore and Dismiss (the card's own buttons; the shared
  dismiss of other cards never touches it). The card names formats and size only, never content.
- Restore runs as a journaled transaction of its own (offer-only from the start: interrupted, it is offered again),
  and only while the clipboard is exactly as it was when first offered. The offered sequence is fixed then; a retry
  never refreshes it. If the clipboard changed, the card says what a restore would overwrite (formats and size) and
  asks again.
- Dismiss asks first ("Delete the saved clipboard?"). The card goes only once the helper reports the files deleted,
  and stays with "The saved copy could not be deleted. Try again." otherwise.
- An offer whose record vanished another way is withdrawn once its state is positively absent.
- Every outstanding offer is kept, and the next one shows after one is resolved.
- Offers load at app start and every hour, whether or not Bark is on (it is the user's clipboard, not a dictation
  feature; the helper is started for it only when this identity has kept records on disk), and when Bark is turned
  on.

The full deletion contract, stated plainly.
- PROOFS (nothing of the user's can be lost):
  - a completed restore (the live transaction's own, or the user's Restore), reported as restored, partial or
    skipped;
  - the clipboard already holding exactly the saved content (any logon of this session; a whole save);
  - rounds 34-35: the clipboard unchanged since the capture (the first durable state "emptying" with its capture
    sequence and window station; a complete look in the same logon, boot and window station showing the same
    sequence), so nothing was emptied (also an incomplete save);
  - (until round 32: "stage saved = nothing emptied"; round 33 removed that rule: no record is deleted by its stage);
  - a state whose payload is positively absent (nothing to restore from).
- THE USER: Dismiss (after "Delete the saved clipboard?").
- POLICIES (they can delete content the user might still want; chosen limits, not proofs):
  - retention: 24 h after the record's first offer, on the tick count of that boot (the helper checks every 30
    minutes, the app every hour);
  - the boot limit: offered in at most two boots, the boot of its first offer and the next one, then deleted (an
    offer restarts in the second boot, because sequence numbers restart);
  - a rebuilt record is offered in the boot it is rebuilt in only;
  - the unreadable-payload policy: a payload that cannot be decrypted (not bad data: a key or profile not available,
    e.g. after a password reset), looked at or read now is kept offer-only, its 24 h and boot clock starts at the
    first failed attempt, and it is then deleted as unrecoverable. Stated plainly, this deletion is SILENT for the
    user: such a payload was never offered (an offer needs its formats and size) and the app is not told; only the
    helper's log says so. A deletion the files refuse is deferred and retried on the backoff and the 30-minute
    sweep;
  - cleanup of records that cannot be restored from:
    - a payload whose data is bad;
    - a payload of an earlier format;
    - a payload whose id does not match its state;
    - an orphaned payload (state positively absent, older than 10 minutes: it may be a record the user dismissed
      whose deletion was cut short);
    - a stray state .tmp;
    - a round-8 record;
    - round 33-34: a transaction Begin gave up on (not established: its files removed by its writer, nothing emptied);
    - round 34: an earlier build's File.Replace leftover (a state copy) whose replace cannot still be running.

A payload next to an INVALID state is rebuilt and offered; a payload with NO state is an orphan; the two are kept
distinct. The DURABLE state writes (the first state, "settled", and the offer-only and unrestored facts) go through to
disk (write-through and flush) before they replace the previous file; the diagnostic ones are not flushed (round 33).

Deletion.
- Every file of the record is opened with delete access and no sharing.
- If any file is held by another process, an AV scan or an indexer, or cannot be looked at, nothing is deleted. The
  record stays whole and is checked again later, and Dismiss reports it not deleted.
- Otherwise every handle is marked for deletion in the order state .tmp, payload .tmp, state, payload, and their
  close removes the files.

It is NOT atomic across the helper's death or a failed rollback: marks already set are honoured when the handles
close, a killed process's included. Stated as the PHYSICAL outcomes, every interruption ends as one of:
- The whole record (intact). A kill before the state's mark leaves it intact, so a Dismiss that never completed CAN
  be offered again.
- A payload without its state. It is never restored from, and it is swept as an orphan once its state is positively
  absent and it is older than 10 minutes.
- A state without its payload. A failed rollback can leave one: the marks already set on the payload files stay
  while the state's is cleared, or a kill lands before a completion re-marks the state. Recovery removes it once both
  payload files are positively absent.

None of these is an unauthorised deletion: the deletion had already been decided. If a mark fails, the marks already
set are cleared; if every clear succeeds, nothing is deleted. If a clear fails, the deletion is completed instead:
every handle is marked again from the beginning in the same order, every re-mark's result is checked and a failed
one logged. Whatever is left is reported as it is: intact means kept; with the state gone, the offer is withdrawn
and the payload is an orphan. CI kills a helper between two marks and drives the mixed rollback.

Adoption persists the record's offer-only fact before it moves .bin.tmp into place; if that write fails, the move
still proceeds (and a rebuild passes no such step). Both are harmless now that nothing on disk grants authority: the
adopted record is offered either way.

Another session's record (same user, same boot, shared %TEMP%) is left alone by the decision
procedure, which checks that first, and by Dismiss, which refuses it; the orphan and round-8 sweeps act
on file evidence alone, and a rebuilt record (unknown identity) is offered in any session. A state or payload
file that cannot be read for the moment is kept and checked again, and a payload is never deleted while its
valid state file is kept. Right before Ctrl+V (and before a restore), "user-changed" (someone else's content, left
alone) is decided only when the clipboard's OWNER changed, and even then the user's saved clipboard is kept
and offered, never deleted on that guess (another owner proves someone emptied the clipboard, not that the
user made a newer copy). If our window still owns it but it is not exactly our write (an app added or
replaced a format without emptying), or the clipboard cannot be opened to look, nothing is pasted and
nothing is settled: the record is kept and offered. That look (it opens the clipboard and may wait) comes
before the final checks, which stay the last step before Ctrl+V. The check of kept records before a paste
opens the clipboard once per record; the paste then starts only if it still fits the delivery's deadline
(otherwise nothing of the user's is touched and the typing fallback decides; chosen over capping the number
of offers, which would hide records the user is owed). A restore (the live transaction's or the user's) pings a live foreign
owner (WM_NULL, 200 ms) before its EmptyClipboard: an owner that is hung or does not answer is not asked
(busy, kept). It is a sample: an owner can answer the ping and then stall in WM_DESTROYCLIPBOARD, and then
the restore holds the lock as long as Windows waits on it (about 5 s).
Offers with Bark off: starting the helper for an offer runs the same
integrity check as any start, which uses the speech worker (and so loads the speech model until it
idles); this happens only when this identity has kept records on disk. Retries use the record's own backoff
(3 s, 10 s, 30 s, 60 s, 120 s): every retry that does not settle the record advances it (a failed attempt, a
check still pending, a busy clipboard, a file or key not readable now), so nothing loops every second;
another session's record is not retried at all, and the checks before a delivery and at the next helper
start never use a step. Payloads without a journal are deleted, never
restored from, and a settled transaction is never published. Records of earlier formats are removed
with a log line, never restored from. **Content that carries any clipboard privacy
marker (as password managers set) is never written to disk**: that transaction stays in memory, so a
helper killed between our write and the restore cannot give it back, and after a crash there is nothing to offer (the offer card says so). Round 33: the encrypted
payload is on disk, flushed, before anything is emptied (the paste waits for it about 2 s at most; otherwise no paste,
"no-record"): the earlier 250 ms window, in which a large clipboard could go ahead before it was on disk, is closed.

Leaving: the app asks the helper to quit by closing its stdin (there is no quit op). On every exit
path (stdin closed, a restart, an unhandled exception, a console close or logoff event; one atomic step decides which thread runs the exit, and every other starter waits for it to finish) a delivery in progress finishes its restore and
reply first, and an abandoned clipboard write finishes its rollback: a quit waits up to 3 s for both;
a restart waits for the delivery to end, and stdin closing meanwhile shortens that to 3 s. Past the
wait, the transaction record is how the next helper finishes the job. The helper's worst-case exit
(3 s plus 4 s of bounded clean-up) stays inside the app's 8 s grace. On a console close or logoff event the wait for a delivery is 0.5 s, so the whole exit fits in 4.5 s (Windows ends a console process about 5 s after such an event, and at once when its handler returns, so the handler waits for the exit's completion signal). A restart because provider calls
are stuck, or because two clipboard readers wait on owners that never render, happens only between
deliveries. Clipboard readers are never killed on exit. THE BOUND on a reader held in an owner's render (round 22):
(1) an owner that does not answer a WM_NULL is never asked to render: the helper checks before the save and again
before emptying, and the reader checks before each read (one more ping within the remaining budget); (2) Windows' own
WM_RENDERFORMAT timeout (not quantified here: Windows documents no value, and it was not measured); (3) the reader
reads its stdin on its own thread and ends itself when a read is still outstanding 30 s after its stdin closed (the
helper abandoned it, or ended); (4) the helper ends an abandoned reader after 120 s on an owner reported hung, or
after 300 s whatever the owner reports. IsHungAppWindow alone is no bound: an owner that is busy but pumps is never
"hung". So a reader outlives the helper by at most about 30 s. The cost: a reader ended by (3) or (4) mid-render may
lose the format being rendered for its owner. An abandoned late write of ours keeps its record in flight until it has
put the saved content back. Until round 37 this said the user's Restore and the leftover checks "find it busy": WRONG
for the helper's own opens (round 38, Astra P2): the late write opens with the helper's SAME window, so another open of
ours does not fail but takes its open over (the rollback then fails; the clipboard can be left empty, the record kept
as an offer: never a loss), and between its opens our late text is on the clipboard. Since round 38 the leftover checks
skip while anything is in flight (round 37), the user's Restore answers "busy" (nothing touched, the card kept) while
a write thread of ours still runs (deliveries and the Restore share the request queue and recovery looks take the
recovery lock, so a write thread whose delivery returned, a late write and its rollback, is the one opener left; it is
counted until its rollback is done), and a new delivery waits for a late write at most 1 s
within its deadline, else refuses ("own-busy" since round 39, nothing touched) (CI case 59). Round 39 (Opus nit): a late write that
has not ended 30 s after it was abandoned (a hung EmptyClipboard was measured at about 5.2 s before Windows gave up, so
this needs a write that never returns) makes the helper leave to be replaced, the usual restart between deliveries
("clipboard-write-stuck", logged); its exit waits for that write within its usual wait, and past it the record lets
the next helper judge the transaction by content (CI case 60, with the watchdog shortened in the test build).

If the helper's UI thread itself crashes, the hooks may block input for up to 3 s while the bounded
shutdown runs; a clipboard transaction in flight is then finished by the next helper from its record.
Right before Ctrl+V and before each typed key the helper checks that no Shift, Ctrl, Alt or Win key is
down (a held key would turn Ctrl+V into another shortcut); if one is, nothing is sent.

Known limits of the typing fallback, stated plainly: a custom WinForms control that sets
ES_WANTRETURN but handles Enter as a dialog key in its own code can still press its AcceptButton (no
check from outside can see that); and an app whose message loop is ANSI turns characters outside its
code page (an emoji, for one) into "?" before the box sees them. The read-back then reports the
delivery as uncertain, but the wrong character is already in the field.

Known limitation: non-Latin scripts and the typing fallback. The paste path handles all of
Unicode. Typing sends `KEYEVENTF_UNICODE` keys, and surrogate pairs go as one key. Where an IME or
autocomplete changes the text by anything other than the typed key, typing stops at once and
reports `uncertain`, with the count of confirmed characters. The host then keeps the text.

The helper is checked inside the Windows speech worker before every spawn, and the app never
starts PowerShell for it. The worker:
1. Opens the helper with writing, renaming and deleting denied, and keeps the handle.
2. Hashes the bytes it read through that handle.
3. Runs WinVerifyTrust on the same handle.
4. Lets go only after the spawn has returned and the hold has been confirmed.

If the worker ends before that, the spawn is discarded and the check runs again.

The client confirms that the worker still holds the file immediately before the spawn, and again
right after it. Until that second answer comes back, the new helper is not used: no request reaches
it, its output is held back, and no hold key is armed. A worker that is busy (loading a model,
decoding live captions) is waited for, never treated as a lost hold: a hold ends only by an explicit
release, the worker's exit, or the worker's own 15 s expiry, each of which the app now sees at once.
Only an answer confirms the hold: a worker that has not answered after 4 s leaves the spawn
unconfirmed (it goes ahead, nothing is ended), the hold is reported locked:false and Settings says
so (one cautious line for both "unconfirmed" and "digest only"), and a late positive answer while the
lease is still held brings locked:true back. The signature budget, the capped QA hold pause, both
confirmation caps and the spawn allowance (14.5 s) stay below the worker's expiry (15 s); both come from
one module, which refuses to load otherwise. That is configured arithmetic, not a wall-clock bound on
process creation, IPC or the file system: the runtime "unconfirmed" path is the real safety net. A helper ended because its hold was really lost counts against the
restart allowance, and the next attempt waits the normal backoff. Only a launch that goes all the
way through (spawned, confirmed, its first status answered) clears the count of lost holds. Killing a helper whose confirmation failed
cannot undo what it already ran. Creating the process inside the worker would close that gap, but
it is not done. The reasons are in PR #276, round 7.

Integrity policy (stated plainly):
- This check is a **corruption guard, not a security boundary**. The per-user install folder is
  writable by the user, so code running as that user can replace the app itself; Application
  Control is the real boundary.
- The digest baked into the build decides. When it matches, the bytes are the build's own.
- A signature that is untrusted, revoked or explicitly distrusted still gives "ok" when the digest
  matches. A valid signature adds pinning of the signer's name and thumbprint.
- A broken signature, or a valid one from the wrong signer, is damaged.
- After repeated lost holds, the check runs on the digest alone. Settings shows that ("checked by
  its digest only"), and the held check is tried again once 60 s have passed.

Fresh install: while the preferred Parakeet model downloads in the background a fresh
install serves the weaker legacy Zipformer; Bark refuses to dictate on it (matching the
Mac) and the pill/Settings show the download percent, a failure message, and retry on the
next attempt.

Security review follow-ups verified natively on Dev04 (evidence/step4-fix-2): the hook
watchdog injects no input (GetLastInputInfo unchanged across an armed-idle span); typing
stops before a single character reaches a password field focused mid-type; clipboard
privacy markers survive restore; a concurrent copy is not clobbered; and one helper never
erases another's live mute-recovery record.

## QA identity, profiles and the update feed (win/bark)

Packaged builds of the production identity (`com.doodlenote.desktop`, profile
`%APPDATA%\desktop`) ignore `DOODLE_USER_DATA`. A release-lineage QA package built from win/bark
therefore runs against the real profile. It also reaches the **production update feed**: on win/bark,
Windows update checks are still wired on. PR #279 adds the build-time update gate
(`DOODLENOTE_WINDOWS_UPDATES`, off unless set) that closes this.

Until that gate is in the branch under test, run packaged QA on win/bark only with one of these:
- a `DOODLENOTE_CHANNEL=dev` package, which uses the `%APPDATA%\DoodleNote Dev` profile and the dev
  identity, with no production feed;
- the isolated QA identity from PR #279 (`pnpm package:win:qa`).

Never use a release-lineage package. Two such runs on 2026-11-07 changed the October QA profile and
queried the production feed; evidence/step4/PROFILE-NOTE.md lists exactly what changed.
