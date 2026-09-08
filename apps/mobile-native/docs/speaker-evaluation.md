# Streaming speaker integration

This is an experimental native integration, not an accuracy claim or completed speaker-identification feature.

## Reproducible inputs

- FluidAudio source: revision `5c19d5e12320e22bbfb7a1877b089d2665a69add` of https://github.com/FluidInference/FluidAudio, pinned in `project.yml`.
- Core ML artifact: `Sortformer_v2.1.mlpackage` at revision `ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1` of https://huggingface.co/FluidInference/diar-streaming-sortformer-coreml.
- The bundled manifest lists the exact four package files, sizes, and SHA-256 digests. Total download is 240,139,774 bytes. Accidental nested packages present upstream are excluded.
- Runtime configuration is `fastV2_1`; embedded model metadata must match chunk length/context, FIFO, and speaker cache configuration. Every model file is rehashed before use.

The download is explicit, cancellable, staged, and validated before installation. Audio is never uploaded by this integration. An independent bounded stream feeds an actor that executes Core ML. Failed or slow speaker processing reports a visible error and leaves the source recording and Apple transcription running. A finalization timeout requests cancellation, but cannot forcibly interrupt an in-flight Core ML call.

## Labels and names

Four anonymous speaker slots are supported per session. Live labels can change as the timeline finalizes. Confirmed names survive revised turns within a session and are not copied onto a different slot. Overlap uses the same 10%/65% coverage gate as transcripts, summaries and exports. Uncertain matcher abstentions display as “Uncertain speaker” rather than a guessed name.

Optional remembered voices are stored only under `VoiceProfiles/`, with complete-until-first-unlock protection and exclusion from iCloud backup, notes sync, initial archive copies and generation payloads. Recording works with an empty profile catalog. Matching uses cosine similarity with conservative open-set rejection (accept ≥ 0.82 and margin ≥ 0.10). These thresholds follow the ONY-241 feasibility proposal; they are not a physical-device accuracy claim. Calendar invitees remain name suggestions and never enter the matcher. Uncertain or corrected-away speech does not update a saved profile.

The passage join unions intervals per speaker. Two speakers each covering at least 10% of a passage yield “Multiple speakers”; a single speaker requires at least 65% coverage to receive a label. Otherwise the passage stays unassigned. Word-level splitting and overlapping-speech quality on real meetings remain physical qualification work.

## Evidence and remaining gates

The exact downloaded model passed size and SHA-256 checks, compiled, loaded with matching embedded configuration, and processed two seconds of synthetic silence through the actual engine in a simulator test. This only verifies execution and frame progression. It does not establish attribution, speech accuracy, latency, memory, battery, or thermal behavior with real meetings.

The opt-in test `SpeakerTests/testPinnedModelProcessesSyntheticAudioWhenProvided` reads `DOODLENOTE_SPEAKER_MODEL` in the test-runner environment. Point it at a complete verified `.mlpackage` directory. Normal CI skips that one test and does not download the model. Unit tests separately exercise label rules, session-scoped naming, hash rejection, preservation of recorded audio when a bounded speaker consumer overflows, three/four-speaker overlap, false-match/unknown rejection, profile removal and serialization boundaries.

Authorized known/unknown speaker sessions in five languages, live labels, and subsequent-meeting matching on physical iPhone and iPad remain ONY-265.

## Licensing before distribution

FluidAudio's Apache 2.0 license is included in app resources. The converted model card declares CC BY 4.0, while the NVIDIA upstream model declares the NVIDIA Open Model License. Source and license links are recorded in `Resources/ThirdParty/Model-NOTICE.txt`. The relationship between those notices and redistribution obligations must be reviewed before shipping the downloadable artifact. Inventory and include applicable notices for the complete dependency graph before distribution. No app release or model republishing is part of this checkpoint.

Sources: [FluidAudio](https://github.com/FluidInference/FluidAudio), [converted model](https://huggingface.co/FluidInference/diar-streaming-sortformer-coreml), [NVIDIA terms](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
