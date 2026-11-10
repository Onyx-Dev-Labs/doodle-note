# engine

The on-device transcription sidecar. All-new Swift; one library dependency
([FluidAudio](https://github.com/FluidInference/FluidAudio), Apache-2.0) for
CoreML ASR on the Neural Engine. The desktop app spawns this binary and reads
NDJSON events from stdout.

## Build

```sh
swift build -c release          # binary at .build/release/engine
```

Requires Apple Silicon + macOS 14+. Models download from HuggingFace on first
use to `~/Library/Application Support/FluidAudio/Models/` (~440MB per model).

## Import compatibility tests

From the repository root, run `engine/tests/test-audio-import.sh`. This compiles
the import/export path with a macOS 14 deployment target and exercises synthetic
WAV, M4A and MP4 media, export failures, cancellation and temporary-file cleanup.
It does not load models or request capture permissions. Set `SDKROOT` to select
an installed SDK if needed. Running on a newer macOS does not replace macOS 14
runtime QA.

## Commands

```sh
engine transcribe --file meeting.wav [--model v2|v3] [--timings]
    Batch transcription, highest quality (Parakeet TDT). Used for the
    post-meeting final pass and file uploads. ~120x realtime when cached.
    --timings attaches per-token timestamps to the final event.

engine stream --file meeting.wav [--realtime]
    Feeds a file through the live streaming engine (Parakeet Unified) in
    0.25s chunks — same code path as live capture. Emits growing partials.

engine live [--source mic|system|both] [--seconds N] [--aec off] [--input-device <uid>] [--audio-dir <path>]
    Live two-channel capture + transcription:
      mic    → "You"   (AVAudioEngine input tap)
      system → "Them"  (ScreenCaptureKit system audio — the other side of the call)
    Runs until --seconds or SIGINT/SIGTERM. Speaker separation between you and
    the far side comes from the capture topology, not diarization.

    Signals: the first SIGINT/SIGTERM (or stdin closing, with
    --exit-on-stdin-close) tears the OS capture taps down synchronously —
    a process killed with an SCStream still capturing leaves a stale
    "System Audio Recording" attribution in Control Center — then drains the
    transcript and exits after `done`. A second signal skips the remaining
    drain: it emits `done` and exits immediately. Serve mode behaves the same.

    --audio-dir enables crash-safe audio persistence: each channel writes
    rotating ~30s CAF checkpoints under <dir>/checkpoints/ while recording;
    a clean stop merges them into <dir>/audio.m4a (AAC 16kHz, L=mic R=system,
    epoch-aligned) and emits an `audio` event. Serve mode accepts the same
    directory as "audioDir" on its start command.

    --input-device pins the mic channel to a CoreAudio device UID (from
    `engine devices`); omitted = system default input. A pinned device that
    fails to start or delivers no audio falls back to the default rather than
    recording silence. With --exit-on-stdin-close, stdin lines are commands:
    {"cmd":"set-input","uid":"…"} switches the mic mid-session ("" = default),
    {"cmd":"stop"} ends the session. The serve mode accepts the same
    "inputDevice" on start and the same "set-input" command.

    --voiceprint <path> turns on dictation's "Only my voice" for the mic
    channel: speech that is not the enrolled voice (see enroll-voice) is
    replaced by silence before it reaches the recognizer, and the `final`
    event gains a `voiceGate` report. A voiceprint or model that cannot be
    loaded never blocks the session: it runs unfiltered and emits the status
    `voice_gate_unavailable`. Serve mode accepts "voiceprint" on start, and
    {"cmd":"warm-voice"} preloads the speaker models.

engine enroll-voice --out <voiceprint.json> [--seconds N] [--input-device <uid>]
    Records one person reading aloud (20s by default) and writes their
    voiceprint: a 256-number voice embedding, their speech level and the
    microphone used. No audio is written anywhere. Emits `level` events
    while recording, then {"event":"voiceprint","ok":true,…} or
    {"event":"voiceprint","ok":false,"reason":"not_enough_speech"|"microphone"|"failed"}
    and `done`. A failed run leaves an existing voiceprint untouched.
    With --exit-on-stdin-close, {"cmd":"finish"} on stdin ends the recording
    early and keeps it; stdin closing cancels and keeps nothing.
    --file <audio> builds the voiceprint from a recording instead.

engine voice-check --file <audio> --voiceprint <json> [--out <gated.wav>] [--same-microphone]
    Tuning tool: replays a recording through the "Only my voice" gate as live
    dictation would. Each rejected voice is logged to stderr with its distance
    and level; one `voice_check` event carries the totals; --out writes the
    audio the recognizer would have heard. --same-microphone lets the
    enrolled level count, as it does when dictating on the enrollment mic.
    `engine stream --file <audio> --voiceprint <json>` runs the whole live
    pipeline (gate + recognizer) on a file and prints the transcript.

engine devices
    Lists audio input devices as one NDJSON event and exits immediately:
    {"event":"devices","inputs":[{"uid":"…","name":"MacBook Pro Microphone","default":true},…]}

    Echo isolation: when the call plays through speakers, the mic physically
    hears the far side. Apple's Voice Processing I/O (the FaceTime echo
    canceller) is enabled on the mic by default — it subtracts the speaker
    signal from the mic input; audio ducking is disabled so meeting volume is
    unaffected. `--aec off` disables it for A/B comparison. The system channel
    is a digital tap and is always clean. Residual bleed gets removed at
    segment-build time via cross-channel token-timestamp dedup (planned).
    Headphones make isolation perfect regardless.

engine merge-audio --dir <path>
    Post-crash recovery: merges a session directory's leftover checkpoint
    chunks into audio.m4a (the same code path a clean stop runs), emits the
    `audio` event, and deletes the checkpoints. A directory containing
    checkpoints/ but no audio.m4a is exactly "a session that never finished".

engine info
    Reports model cache locations and download state.
```

## Only my voice (the voice gate)

`VoiceGate.swift` sits between the microphone and the recognizer when a live
session is given a voiceprint. About twice a second it looks at the last ten
seconds of audio with FluidAudio's speaker models (pyannote segmentation +
WeSpeaker embeddings, ~13MB, downloaded on first use): who talks when, and how
far each voice is from the enrolled one (cosine distance, 0 = identical).

- distance <= 0.60: the user. Kept, and its loudness becomes the reference.
- distance >= 0.75: someone else. Replaced by silence (not cut, so pauses
  and token timings are unchanged).
- in between, or under ~0.75s of speech (too short to tell voices apart):
  loudness decides — more than 10dB under the user's own level is someone
  across the room. With no level to compare against, the audio is kept.

Each voice is embedded from its own speech only (joined end to end); leaving
silence or other voices in the model's ten-second input skews its
normalization and makes a short utterance look like a stranger. Audio waits
for its verdict, so partial text trails speech by roughly half a second.
A model failure passes audio through; three in a row switch the gate off for
the session. Thresholds live in `VoiceGate.Config`.

Logic tests (no models): see the header of `tests/VoiceGateTests.swift`.

## First-run permissions (live)

The desktop app runs `engine preflight --models-only` at launch to warm the
transcription cache without requesting permissions or probing audio devices.
Full `engine preflight` belongs to the visible onboarding flow: it checks or
requests microphone access, tests system audio, then prepares transcription.

Each recording start still validates current capture capability. Microphone
consent is requested only when the OS reports `notDetermined`; an existing
grant skips the request, and denied/restricted access fails with recovery
instructions. System capture still creates and validates the chosen tap or
ScreenCaptureKit stream, including the existing tap-to-SCK fallback. Those
operations report `starting_capture`, not a presumed permission prompt or
permission grant. Only `ready` marks capture as started.

macOS will prompt once, attributed to the app that launched the engine (your
terminal during development, the desktop app in production):

1. **Microphone** — prompted when the mic tap starts.
2. **Screen & System Audio Recording** — prompted by ScreenCaptureKit. If the
   run fails right after you grant it, quit and reopen the terminal and rerun
   (macOS applies this permission on process restart).

## Event protocol (NDJSON on stdout)

One JSON object per line; `event` discriminates. Diagnostics go to stderr —
**but CoreML occasionally prints non-JSON noise to stdout**, so consumers must
try/parse each line and skip failures.

| event | fields | meaning |
|---|---|---|
| `status` | `stage`, optional `channel`, `model`, `permission` | lifecycle: `loading_models`, `requesting_permission` (actual first-use mic consent), `starting_capture`, `finishing` |
| `download` | `progress` 0..1 | model download progress (whole-percent steps) |
| `ready` | `model` or `channels`, `mode` | models loaded, work begins |
| `channel_start` | `channel`, `epochMs` | live: wall-clock anchor for the channel's token timeline (first audio buffer) |
| `partial` | `text`, `channel` (live only) | growing transcript for one channel |
| `timings` | `tokens` [{`token`,`startSec`,`endSec`,`confidence`}], `channel` (live) | incremental per-token timestamps (stream/live) — the raw material for timestamped transcript segments |
| `final` | `text`, `channel` (live), `confidence`/`audioSeconds`/`processingSeconds`/`speedup` (file modes), `sessionSeconds` (live), `voiceGate` {`keptMs`,`droppedMs`,`failures`,`minDistance`,`maxDistance`} (live with --voiceprint) | end-of-run transcript per channel |
| `voiceprint` | `ok`, `speechSeconds`, `levelDb`, `deviceName`, or `reason` | enroll-voice verdict |
| `error` | `message`, optional `channel` | non-fatal errors carry on; fatal ones precede exit |
| `audio` | `path`, `durationMs`, `startEpochMs` | merged session audio saved (live with --audio-dir, and merge-audio); `startEpochMs` = wall-clock of the file's first frame, for transcript↔audio seek mapping |
| `done` | — | live session fully finished |

## Verified results (2026-07-04, M-series, macOS 26.5)

- `transcribe` (TDT v2): word-perfect on a 15.7s synthesized meeting intro,
  confidence 0.99, **120x realtime** cached.
- `stream` (Unified): 15 growing partials, near-perfect final, **31x realtime**.
- `live`: compiles; awaiting first interactive run (needs permission prompts).
