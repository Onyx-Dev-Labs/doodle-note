# DEV507 paired relevance diagnostic — do not adopt

**The one-sentence treatment did not demonstrate reliable or material overall grounding improvement. Parent decided not to adopt it in production.** Both arms remain diagnostic observations with stochastic limits. Production, parser, schema and feature gates are unchanged; no further experiment is authorized by this run.

All 12 sampling attempts completed once, with **12 strict structural/current-policy admissions, 0 parser/runtime failures, 0 timeouts, 0 cancellations and 0 unperformed entries**. These are not 12 correct answers. Three outputs abstained despite the requested fact being present on the actual wire: CONTROL Coral, TREATMENT Juniper and TREATMENT Coral. The two arms each produced 43 claims, 86 total. All raw/admitted claims and cited original ranges are retained. No designated-human semantic scoring or frozen-100 acceptance was performed.

## Fixed comparison and preservation

Evidence starting HEAD: `ffa54854564ab9ad1b1fc21e844c4a18c92b7b15`; production remains byte-identical to `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8` in `apps/` and `packages/`. Both arms ran actual `LocalNotesEngine` and `MainCitedAskService` with the actual original-source APIs in a standalone synthetic runner. This does not qualify the Electron UI or worker IPC path. CONTROL used an exact source copy; TREATMENT used an external QA copy with exactly this sentence added after the existing fewest-distinct-supported-claims sentence:

> Only treat evidence as conflicting when it makes incompatible statements about the same subject and the same attribute asked about.

[The exact source diff](treatment.diff), [frozen plan](PLAN.md), [predeclared qualitative rubric](RUBRIC.md), initial 12-entry ledger, source/arm hashes and observer/launcher were frozen before native work. Native sampling order was CONTROL six, then TREATMENT six, each in this order: answer-04, answer-06, must-03, must-09, answer-01, answer-02. Each entry is a separate new attempt; there were no retries, best-of choices, output repair or substitutions at the native/adapter boundary.

The only prompt difference is the sentence above. It was compiled into the external source overlay **before** normal production wrapper token accounting; final system text was never intercepted or edited after budgeting. Schema, selected input, source identity/bytes, temperature, output limit and parser stayed identical. No seed option was added: one stochastic observation per case/arm and fixed arm order do not establish causality or a universal prompt effect.

Historical evidence remains separate and byte-identical: native79 has 33 unique cases, 8 valid, 25 failed and 67 unperformed, plus its interrupted attempt; the earlier six fd363c8 diagnostics also remain unchanged. None of the new 12 entries replaces those failures or fills their acceptance denominator. Frozen corpus SHA256 is `0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2`; original rubric SHA256 is `782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777`.

## Actual-tokenizer preflight

All 12 preparations passed before the first sampling call. Each preparation ran the actual service's selection/resolution and actual engine/model/context/session tokenizer, built the production arm prompt/schema, then intentionally returned the documented `QA_PREFLIGHT_ONLY_NO_SAMPLING` sentinel. The service drains that preparation as `model-failed`; these expected sentinel records are preparation, not failed native answer attempts. `promptWithMeta` was never called during preflight.

Selected generation inputs, final range IDs/quotes/order/anchors/start/end/parent IDs, serialized user text, omitted IDs, completeness, schema and native public GBNF matched the previous six cases exactly. CONTROL system and wire token hash also matched the previous six exactly. TREATMENT added 21 tokens in each case. The actual sampling boundary reproduced the frozen preparation wire and supplied the actual grammar object from the same current runtime as the model.

| Case | Input tokens CONTROL / TREATMENT | Remaining after 4096 output + 256 margin | Included ranges / prompt omissions |
| --- | ---: | ---: | ---: |
| answer-04 | 2208 / 2229 | 9824 / 9803 | 7 / 0 |
| answer-06 | 2206 / 2227 | 9826 / 9805 | 7 / 0 |
| must-03 | 11955 / 11976 | 77 / 56 | 19 / 4 |
| must-09 | 11964 / 11985 | 68 / 47 | 23 / 0 |
| answer-01 | 1255 / 1276 | 10777 / 10756 | 7 / 0 |
| answer-02 | 4292 / 4313 | 7740 / 7719 | 24 / 0 |

The treatment caused no additional omission or shortening. Existing must-03 prompt omissions and all other ranges, including any existing trimming, were preserved exactly. Gold was on the actual wire in all 12 calls. This proves inclusion for these captures, not semantic use or exhaustive semantic retrieval.

## Uniform AGENT inspection of every pair

[agent-inspection.json](agent-inspection.json) applies the frozen rubric to every one of the 86 claims, with named claim IDs, observations and explanations. `claim-source-pairs.json.gz` preserves each raw claim, admitted claim and full cited range/original path/hash. `originals.jsonl.gz` contains all 701 synthetic originals plus their canonical marker. Tags overlap; they are not an automated entailment score. The following includes regressions as well as improvements.

| Pair | CONTROL | TREATMENT | Observed delta |
| --- | --- | --- | --- |
| Willow action, answer-04 | conflicting-evidence, 3 claims. Correct action mixed with Onyx/Fern/Beryl references as a false conflict; unrelated variance/code. | answered, 7 claims. Correct Willow quotation/paraphrase, other-project quotations, variance, and c7 falsely says the action is unspecified. | False-conflict status removed, but relevance remains poor and an explicit false-absence claim appears. No focused reliable answer. |
| Juniper experiment, answer-06 | conflicting-evidence, 12 claims. Explicit 12/15 is followed by denial, false absence and variance/archive confusion. | insufficient-evidence, 0 claims, despite the same explicit 12/15 on wire. | Hallucinated claims are replaced by an unjustified abstention; requested answer is lost. Not a quality pass. |
| Saffron code, must-03 | answered, 12 claims. Correct code plus unsupported dataset-wide no-other-mention/no-contradiction claims citing other archives. | answered, 12 claims, all cite correct old-03; eight identical paraphrases and two admitted exact quotations. | Narrow grounding improvement: unsupported absence removed. Severe repetition remains and exact excess copies increase. No fewest-distinct-claims qualification. |
| Coral code, must-09 | insufficient-evidence, 0 claims despite explicit synthetic-09. | insufficient-evidence, 0 claims despite the identical code. | No improvement; both abstentions are unjustified by these included originals. |
| Maple date, answer-01 | answered, 4 claims. Raw c2–4 say Maple while citing Quartz/Opal/Garnet; intended quotation substitution displays those actual other projects. | answered, 12 claims. Other projects are named correctly, but c6/c12 claim cross-project evidence corroborates Maple; extra variance/archive and unsupported independence statements. | Raw quotation attribution improves; admitted irrelevant claims expand and unsupported generated generalizations appear. |
| Cobalt budget, answer-02 | answered, 12 claims. Correct budget repeated six times, other-project budgets and real but irrelevant variance dispute. | answered, 12 claims. Same irrelevant material; c7 now states the4200 budget as conflict citing **only** variance40/60 originals. | Adds unsupported cross-attribute attribution/false budget conflict. Seven identical budget texts include that wrongly supported claim. |

A real 40/60 variance disagreement is distinguished from a false disagreement about action/budget/date. Other-subject quotations can be exact original text and still be irrelevant. Raw quotation labels are distinguished from admitted text: production intentionally substitutes exact original text for quotation-kind. No quotation parser change or output repair was used.

Exact text repetition uses trimmed, case-sensitive text, separately for raw and admitted claims:

| Arm | Raw repeated-text groups / excess copies | Admitted groups / excess copies |
| --- | ---: | ---: |
| CONTROL | 5 / 11 | 4 / 11 |
| TREATMENT | 3 / 16 | 3 / 14 |

Fewer groups did not mean less repetition. No pair produced a fully focused, distinct, supported answer under this AGENT inspection; Saffron treatment is grounded but heavily redundant. That is a bounded qualitative observation, **not a designated-human score or a new acceptance threshold**. These six answerable cases cannot qualify true-conflict, unanswerable, alias/pronoun or DEV509 Brief behavior. Prompt-versus-model causation remains unproven.

## Native boundaries, elapsed time and cleanup

Approved model only: `/private/tmp/dn230-inference-AHCmaZ/QAmodelcache/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`; SHA256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`, 2,497,281,120 bytes, mode0444, inode2650967, mtimeNs1792333550535754478. Exact pre/post records match. No model copy, lookup, download or fallback. Pinned node-llama-cpp3.20.0, prebuilt llama.cpp b10361, Metal, QwenChatWrapper, context16384, temperature0.3, output4096, margin256. The prior approved Seatbelt policy and clean synthetic environment were reused; its denied outside-root sentinel assertion passed. No Electron, personal app/profile, accounts, calendar, keychain or devices were accessed.

Raw root: `/private/tmp/dev507-native-pair-yfv7dzer`. Actual native `responseText` and `stopReason` were captured before forwarding and equal resulting `rawJson` byte-for-byte in all12. Actual runtime-created grammar object identity, public schema/GBNF/hash, final enum, full wire tokens/hash, runtime/wrapper and token-meter deltas are retained. Every stop reason was `stopGenerationTrigger`; this generic value does not identify its specific grammar/wrapper trigger. No sampler/logit trace or fixed seed is available. The model's control-token override warnings are retained in stderr, not hidden.

| Case | Total seconds CONTROL / TREATMENT | Native prompt seconds C / T | Native output tokens C / T |
| --- | ---: | ---: | ---: |
| answer-04 | 19.281 / 27.221 | 17.769 / 25.765 | 773 / 1172 |
| answer-06 | 40.498 / 5.160 | 40.042 / 4.707 | 2048 / 25 |
| must-03 | 114.393 / 90.558 | 113.572 / 89.777 | 3300 / 2157 |
| must-09 | 31.917 / 34.865 | 31.252 / 34.204 | 22 / 22 |
| answer-01 | 13.470 / 47.446 | 13.042 / 46.962 | 652 / 2400 |
| answer-02 | 49.444 / 50.553 | 48.924 / 50.014 | 2051 / 1918 |

These are diagnostic elapsed times including observer/fsync overhead, not an isolated performance comparison. Per-case run/admission/adapter-generation/grammar/drain/source-operation timings are in summary and full evidence. Admission took about42–68ms; grammar wrapper timings about7.42–9.73ms include instrumentation. Each captured run plus admission recorded three retrieval passes and three manifest-validation passes; combined manifest-validation time was about63–100ms on this701-original fixture. This does not resolve the separate10k six-pass end-to-end concern or change the failed1k relative-latency gate.

Each preparation/call had a180s AbortSignal and awaited service cancellation/context disposal. The40min owned-process watchdog was unused. Model disposal completed between arms/phases and after the last call. Entire native child elapsed539.905s, exit0, no signals/forced termination. PID90121 and its owned process group were confirmed absent. Pre/post model integrity, both originals/marker copies,1483 frozen plan/runner/arm files,708 prior-root files and961 tracked source/evidence files passed. Production apps/packages remain unchanged.

## Packet and verification

- `evidence.jsonl.gz`: all12 complete raw records, SHA256 `1196ff4c1a4bd61e714185e3b45b1234fe12a7958861060c8be6a46142d9765c`.
- `claim-source-pairs.json.gz`: all86 raw/admitted pairs and full cited ranges, SHA256 `3b5baafce2006b1394dc8f6678d983c7a876fd8b1a1a2e70449f54af3236fd1f`.
- `preflight.jsonl.gz`: all12 actual-tokenizer preparations, including schemas, public native grammars, wire arrays and expected sentinel results.
- Freeze SHA256 `111df06d856f17e8ea1216e247ba7d6820ac3757b5936ebc836c50827e3fabb3`; runner bundle SHA256 `db3969e1d523210ee854c0035da130bd4ccf6922e6d7338f748fa897f705a015`. Full source/diff/launcher provenance is in `provenance.json` and compressed freeze/arm manifests. Offline inspection scripts were added after sampling and are separately hashed in MANIFEST.
- `originals.jsonl.gz` preserves one byte-identical canonical source copy; per-arm hashes verify the other. `arm-sources.jsonl.gz` plus exact bundle preserve the external variant. The approved model/helper executable is not embedded; its hash is recorded.
- `summary.json`, `events.json.gz`, `stdout.txt`, `stderr.txt`, pre/post integrity records and `process-exit-proof.json` preserve the full accounting and cleanup evidence.

Offline commands executed after clean native exit (no native imports, model loads, broad software suites or benchmarks):

```sh
python3 /private/tmp/dev507-native-pair-yfv7dzer/collect-inspection.py
python3 /private/tmp/dev507-native-pair-yfv7dzer/annotate.py
python3 /private/tmp/dev507-native-pair-yfv7dzer/verify-artifacts.py
```

Artifact checks passed for all12 native/adapter/wire/schema/current-admission/cleanup records and all preserved files. They do not certify factual entailment. The scoped Git whitespace check reports one trailing space at treatment.diff line10: this is the verbatim unified-diff blank context separator, deliberately preserved to retain the frozen diff hash. It is an artifact-only check result, not a production-source failure; no broad software checks were rerun. MANIFEST hashes every committed packet member except itself. Compression is transport only; raw native strings are unchanged. No production patch, parser relaxation, schema alteration, corpus/rubric retuning, subsequent sampling or performance run occurred.

## Decision and remaining gates

Parent explicitly decided **do not adopt the sentence** after the completed comparison. The existing feature gate stays **OFF**. Quality remains failed/incomplete; designated-human scoring, full frozen acceptance, installed/native UI/media/Windows gates, human/codeowner review and the failed1k relative latency remain. No merge, release, version bump or publication is authorized here. Parent will independently inspect this packet before selecting any next direction.

Check this: decompress the packet and inspect all six pairs, including the three explicit-gold abstentions and Cobalt treatment claim7; compare raw and admitted quotations; verify exact preflight/final inclusion and token headroom; verify MANIFEST and model/process integrity records. These are offline review checks, not authorization to rerun the native launcher.

Stack remains [PR230](https://github.com/Onyx-Dev-Labs/doodle-note/pull/230) → [PR233](https://github.com/Onyx-Dev-Labs/doodle-note/pull/233) → [PR232](https://github.com/Onyx-Dev-Labs/doodle-note/pull/232), unmerged and unwatched. Delivery record: [DEV507](https://app.notion.com/p/3fcf0f846ee481188183ce7e9f4f8ff7), Sean accountable, In Review; native Verification select is not reconfirmed through page fetch.
