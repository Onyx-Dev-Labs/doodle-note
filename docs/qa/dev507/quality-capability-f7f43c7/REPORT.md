# Quality model capability diagnostic — relevance remains inadequate

2026-10-19 UTC. Production source is immutable **f7f43c7d8a898a61015650b44a218167c1dedf76**, current policy 3. This packet contains evidence only. **Do not treat the Quality model as a solution to cited-answer reliability or enable rollout.** It reduced verbosity and exact repetition in this small descriptive comparison, but still confused subjects/attributes and included unrelated answers. No further inference or tuning followed.

The completed third QA attempt made exactly **8 Gemma native calls once each: 8 strict/current admissions, 0 structural failures, 0 timeouts/cancellations, 0 unperformed**. These are structural outcomes, not eight answer-quality passes. All six requested facts appeared with supporting originals, but **none of the six failure-case answers was fully focused and sound** under the frozen agent-inspection rubric. The genuine-conflict and unknown-password controls behaved appropriately. No designated-human score, frozen100/Brief24 acceptance, causal model-size conclusion or release approval is claimed.

## Separate attempts and immutable lineage

| Attempt | Production | Actual native generations | Outcome |
| --- | --- | --- | --- |
| Original `/private/tmp/dev507-quality-annby45k` | fd363c81 / policy2 | 2 Qwen, 0 Gemma | Two historical sentinel results retained; first Gemma QA observer failed before generation, seven remaining entries unperformed. [Separate committed packet](../quality-aborted-fd363c8/REPORT.md), e047d4f558313737e23e62b9662e438a94db6c6a + e394cf069c695fda501ccf11a6bf608da660285f. |
| Second `/private/tmp/dev507-quality-successor-5ks880sv` | f7f43c7 / policy3 | 0 Gemma; 0 observer entries | Eight corrected native-tokenizer/grammar preflights passed. First sampling admission failed in QA before engine/native call: live optional `speaker: undefined` versus omitted persisted JSON key. One QA pre-generation failure, seven unperformed. Not a model-quality failure. |
| Third `/private/tmp/dev507-quality-third-ox_5jgyg` | f7f43c7 / policy3 | 8 Gemma | Eight fresh preflights, then fixed order once; all strict/current admissions. Full results below. |

No previous output was replaced or retried. No Qwen calls were repeated. Historical Qwen references are the original six fd cases plus the original two sentinel calls, in `historical-qwen-records.jsonl.gz`; their source-policy/family/wrapper/tokenizer and stochastic runs differ from this third attempt. Their separate denominators remain intact. Original79 33 unique /8 structurally valid /25 failed /67 unperformed and interrupted attempt, original fd six, and rejected relevance/order diagnostics remain unchanged.

## Reviewed production and QA repair boundaries

The parent read both full independent reports for e394cf069c695fda501ccf11a6bf608da660285f→f7f43c7d8a898a61015650b44a218167c1dedf76. Standards: zero findings, 6 wrapper/4 policy/5 observer checks and AI types; OLD4 Gemma/4 policy RED. Spec: zero actionable introduced findings, same controls plus6 actual-session-to-stub-Chat boundary probes and10 lifecycle/grammar checks. Copies in `review/`. These qualify the offline fix only; this packet supplies the separate native evidence.

Second attempt was correctly stopped on its first integrity failure. Its frozen runner/ledger/raw files remain byte-identical. The production service deliberately creates optional undefined speaker properties, and prompt serialization deliberately omits them. The second QA guard incorrectly compared runtime own-property presence to saved JSON.

Before another model load, the third QA runner replaced only two selected-input comparisons with `normalizeCitedInput`. It omits undefined **only at contract-optional `ranges[n].speaker`**. Other undefined, nonfinite numbers, BigInt, functions, symbol keys, nonplain objects, accessors/nonenumerable fields and sparse/extra array properties are rejected; defined values and order remain exact. Existing prior-input JSON normalization was also made strict. `third-native/runner-diff.patch` shows these changes. Reviewed observer bytes are unchanged.

Offline gate (`offline/`): exact captured second-attempt input with faithful optional undefined reproduces OLD failure; normalization tests pass with changed/removed defined speakers and factual/invalid-value controls. The full runner pre-generation/observer path executes real MainCitedAskService and original retrieval/validation, actual Gemma wrapper serialization, a captured-token oracle and an explicitly fake underlying response. OLD full path exits1; FIX **all8 fixtures +13 drift/error controls** pass, plus3 normalization test groups. Options/receiver/raw forwarding and current policy3 are checked. Fake outputs are outside native evaluation denominators. Initial offline fixture mistakes (overwriting defined speakers and invalid fake model identity) are retained as fixture errors, corrected before the passing gate; not production findings. No broad application suites were repeated.

## Native setup and provenance

Only retained catalog artifact:

- URI: `hf:unsloth/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf#d15e4c7dc21dc55d56bf8549db57a71ad8a2a35d`
- Path: `/private/tmp/dev507-quality-annby45k/model/gemma-3-12b-it-Q4_K_M.gguf`
- SHA256: **15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff**; bytes **7300778336**; mode **0444**; inode **4738223**; mtimeNs **1792420949861587642**. Exact pre/post equality verified for both successors. No redownload, copy, model lookup or fallback.

Third freeze SHA256 **a3d983ec5e64770e594c62c6a743a9e7ce4e379b99f024a27240609ff953d680**; bundle **80a1f9ca6ffeac59b555acb561269725e2a0aeda40e160bb81296a4d1f368a1b**; runner source **db9d8369064822dcb874b99bf29b64e77fc9780a8217ebd25ee81fae30952926**; strict QA normalizer **ed7425c975d349032fecdd726be790a751f0338562bc5c19f87e8ef9e68c762b**. Second freeze **4080064d960cd18a50b8f38d7f389af839ca79a8d95b58df3eca0fcde8bb7438**. Frozen corpus **0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2** unchanged; inherited qualitative definitions and explicit sentinel expectations frozen before sampling.

Actual LocalNotesEngine + MainCitedAskService, standard GemmaChatWrapper, public forceAddSystemPrompt=true, original system text and claim schema order, strict parser, policy3. node-llama-cpp3.20/prebuilt Metal b10361, build:never, context16384/temp0.3/output4096/margin256. No CPU fallback or reduced context. Actual wrapper instructions appeared exactly once. All8 final wire serialization/token arrays/hashes, user text, schema/GBNF and same-current-runtime grammar object matched preparation at sampling. Native responseText/stopReason were captured before exact forwarding; all rawJson equality checks passed. No repair, retry, best-of, seed or tuning.

Fresh synthetic HOME/TMP/originals, prior Seatbelt network/personal-data denial and approved Metal compiler lookup only. No Electron/app/profile/accounts/devices. Native stderr retains the model loader warning that token212 `</s>` was not control-type and its type would be overridden; no artifact changed or runtime fallback occurred. The ordinary production wrapper/runtime handled it. Per-case300s AbortSignal with awaited service/context cleanup; outer50min owned watchdog unused.

## Full-system inclusion

All eight actual-tokenizer/current-runtime-grammar preflights completed before sampling. All required gold remained on wire (eight gold spans across seven answerable/control cases; unknown has none). Selected service inputs/question/originals were identical to historical captures. Full-system budgets legitimately changed the two long cases; no corpus/input retuning.

| Case | Old invalid missing-system tokens | New full-system tokens | Included old→new | Headroom after4096+256 |
| --- | ---: | ---: | ---: | ---: |
| answer-04 | 1871 | 2185 | 7→7 | 9847 |
| answer-06 | 1867 | 2181 | 7→7 | 9851 |
| must-03 | 12031 | 12002 | 23→20 | 30 |
| must-09 | 12032 | 12006 | 23→20 | 26 |
| answer-01 | 927 | 1241 | 7→7 | 10791 |
| answer-02 | 3942 | 4256 | 24→24 | 7776 |
| conflict-01 | 2997 | 3311 | 24→24 | 8721 |
| unknown-01 | 803 | 1117 | 6→6 | 10915 |

For must-03, removed non-gold input ranges are answer-03 personal:0 and conflict-03-a personal:0 / conflict-03-b transcript. The old final conflict-03-b range was shortened to UTF16[0,2); its parent is now omitted. For must-09, the equivalents are answer-09 personal:0 and conflict-09-a/b; the old final conflict-09-b was UTF16[0,5). All other retained final ranges preserve exact IDs/quotes/anchors/offsets/order; no newly added ranges. `budget-deltas.json` records full parent/final IDs, source identities, quotes and omissions. The old missing-system preflight is **comparison evidence, not a valid fixed baseline**.

## Per-case outcomes and agent inspection

All raw/admitted claims and full cited originals are retained in `claim-source-pairs.json`, `cited-originals.jsonl.gz`, `synthetic-originals.jsonl.gz` and `agent-assessment.json`. This is uniform AGENT inspection, not a designated-human semantic score.

| Case | Structural/current result | Claims / output tokens | Observed elapsed | Qualitative finding |
| --- | --- | ---: | ---: | --- |
| answer-04 | Valid, conflicting-evidence | 2 /455 | 33.87s | Correct Willow action plus3 extraneous subjects; equal actions falsely labeled conflict. Unrelated variance claim. |
| answer-06 | Valid, conflicting-evidence | 2 /462 | 31.93s | Correct Juniper12/15 plus3 extraneous subjects falsely labeled conflict. Unrelated variance disagreement. |
| must-03 | Valid, answered | 4 /400 | 82.08s | Correct Saffron code;3 unrelated archive answers. Exact quotation replacement introduces long cited filler. |
| must-09 | Valid, answered | 2 /211 | 71.87s | Correct Coral code; unrelated Willow archive answer with long cited filler. |
| answer-01 | Valid, conflicting-evidence | 3 /429 | 25.13s | Correct Maple date falsely conflicted with variance40; two unrelated variance claims. |
| answer-02 | Valid, conflicting-evidence | 3 /482 | 41.83s | Correct Cobalt budget falsely conflicted with variance; two irrelevant variance claims falsely paired with equal Orchid values. |
| conflict-01 | Valid, conflicting-evidence | 2 /329 | 31.72s | Genuine Maple40/60 disagreement, both originals cited; no definitive value chosen. Appropriate sentinel response. |
| unknown-01 | Valid, insufficient-evidence | 0 /18 | 8.37s | Correctly abstains from inventing Quartz launch password. Appropriate sentinel response. |

Across18 claims:10 irrelevant claims;6 false-conflict claims;4 claims have extraneous other-subject citations. No solely-wrong-subject claim, false absence or adversarial instruction echo observed in these outputs. No raw/admitted exact-text repetition groups or excess copies. These observations are not proof of universal absence of those failure modes. Six raw quotation paraphrases are replaced with exact originals as designed; three admitted unrelated transcript passages include799 tree glyphs each (2397 total) plus closing filler. Zero exact claim repetition therefore does not mean concise display.

Historical Qwen reference counts are60 claims across its separate six+two captures versus18 here. Historical raw repetition4 groups/11 excess; admitted6 groups/18 excess versus0/0 here. Juniper false-absence assertions and Coral support-owner/code conflation disappear in this sample, and the true conflict is much less verbose. But all six Gemma answers retain unrelated content, and four falsely claim conflict about the requested fact. Maple/Cobalt top-level conflict labels are new versus historical Qwen answered status. The requested-value improvements and lower repetition do **not** establish consistent, meaningful grounded-answer reliability. Different family/training/tokenizer/wrapper, effective policy and stochastic samples prevent size-only or causal attribution.

## Timing, cleanup and limits

Third launcher elapsed354.50s including sequential preflight/cold loads and eight calls. Per-case totals above include service/admission; actual generation spans8.15–81.68s, final admission49–74ms, grammar compilation7.8–10.1ms. Full recorded source work remains three retrieval and three manifest-validation passes per completed service run/admission, not a one-retrieval responsiveness result. These are observed diagnostic times, **not isolated performance gates**. Sampled process RSS maximum10197975040bytes is not peak GPU/unified memory or battery qualification.

Third:16 models/16 contexts created and disposed,8 service cancels drained, native PID25340 absent, exit0, no watchdog/forced termination. All701 originals plus canonical marker unchanged;1234 tracked source/evidence files,6064 prior-root files and754 frozen entries checked. Model SHA/size/mode/inode/mtime unchanged. Second:8 models/8 contexts disposed, PID absent, exit0 with explicit stopped reason; model/source/prior/frozen/original integrity passed. Exit0 denotes clean runner cleanup, not a pass for the stopped second attempt. Exact proof/logs are under each attempt directory.

No production change, additional inference/performance job, broad suite rerun, personal-data access, merge or release. Keep feature OFF. **Recommendation:** do not adopt the catalog Quality model as a sufficient fix or start broad qualification on the strength of these eight cases. Retain the completed evidence and let the parent choose product/release scope or a separately designed semantic-reliability investigation; another ad hoc prompt/schema tweak is not justified here. Human semantic, existing1k relative latency/full-request cost, combined-stack/CODEOWNER, packaged macOS UI/audio and Windows gates remain.

Check this: independently verify packet hashes/lineage and all18 claim/source pairs; distinguish structural admission from relevance/conflict correctness and fake offline fixtures from native results. Stack remains [230](https://github.com/Onyx-Dev-Labs/doodle-note/pull/230) → [233](https://github.com/Onyx-Dev-Labs/doodle-note/pull/233) → [232](https://github.com/Onyx-Dev-Labs/doodle-note/pull/232), unmerged and unwatched. DEV507 remains Sean/In Review; native Verification select readback remains unconfirmed, not silently set to Passed.
