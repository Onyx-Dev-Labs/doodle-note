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

## Commands

```sh
engine transcribe --file meeting.wav [--model v2|v3] [--timings]
    Batch transcription, highest quality (Parakeet TDT). Used for the
    post-meeting final pass and file uploads. ~120x realtime when cached.
    --timings attaches per-token timestamps to the final event.

engine stream --file meeting.wav [--realtime]
    Feeds a file through the live streaming engine (Parakeet Unified) in
    0.25s chunks — same code path as live capture. Emits growing partials.

engine live [--source mic|system|both] [--seconds N] [--aec off]
    Live two-channel capture + transcription:
      mic    → "You"   (AVAudioEngine input tap)
      system → "Them"  (ScreenCaptureKit system audio — the other side of the call)
    Runs until --seconds or SIGINT/SIGTERM. Speaker separation between you and
    the far side comes from the capture topology, not diarization.

    Echo isolation: when the call plays through speakers, the mic physically
    hears the far side. Apple's Voice Processing I/O (the FaceTime echo
    canceller) is enabled on the mic by default — it subtracts the speaker
    signal from the mic input; audio ducking is disabled so meeting volume is
    unaffected. `--aec off` disables it for A/B comparison. The system channel
    is a digital tap and is always clean. Residual bleed gets removed at
    segment-build time via cross-channel token-timestamp dedup (planned).
    Headphones make isolation perfect regardless.

engine info
    Reports model cache locations and download state.
```

## First-run permissions (live)

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
| `status` | `stage`, optional `channel`, `model`, `permission` | lifecycle: `loading_models`, `requesting_permission`, `capturing`, `finishing` |
| `download` | `progress` 0..1 | model download progress (whole-percent steps) |
| `ready` | `model` or `channels`, `mode` | models loaded, work begins |
| `channel_start` | `channel`, `epochMs` | live: wall-clock anchor for the channel's token timeline (first audio buffer) |
| `partial` | `text`, `channel` (live only) | growing transcript for one channel |
| `timings` | `tokens` [{`token`,`startSec`,`endSec`,`confidence`}], `channel` (live) | incremental per-token timestamps (stream/live) — the raw material for timestamped transcript segments |
| `final` | `text`, `channel` (live), `confidence`/`audioSeconds`/`processingSeconds`/`speedup` (file modes), `sessionSeconds` (live) | end-of-run transcript per channel |
| `error` | `message`, optional `channel` | non-fatal errors carry on; fatal ones precede exit |
| `done` | — | live session fully finished |

## Verified results (2026-07-04, M-series, macOS 26.5)

- `transcribe` (TDT v2): word-perfect on a 15.7s synthesized meeting intro,
  confidence 0.99, **120x realtime** cached.
- `stream` (Unified): 15 growing partials, near-perfect final, **31x realtime**.
- `live`: compiles; awaiting first interactive run (needs permission prompts).
