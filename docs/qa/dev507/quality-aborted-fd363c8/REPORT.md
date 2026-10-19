# Quality capability diagnostic aborted before Gemma generation

The pinned Quality artifact was successfully acquired and verified. The two Qwen sentinel generations completed, but the first Gemma attempt stopped in the QA observer **before the underlying native prompt call**. No Gemma answer quality has been measured. Seven remaining Gemma ledger rows are unperformed. The immutable raw summary reports two valid, one failed, seven unperformed; its samplingCalls=3 counts intercepted observer entries, while actual native generation calls=2 (both Qwen). See attempt-adjudication.json. No retries or retroactive repairs.

Offline diagnosis then confirmed a separate production integration issue: pinned node-llama-cpp3.20 LlamaChatSession defaults forceAddSystemPrompt=false and starts with empty history when GemmaChatWrapper.supportsSystemMessages=false. Production LocalNotesEngine supplies systemPrompt without that option. Gemma's default actual input therefore omits CITED_ASK_SYSTEM. The QA observer's history[0].text assertion throws on that empty history. Merely optional-chaining it would allow a comparison without the intended cited-answer rules. The parent confirmed the issue and separately authorized a focused production preservation/policy fix; **this packet contains no fix or further inference**. A successor requires immutable fix and fresh independent review. Previous preflight budgets omit the system rules and are not valid fixed-production baselines.

## Scope and identity

- Branch t3/answer-library-questions, exclusive /Users/sean/.t3/worktrees/doodle-note/t3-d30e320c; evidence starting HEAD5481a4f8ee3e480819c525e52b55f308ab7c452a.
- Production apps/packages byte-identical fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8 throughout this run. Original prompt/schema order; no rejected sentence, repairs, seed change or production patch.
- Root /private/tmp/dev507-quality-annby45k. Corpus0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2; frozen100 rubric782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777 unchanged.
- Exactly ten initial rows frozen before native work: Qwen conflict-01,unknown-01; Gemma answer-04,answer-06,must-03,must-09,answer-01,answer-02,conflict-01,unknown-01. Separate attempts; historical six/Qwen79/pair/order results never replaced or pooled.
- Actual LocalNotesEngine and MainCitedAskService with original source APIs, synthetic originals and canonical marker. Standalone, not Electron/native UI or worker IPC qualification. Prebuilt node-llama3.20.0/llama.cppb10361/Metal, native auto wrappers, context16384/temp0.3/output4096/safety256.

## Acquisition

Only hf:unsloth/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf#d15e4c7dc21dc55d56bf8549db57a71ad8a2a35d acquired. Official public HF API confirmed revision and LFS size/hash; verified HTTPS download exited0. Exact7300778336bytes and SHA25615b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff. Artifact retained at /private/tmp/dev507-quality-annby45k/model/gemma-3-12b-it-Q4_K_M.gguf, mode0444, inode4738223,mtimeNs1792420949861587642. No credentials/license acceptance, personal cache lookup, fallback, executable download or Qwen copy. Original HTTP headers retained privately; committed identity headers omit expiring public CDN signed URLs. Inference was network-denied separately from acquisition.

## Attempts and agent inspection

| Model/case | Actual generation | Outcome | Agent inspection |
|---|---:|---|---|
| Qwen conflict-01 | Yes | Policy2 valid;60.001s total,2728 output tokens | Genuine Maple40/60conflict identified with both correct originals;12 largely redundant claims. Three raw paraphrases labeled quotation become the same exact joined original on admission (one repetition group,two excess). No arbitrary limit chosen. |
| Qwen unknown-01 | Yes | Policy2 valid;3.849s,22 output tokens | Correct insufficient-evidence/emptyclaims for unstated Quartz password; no recovery-code substitution. |
| Gemma answer-04 | No | Observer TypeError at history[0].text;2.986s before cleanup | No output/no quality result. Grammar compiled; failure preceded actualPrompt.call and native-prompt-start. |
| Gemma answer-06 | No | Unperformed | Stopped after observer integrity failure. |
| Gemma must-03 | No | Unperformed | Same. |
| Gemma must-09 | No | Unperformed | Same. |
| Gemma answer-01 | No | Unperformed | Same. |
| Gemma answer-02 | No | Unperformed | Same. |
| Gemma conflict-01 | No | Unperformed | Same. |
| Gemma unknown-01 | No | Unperformed | Same. |

All12 raw/admitted Qwen claims and24 citation references to two full originals are retained, including intended quotation replacement. Raw exact-text repetition0; admitted1group/2excess. This is AGENT inspection, not designated-human scoring or full100/Brief24 acceptance. No larger-model improvement/failure conclusion, size-only attribution or practical generation-latency conclusion is possible.

## Native preparation and actual boundaries

All ten preparations completed before sampling, using actual tokenizer/context/grammar. Required gold retained, including both genuine-conflict originals. But the preparation checks did not enforce system-message presence; subsequent diagnosis invalidates them as same-instructions comparisons. They remain truthful observations of OLD production behavior.

| Model/case | Wrapper | Input tokens | Included / omitted | Spare after4096+256 |
|---|---|---:|---:|---:|
| Qwen conflict-01 | QwenChatWrapper |3338|24/0|8694|
| Qwen unknown-01 | QwenChatWrapper |1129|6/0|10903|
| Gemma answer-04 | GemmaChatWrapper |1871|7/0|10161|
| Gemma answer-06 | GemmaChatWrapper |1867|7/0|10165|
| Gemma must-03 | GemmaChatWrapper |12031|23/0|1|
| Gemma must-09 | GemmaChatWrapper |12032|23/0|0|
| Gemma answer-01 | GemmaChatWrapper |927|7/0|11105|
| Gemma answer-02 | GemmaChatWrapper |3942|24/0|8090|
| Gemma conflict-01 | GemmaChatWrapper |2997|24/0|9035|
| Gemma unknown-01 | GemmaChatWrapper |803|6/0|11229|

Selected inputs for six historical cases exactly matched originalfd captures. Four short cases retained identical JSON user data; archive budget trimming/inclusion differs (Saffron19→23ranges). These are captured full range/anchor/offset/parent/order/schema/wire arrays and hashes, not forced Qwen token accounting. Missing Gemma system instructions contribute to these differences; do not attribute them solely to tokenizer efficiency. Qwen native grammar/current-runtime identity, responseText→rawJson exact forwarding and currentpolicy2 validation passed for both actual outputs. No Gemma native response/stopreason/output token evidence exists.

## Offline reproduction

Read full relevant pinned session/wrapper code and public forceAddSystemPrompt declaration. offline/probe.mjs executes the actual pinned session constructor/getChatHistory and actual Gemma/Qwen wrappers with explicit native LlamaChat dependency stub plus runtime import blocker. It reproduces empty Gemma history and absent system in full wrapper serialization; Qwen control retains system. OLD observer Gemma desired behavior RED, Qwen GREEN. No native models/tokenizer/sampling in this offline probe. Initial blocker correctly rejected pure bindings/types.js import; after inspecting that enums/helpers-only file, it alone was allowlisted. Both initial block log and final proof retained. No observer fix is claimed or run; discovered production ambiguity triggered the conditional successor stop.

Reproduce without native loading:
`/private/tmp/dev507-quality-annby45k/helpers/node --import /private/tmp/dev507-quality-annby45k/offline/no-native.mjs /private/tmp/dev507-quality-annby45k/offline/probe.mjs`

Smallest next direction, separately authorized by parent: supported session option preserves unchanged instructions exactly once, complete actual-wrapper accounting, Qwen wire control and historical/current policy regression tests. No custom prompt concatenation, parser relaxation or arbitrary model tuning. Fresh independent review before any successor native generation.

## Cleanup, provenance and limits

Native child exit0 after99.717s; diagnostic stopped reason preserved separately (exit0 is NOT experiment pass).13models and13contexts created/disposed, no overlap, forcedkill,watchdog or signal. PID82878 and owned process group absent. Both models' exact SHA/mode/size/inode/mtime unchanged;701originals+marker per model copy,1432frozen files,3835prior-root files and1170tracked source/evidence files unchanged. Captured model/context-event RSS max9659645952bytes is sampled processRSS, not peak unifiedGPU memory or an acceptance/performance benchmark.

Seatbelt denied network/personal data; clean synthetic HOME/TMP, readonly models/originals, approved Metal compiler lookup only. No app/account/calendar/keychain/device interaction, cloud inference or global configuration change.300s abort+awaitedservice/context drain,50min ownedwatchdog unused. Actual generation count2; all other entries retained as above. RunnerSHA51874b028498b24275541bc03e467ac50694a04ab194aa4fb99a60c5f509c2d1; freezeSHA9e6f0e3e62c0c525ac8499b0f2fda1209eebefdd33c6cb3e17e4d1a6894594f0. Full model/prepost/source/raw logs retained; no GGUF committed.

Check this: inspect raw Qwen conflict claims/citations and justified empty unknown result; verify failed Gemma has grammar but no native-prompt-start/response; replay offline constructor/wrapper proof; compare pre/post model and source integrity. No human score, frozen100 completion, Quality answer evidence or release approval. Production gateOFF; existing1krelative/fullrequest/native/human/Windows/media/UI/codeowner gates remain. PR230→PR233→PR232 unmerged. All previous packets unchanged. Parent owns next independent review and bounded successor authorization.
