# Mobile feasibility benchmark protocol

ONY-241, 2026-09-06. This is an offline scorer, not an engine runner or a completed device benchmark. The committed example contains invented text/timings, not captured speech. No private recordings belong in this repository, CI artifacts, PRs, or Linear.

## Reproduce the verified harness checks

From the repository root, with Python 3.10+ (standard library only):

```sh
python3 -m unittest discover -s apps/mobile-native/Benchmarks -v
python3 apps/mobile-native/Benchmarks/score.py score apps/mobile-native/Benchmarks/synthetic.json
python3 apps/mobile-native/Benchmarks/score.py verify-artifacts \
  apps/mobile-native/Sources/Resources/SpeakerModel/manifest.json \
  /path/to/Sortformer_v2.1.mlpackage
```

The synthetic example must report WER 0.25, DER 0.2, overlap DER 0.5, and `release_qualified: false`. All reports deliberately retain that false flag, including physical inputs: scoring alone does not establish corpus consent, provenance, device telemetry, thresholds, human QA, or rights clearance. The hash command checks only listed files and does not certify licensing or unlisted package contents. It performs no downloads.

## Input contract and methods

Copy `synthetic.json` into an approved private evaluation folder outside Git. Replace invented data with an authorized run and set `evidence_kind` to `physical-human-speech`. Add nonempty `consent_reference`, `device_model`, `os_build`, `app_commit`, `engine_versions`, `raw_artifact_reference`, and `measurement_method`. These are operator attestations, not independently verified facts. Preserve a separate private SHA-256 manifest for audio, gold labels, hypotheses, runtime probes, telemetry, and outputs. Record original sample rate, duration and source-clock origin. Hash the complete model manifest too. The scorer prints aggregate scores, duration and a canonical-input SHA-256, never transcripts or participant names. Keep each report paired with its private input and telemetry sidecar; the digest is SHA-256 of UTF-8 JSON serialized with sorted keys, ensure_ascii=False and allow_nan=False using Python default separators. It is a link to the exact input metadata/payload, not a hash of the raw JSON file. Never publish private input digests without the corpus owner’s authorization.

- `language`: one of `en`, `da`, `es`, `fr`, `de`. One primary recording language.
- `reference_text` and `hypothesis_text`: finalized transcript strings. WER uses NFC Unicode normalization, case folding, punctuation removal and word-token Levenshtein edits via an exact Myers bit-vector algorithm. Regression tests compare 300 random cases to independent dynamic programming and score an 18,000-word synthetic transcript; this size is a workload probe, not recorded two-hour audio. Accents remain significant. Numbers/contractions are not semantically normalized. Keep raw text and review normalization effects, especially compounds, names and Danish numbers. Empty reference returns null WER plus insertion count; do not average that away as zero.
- `reference_segments`, `hypothesis_segments`: arrays of `{start, end, speaker}` in seconds on the same original-audio clock. Use pseudonyms. Positive half-open intervals must lie within `duration_seconds`. At most four identities each. Repeated intervals for one identity are unioned.
- DER uses exact boundary intervals, zero collar, overlap included, globally optimal one-to-one speaker permutation across the entire session. Denominator is reference speaker-seconds, including simultaneous speakers. Miss, false alarm and confusion components are reported; silence has null DER with false-alarm seconds. `overlap_der` scores only regions with more than one reference speaker. Do not compare against vendor scores using a different collar or overlap policy. Global mapping deliberately exposes identity swaps later in the meeting.
- `transcript_latency_seconds`, `speaker_latency_seconds`: event samples measured from the end of the corresponding speech interval to first visible text/label using a monotonic clock mapped to the audio origin. Score live snapshots separately from final output. Report both label revisions and finalization latency in the private run record. Percentiles use nearest rank. Missing arrays yield null, never zero. Model buffer latency is not end-to-end UI latency.
- `identity_decisions`: `{expected, assigned}` for distinct enrollment/probe turns. Null means unknown or abstention. No permutation is allowed. Report denominators, wrong accepted identities, unknown false accepts and abstentions separately; correct clustering is not recognized identity. Use held-out speakers/recordings, never enrollment clips as evaluation probes.
- `retrieval_probes`: `{relevant_ids, retrieved_ids, forbidden_ids}`. Scorer returns macro recall@5 over queries with gold relevant passages and forbidden hits across the entire returned list. Exclude genuinely unanswerable queries from recall and manually score abstention. Include old notes, typed-note/transcript conflicts, deleted/Trash records, another library, unavailable cloud-only content, and exhaustive-list questions. A relevant passage ID alone does not establish answer faithfulness or citation entailment.

Resource measurements are intentionally not invented or inferred by the scorer. Keep a companion device log with monotonic timestamps and units: resident/physical footprint from Instruments, ProcessInfo thermal state transitions, battery percent before/after with charging state, free disk before/after, persisted audio frame count/bytes, dropped-buffer counts, locale/model availability and installation status. Record brightness, power mode, network state, audio route, ambient conditions and concurrent Pencil/keyboard actions. Compare unplugged runs at fixed brightness; Simulator results are invalid for these metrics. Record peak plus 10-minute samples; never call stable memory from only start/end readings.

## Corpus to collect with consent

No human audio corpus has been collected. The following is the collection protocol, not an available fixture inventory:

1. For each of five languages, record separate three-person and four-person conversational sessions. Include 10 minutes of clean near-field speech, 10 minutes of room/distant/noisy speech, and a continuous two-hour integrated baseline on each proposed minimum iPhone and iPad. Do not loop a short clip to represent a two-hour human meeting. Use the same authorized source for candidate comparisons; disclose replay versus live-room capture.
2. Include interruptions and overlap, a quiet speaker, returning speakers after long silence, names/numbers, supported accents, explicit decisions, uncertain plans and unassigned actions. Keep one selected primary language per run. Separate enrollment from evaluation and include unseen speakers to measure false acceptance.
3. Have a fluent reviewer prepare verbatim text and time-aligned pseudonymous intervals, with a second reviewer adjudicating uncertain/overlapping speech. Keep consent, participant linkage and raw audio in restricted storage. Version gold annotations and record reviewer/annotation policy; do not send speech to external ASR for ground truth.
4. Capture app output at reproducible checkpoints and finalization, plus device telemetry. Run Pencil on iPad concurrently with speech/speakers. Exercise screen lock, route change, permission denial, airplane mode, interruption, low-storage stop and restart recovery in separate failure runs so errors are not hidden inside clean accuracy averages.
5. For each language, add human-reviewed summary and Q&A probes over all six formats, source/output language overrides, withheld facts, false premises and older-library details. Score supported factual claims, owner/date correctness, original-source citation entailment, retrieval scope and explicit abstention. These need human review, not only string matching.

## Evidence status

As of 2026-09-06, harness unit tests and four pinned Sortformer file hashes pass locally. Physical iPhone/iPad runs, two-hour telemetry, real speech scoring, known-voice calibration and generation/retrieval candidate execution are **not run**. Parent foundation simulator results establish build/synthetic execution only. See [decision record](../docs/engine-feasibility-2026-09-06.md) for proposed targets and unresolved gates.
