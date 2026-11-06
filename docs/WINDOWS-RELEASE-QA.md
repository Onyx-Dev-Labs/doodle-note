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

`node apps/desktop/scripts/test-windows-asr-runtime.cjs <packaged-exe>` runs the
real first-run model download in an isolated profile (or copies
`DOODLE_WINDOWS_ASR_MODELS` when set), loads the packaged speech runtime and
checks the live model, its calibration and a finalized stream.

## Windows speech engine

Windows transcribes on the CPU with sherpa-onnx (`sherpa-onnx-node` 1.13.4,
bundled ONNX Runtime pinned by `windows-asr-runtime.ts`). Models download on
first use from the k2-fsa `asr-models` release, are verified by size and
SHA256, resume after an interrupted download, are unpacked into a private
staging folder and promoted with one rename. Folders left by earlier builds
(`sherpa-onnx-streaming-zipformer-en-2023-06-26`, `sherpa-onnx-whisper-tiny.en`)
are not touched; delete them by hand to reclaim about 0.6 GB.

- **Live captions** (both channels): Silero VAD cuts each channel into
  utterances and NVIDIA Parakeet Unified 0.6b (the Mac's live model; int8,
  full-context export) decodes each one with real token timestamps and
  confidences; casing and punctuation come from the model. While someone is
  speaking, the utterance in progress is re-decoded on a geometric schedule
  (after 1 s, then each time it grows by half) so the caption grows before the
  pause. First-run download: 502 MB (501,350,460-byte model archive plus the
  643,854-byte VAD).
- **Imports and Re-transcribe**: the same pipeline without interim captions,
  using the Mac's batch setting and models: Parakeet TDT 0.6b v2 (English,
  default, 482 MB on first import) or v3 (Multilingual, 487 MB on first use). Settings ->
  Recording transcription offers exactly these two options on Windows; Whisper
  remains Mac-only. External stereo files are mixed once to a single neutral
  `Speaker`; only saved DoodleNote recordings keep microphone/system channels.
- **No post-stop refinement**: like the Mac, the live transcript is final when
  Stop finishes. Whisper tiny.en is no longer downloaded or used.
- **Slow machines**: at startup the live engine decodes a fixed 4 s signal and
  measures its real-time factor. Above 0.2 (about twice this reference
  machine's cost) captions switch to utterance-only updates; committed text
  still follows each pause and all audio is still transcribed. Measured on
  Dev04 with the benchmark pinned to fewer logical CPUs: 4 logical CPUs gave
  calibration 0.107 and two-channel RTF 0.49 with interims (interim mode);
  2 logical CPUs gave calibration 0.201 (utterance mode) and RTF 0.70 even with
  interims, with the same 10.5% meeting WER. While
  recording, interim decodes are skipped whenever decoding used more than half
  of the last 10 s or a channel lags capture by 1.5 s. If a channel still falls
  5 s behind, the recorder shows "Live captions are running behind on this
  PC." After Stop the worker is allowed to finish queued speech as long as it
  keeps producing text (it is ended only after 15 s without progress).
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
| **VAD + Parakeet Unified per utterance, 2 threads** | **new live** | **3.6%** | **10.5%** | **16.0%** | 0.28 | 0.48 | 1.71 GB |
| VAD + Parakeet TDT v2 per utterance, 2 threads | live alternative | 5.4% | 11.8% | not run | 0.25 | 0.45 | 2.20 GB* |
| VAD + Parakeet CTC 110M, 2 threads | slow-PC candidate | 5.4% | 18.6% | not run | n/a | 0.12 | 1.64 GB* |
| **VAD (1 s, 30 s) + Parakeet TDT v2, 4 threads** | **new import, English** | **5.2%** | **10.5%** | **15.6%** | 0.09 (long 0.10) | n/a | 1.57 GB |
| **VAD (1 s, 30 s) + Parakeet TDT v3, 4 threads** | **new import, multilingual** | **3.8%** | **10.7%** | **15.5%** | 0.09 (long 0.10) | n/a | 1.57 GB |

\* With ONNX Runtime's CPU arena enabled; the shipped configuration disables it
(1.71 GB instead of 2.39 GB for the Unified live run, about 6% slower).
Unified streaming 240 ms was probed only (RTF about 6 on one 7.4 s clip).
Interim captions are included in live RTF: the clip runs re-decoded about 95% of
scheduled interims. All Parakeet paths produced casing and punctuation; the two
previous models' live path produced neither.

- Buffered streaming exports of Unified re-encode 5.6 s of left context every
  step, so on this CPU they cannot keep up with one channel and are less
  accurate on meetings than the same weights decoded per utterance.
- Live (Unified, per utterance) and batch (TDT v2) are within noise of each
  other (10.5% vs 10.5% meeting, 16.0% vs 15.6% on the 30-minute meeting), so
  Windows matches the Mac with no post-stop refinement. The previous tiny.en
  refinement took 133 s after Stop for the 30-minute meeting; Stop now waits
  only for the last utterance (median 0.35-0.46 s, maximum 1.6 s on clips).
- First text appears after a median 1.28 s (read) / 1.54 s (meeting) of audio,
  versus 1.02 / 1.54 s for Zipformer and 1.79 s for Unified streaming.
- Timestamps do not drift: against AMI word times the live median offset is
  +0.28 to +0.32 s in every 5-minute window of the 30-minute meeting (TDT
  batch: +0.03 to +0.07 s). The RNNT model emits words about 0.3 s late; the
  offset is constant.

30-minute live session, paced like capture, in the packaged Electron runtime
(the AMI IS1009c mix and its speaker-A headset as two simultaneous channels,
Unified, 2 threads, shipped session options):

- Kept up for the whole session: 0.77 logical CPUs busy on average (of 16),
  decode time 0.36 s per second of audio for both channels together. Queue lag
  was under 0.1 s in most 30 s samples, with spikes up to 4.5 s when both
  channels finished long utterances together (below the 5 s warning).
- Memory was flat: resident 986-1043 MB from the first to the last minute
  (peak 1.40 GB). No growth over the session.
- WER 16.0% on the mix channel, identical to the unpaced run; timestamp
  offset constant (above).
- Committed segments arrive per utterance: in this continuous meeting speech
  they trailed the spoken word by 9.7 s on average (90th percentile 21 s,
  bounded by the 15 s utterance cap). Captions in between come from interim
  decodes; under this two-channel load the guard skipped 45% of scheduled
  interims, so captions refreshed about every 2 s instead of every 1-1.5 s.

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
