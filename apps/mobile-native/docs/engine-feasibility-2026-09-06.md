# ONY-241: engine and device feasibility decision record

Date: 2026-09-06. Base: `main` at `a99ccec9192d8476ff0ece7924438cbe3403928a` (PR #124).
Status: **Proposed architecture; partial research and harness evidence. No supported-device commitment.** Physical human-speech measurements, alternative execution, complete distribution inventory and owner acceptance remain open. The approved five-language, live-speaker, remembered-voice, Pencil and offline-intelligence scope remains intact.

## Recommendation and alternatives

Keep the current independent SwiftUI recording/Pencil slice as the evaluation vehicle. Evaluate Apple SpeechTranscriber + existing pinned Sortformer first; evaluate Apple on-device Foundation Models for generation and a local full-history lexical index for retrieval. Preserve original passages for citations. Add an embedding candidate only after lexical baseline probes establish the gap. Do not change production engines in this research PR.

[Apple SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber) directs checking hardware availability and supported locales at runtime. The current app targets iOS 26. Do not infer a minimum iPhone chip from this deployment target or from Apple Intelligence eligibility. Capture `isAvailable`, `supportedLocales`, `installedLocales`, equivalent selected locale, asset installation result and offline recognition for every exact device/OS/language combination. Apple does not give this investigation sufficient verified evidence for a fixed SpeechTranscriber device floor.

[Apple Intelligence requirements](https://support.apple.com/en-us/121115), published July 7, 2026, list iPhone 15 Pro models and iPhone 16 or later, and iPad mini A17 Pro or M1-and-later iPads. They list all five launch languages for 26.1, with feature/region qualifications. This makes iPhone 15 Pro and M1 iPad Pro reasonable **first physical evaluation targets**, not a promised floor. Sean's “iPad Pro 18.5” identifies software only; its chip and Pencil model remain unknown. Its current OS cannot run the iOS 26 foundation. No upgrade or device purchase is requested now.

[Foundation Models language guidance](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models) requires runtime language support checks. Probe source and output locale, model availability and asset readiness independently. Apple Intelligence being enabled or supporting a language broadly does not prove summary quality, framework support, retrieval or citation correctness. Prefer explicit on-device `SystemLanguageModel` evaluation; no private-cloud or external provider fallback is implied.

| Capability | First candidate | Comparison if unsupported or below threshold | Remaining decision |
|---|---|---|---|
| Live five-language ASR | Apple SpeechTranscriber | Multilingual Whisper through [whisper.cpp](https://github.com/ggml-org/whisper.cpp), whose project includes iOS and streaming examples; benchmark model sizes and incremental-final reconciliation | Exact artifact, sustained device cost and all five language results; do not use English-only weights |
| Live 3–4 speaker separation | Existing FluidAudio + Sortformer v2.1 | Different validated Sortformer context configuration; investigate [sherpa-onnx diarization](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html) for final-pass comparison | Offline diarization alone does not satisfy live labels; preserve live-label requirement if an alternative cannot stream |
| Remembered names | Explicit local enrollment + independently evaluated speaker embedding/matching | Compare embedding candidates supported by the chosen native inference engine | Sortformer session slots are not a validated cross-meeting identity model; calibrate open-set rejection, consent and removal before selection |
| Offline summaries/Q&A | Apple on-device Foundation Models | [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) evaluated with a native local runner, fixed quantization and bounded context | Its Apache-2.0 model card is a candidate source, not proof of Danish quality or mobile memory feasibility; pin before execution |
| Full-history retrieval | Local lexical index with language-aware tokenization and source passage IDs | Evaluate multilingual embeddings if semantic/inflection probes fail | Corpus covers all eligible history; exact counts/lists need structured/full-scope evaluation, not top-k summaries |

The [NVIDIA upstream card](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1) supports at most four slots, warns of non-English/noisy-domain degradation and potential degradation in very long recordings. Its reported speed was measured on an NVIDIA GPU and is not mobile evidence. Neither an acoustic model nor a vendor's long-form statement proves two-hour cross-language stability. Keep anonymous labels and uncertainty visible; calendar names cannot establish voice identity.

## Dated evaluation matrix

`Pending` means no physical result, not failure or support. Every row must be expanded into exact hardware identifier, OS build, engine/model pin, primary locale, installed asset state and raw artifact reference during evaluation.

| Evaluation device class / OS | Language | Live ASR | 3–4 speakers | Offline generation | Full-history retrieval | Concurrent Pencil |
|---|---|---|---|---|---|---|
| iPhone 15 Pro / 26.1+ candidate | English | Pending runtime + quality | Pending | Pending runtime + quality | Pending | N/A on iPhone; keyboard workload |
| Same | Danish | Pending runtime + quality | Pending | Pending runtime + quality | Pending | N/A |
| Same | Spanish | Pending runtime + quality | Pending | Pending runtime + quality | Pending | N/A |
| Same | French | Pending runtime + quality | Pending | Pending runtime + quality | Pending | N/A |
| Same | German | Pending runtime + quality | Pending | Pending runtime + quality | Pending | N/A |
| M1 iPad Pro / 26.1+ candidate | English | Pending runtime + quality | Pending | Pending runtime + quality | Pending | Pending physical ink/capture |
| Same | Danish | Pending runtime + quality | Pending | Pending runtime + quality | Pending | Pending |
| Same | Spanish | Pending runtime + quality | Pending | Pending runtime + quality | Pending | Pending |
| Same | French | Pending runtime + quality | Pending | Pending runtime + quality | Pending | Pending |
| Same | German | Pending runtime + quality | Pending | Pending runtime + quality | Pending | Pending |
| Sean's unknown iPad Pro / 18.5 | All five | Current app OS requirement unmet | Not tested | Not tested | Not tested | Hardware identity unconfirmed |
| Any older target / 26+ | All five | Requires separate probe | Requires separate benchmark | Apple eligibility may be absent; alternate local engine untested | Requires benchmark | Model-dependent |

Build/synthetic simulator evidence from the foundation remains in [validation.md](validation.md). It does not populate physical rows. Never restrict five-language UI to disguise missing processing support; readiness must state which capability is unavailable while local text/ink remain usable.

## Proposed acceptance thresholds for Sean's decision

These are **proposed product gates**, not measured baselines, approved promises or vendor statistics. Score each language and device separately, with a fixed held-out corpus and normalization policy. Review sample sizes and uncertainty before adopting them. Averages across languages must not hide one failing language.

| Area | Proposed gate | Required method |
|---|---|---|
| Final transcription | WER <= 15% clean, <= 25% noisy/conversational | Report edits/reference words per fixture and language, plus names/numbers review; adjudicated gold |
| Speaker separation | DER <= 15% clean, <= 25% noisy; overlap DER <= 35% | Zero collar, overlap included, global slot mapping; report miss/false alarm/confusion separately |
| Live feedback | p95 first text <= 3 seconds; p95 first speaker label <= 5 seconds | Speech-end to visible UI on monotonic clock; include revised-label rate and finalization delay |
| Remembered voices | Unknown-speaker false acceptance <= 1%; accepted-name precision >= 99% | Held-out enrollment/probe participants; denominators and uncertainty required, no enrollment leakage; abstain on ambiguity |
| Long recording | Complete 7,200-second source within one input-buffer tolerance; zero unexplained gaps, crash or lost edits | Frame accounting, persisted-file inspection and interruption recovery; do not equate wall time with audio duration |
| Resources | No critical thermal state or memory termination; <= 25 battery percentage points per two-hour unplugged run | Fixed brightness/power mode; peak and time-series memory, thermals/battery/storage; lower threshold may follow actual baseline |
| Retrieval | Recall@5 >= 90% on answerable probes; zero forbidden-library/Trash hits | Old notes and paraphrases in each language; exclude unanswerable probes from recall and score abstention separately |
| Generated text | >= 95% supported factual claims; zero invented action owner/date commitments; every citation resolves to original evidence | Fluent human review of six formats and Q&A, including conflicting notes and unknown answers |
| Ink | No lost strokes or typed edits through two-hour run/restart | Physical Pencil + keyboard concurrent workload, persistence and responsiveness observations |

Memory/storage ceilings require measured baseline before adopting numeric limits; do not claim 240 MB model weights equal runtime footprint. If a candidate misses a gate, run the comparison candidate on the same fixtures and document quality/resource tradeoffs before requesting a scope/device decision.

## Provenance and distribution assessment

The current [manifest](../Sources/Resources/SpeakerModel/manifest.json) pins converted repository `FluidInference/diar-streaming-sortformer-coreml` revision `ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1`, package `Sortformer_v2.1.mlpackage`, four file sizes/SHA-256 values totaling 240,139,774 bytes. The harness reverified all four locally on 2026-09-06. No weights are committed or republished by this PR.

| Component | Pinned evidence | Rights/inventory finding |
|---|---|---|
| FluidAudio | `5c19d5e12320e22bbfb7a1877b089d2665a69add` in project.yml | Apache-2.0 root license is bundled. Upstream license SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| Sortformer Core ML | Manifest revision and four hashes above | Pinned card declares CC BY 4.0 and names NVIDIA base; conversion contributor attribution also exists. This is not evidence that upstream terms disappear |
| NVIDIA source weights | Upstream model card names v2.1, but exact source checkpoint digest/conversion reproducibility not established | Requires complete lineage record before redistribution approval |
| NemoTextProcessing binary | [Pinned Package.swift](https://github.com/FluidInference/FluidAudio/blob/5c19d5e12320e22bbfb7a1877b089d2665a69add/Package.swift) references v0.3.0 XCFramework; checksum `76d0ee9a32b1ee2193231299180ca9bc4fc7e98794e771b3d55d66498352d85f` | Inventory binary and embedded notices, source dependencies and bundled data; root package license alone insufficient |
| FastClusterWrapper / MachTaskSelfWrapper / TTS resources | Same pinned Package.swift includes these targets/resources even though the app uses diarization | Complete included-file copyright/license inventory remains open; verify actual linked/bundled output |
| Alternative ASR, generation and embedding artifacts | Not selected/downloaded by this spike | No production pin or distribution approval; capture exact revision, quantization/conversion recipe and digest before benchmarks |

Engineering interpretation for review: [NVIDIA's current terms](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) permit commercial use and derivative distribution subject to conditions, require recipients receive the agreement and attribution notice, and allow derivative terms while preserving upstream compliance. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) requires attribution, license linkage and change disclosure and does not grant every possible right. Treat the conversion and upstream obligations cumulatively pending confirmation; do not relabel the entire model as simply CC BY or infer a clean license from a Hugging Face tag.

**Distribution remains uncleared.** Before ONY-241 can close, attach the exact upstream checkpoint/conversion lineage, complete binary/resource notice inventory, applicable license texts in the delivery package, and accountable rights review of the combined obligations and distribution channel. Existing Model-NOTICE contains links, not the complete NVIDIA agreement. This is a specific unresolved acceptance criterion, not a claim of infringement or a release permission request. No permission change, paid service, model republishing or external speech transfer occurred.

## Evidence and next handoff

- Verified: scorer regression suite; synthetic expected-score example; exact existing model file hashes. [Harness and corpus protocol](../Benchmarks/README.md) contains commands, scoring definition, privacy boundaries, run identity, physical measurements and consented collection plan.
- Not run: physical iPhone/iPad, authorized human speech, two-hour integrated session, all five framework locale probes, actual generation/retrieval alternatives, identity calibration. The synthetic fixture is not a test corpus substitute.
- Native app source is unchanged. Dedicated Native mobile CI runs the added scoring tests and existing simulator checks; CI result must be attached to the PR, never inferred from local Python results.
- Keep ONY-241 incomplete until required QA and distribution evidence exist and the reviewed artifact merges. ONY-243/244/247 remain dependent under their current contracts. ONY-242 can progress independently. Do not silently waive physical acceptance to unlock them.

Check this:
1. Run the README synthetic command; observe the documented error scores and false release flag. Change an expected/assigned identity pair; identity errors must remain distinct from permutation-invariant speaker separation.
2. Run the hash command against the already downloaded package; four files should verify. A locally copied file with one byte changed must fail without printing recording content.
3. Review proposed thresholds and candidate devices against the approved v1; no language or live-label requirement has been removed. Assign fluent/device QA when hardware and authorized corpus are available, without requiring Sean's iPad today.
