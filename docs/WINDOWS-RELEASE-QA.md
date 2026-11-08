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

Clipboard: the user's content is preserved (a copy made during our save is never overwritten), but
how long that copy takes is bounded by the slow owner, not by us. Our own write (open, empty, set,
close) runs on its own thread for at most 1 s; an owner that answered the WM_NULL probe and then
stalls in WM_DESTROYCLIPBOARD makes the paste give up (typing may still run), and when the owner
returns the late write puts the user's content back, never ours (and tells the app, which updates
the warning it showed).

Each paste is a clipboard transaction with a record: the saved clipboard (DPAPI-encrypted for the
user) and a journal of its stage (saved, emptying, emptied, written, restoring, unrestored; a recovery
journals itself as recovering-emptying, recovering-restoring) in %TEMP% under the app identity. Each
stage carries the clipboard sequence number that goes with it, and every record its boot, logon
session and window-station session, because sequence numbers restart with a new boot or logon. A
record is deleted only once a restore completed; a failed or partial put-back keeps it and retries
with its own backoff (3 s, 10 s, 30 s, 60 s, 120 s), before the next delivery, and at the next helper
start. Recovery acts only on evidence specific to that transaction: our record's sentinel format (set
first by our write and by every restore) or the stage's sequence number within the same boot and
logon. An empty clipboard counts as ours only when the sequence moved by exactly our own
EmptyClipboard; a partly restored one only when it carries our sentinel and nothing but formats we
saved, with identical content. A screenshot, a new copy, a deliberate clear, or matching text is never
ours. Payloads without a journal (a transaction settled while its slow write finished) are deleted,
never restored from, and a settled transaction is never published. **Content that carries any clipboard privacy
marker (as password managers set) is never written to disk**: that transaction stays in memory, so a
helper killed between our write and the restore cannot give it back. The encrypted write runs in the
background; a paste waits for it at most 250 ms (a large clipboard may go ahead before it is on disk).

Leaving: the app asks the helper to quit by closing its stdin (there is no quit op). On every exit
path (stdin closed, a restart, an unhandled exception) a delivery in progress finishes its restore and
reply first, and an abandoned clipboard write finishes its rollback: a quit waits up to 3 s for both;
a restart waits for the delivery to end, and stdin closing meanwhile shortens that to 3 s. Past the
wait, the transaction record is how the next helper finishes the job. The helper's worst-case exit
(3 s plus 4 s of bounded clean-up) stays inside the app's 8 s grace. A restart because provider calls
are stuck, or because two clipboard readers wait on owners that never render, happens only between
deliveries. Clipboard readers are never killed on exit; one still waiting in a render finishes it
and leaves. Only the prune timer ends a reader, after 120 s on an owner reported hung.

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
