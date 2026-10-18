# Six-case native diagnostic: structure passes, content quality does not

**All six outputs passed strict structural and current-request admission, but the captured answers still contain unrelated, repeated and unsupported claims. This does not establish factual quality or semantic acceptance. Production remains OFF.** No follow-on inference, implementation or timing experiment was performed.

Actual production source: `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8`. Separate candidate attempt `dev507-native-six-5de0lv8g`; fresh root `/private/tmp/dev507-native-six-5de0lv8g` preserved. Execution ran 2026-10-18 22:04:15–22:09:28 UTC, launcher elapsed 313.126 seconds, clean exit 0. Exactly the authorized order, once each: `answer-04`, `answer-06`, `must-03`, `must-09`, `answer-01`, `answer-02`.

The immutable old79 packet remains **33 unique / eight structurally valid / 25 failed / 67 unperformed**, with its prior interrupted attempt retained. These six candidate attempts do not replace old failures, enlarge the completed frozen denominator, or constitute the 100-case/human semantic evaluation. No retry, output repair, parser/prompt/schema/corpus tuning or production edit occurred during this diagnostic.

## Content observations: separate from structural validation

Agent inspection compared the 48 admitted claims, raw native outputs and cited original ranges. This is qualitative diagnosis, **not designated-human scoring**. The six raw records remain in `evidence.jsonl.gz`; original document identities and exact ranges are retained, with the unchanged full frozen corpus available at `../quality-corpus-v1.json`.

| Case | Concrete observed problem |
| --- | --- |
| answer-04 | Correct Willow next action is labeled `conflict` and cites Onyx/Fern/Beryl next actions. It also adds a Willow variance dispute unrelated to the next-action question. Different projects' actions do not establish a conflict about Willow. |
| answer-06 | Repeats Juniper's 12/15 result, with one copy citing only Amber/Clover/Poppy originals. Adds variance/archive material and claims success rates are unspecified or unclear despite the explicit 12/15 original. Twelve claims, several unsupported conflict labels. |
| must-03 | Six raw paraphrases are labeled quotations; existing production handling replaces each with the exact original quote, yielding six repeated displayed quotes. Six additional claims infer absence of conflicting codes across other records from four selected archive passages; those selected references do not support exhaustive absence. This is not raw adapter transformation: native `responseText` and adapter `rawJson` match; quotation substitution occurs later in the unchanged production parser as designed. |
| must-09 | Gives `synthetic-09`, then claims the recovery code is unspecified because a support owner is unknown. Cited owner uncertainty is about a different attribute and does not contradict the explicit code. Also adds unrelated 40/60-credit variance claims. |
| answer-01 | Correct Maple deadline is repeated four times. Three copies cite Quartz, Opal and Garnet originals, not Maple. Adds two irrelevant variance quotations. |
| answer-02 | Correct Cobalt budget appears seven times, plus other projects' budgets and two repeated variance-conflict claims. These are irrelevant or repetitive despite structurally valid references. |

Parent independently read the six raw answers and ran an offline deterministic trace diagnostic (no model):

```sh
python3 /tmp/dev507-semantic-replay-jzacyfh9/replay.py /private/tmp/dev507-native-six-5de0lv8g
```

Exit **1**, finding **four duplicate-text groups, four exact-gold-text claims citing unrelated originals, and six nonverbatim quotation labels**. Copies `parent-semantic-replay.json` and `parent-semantic-replay.py.txt` retain its exact output/code and hashes in `provenance.json`. These checks inspect raw claims, while the table also distinguishes later admitted quotation text. They are neither a full semantic scorer nor a new parser defect: the strict parser intentionally replaces quotation text from originals, and it does not establish entailment or relevance.

The smallest next investigation is the already parent-owned read-only attribution diagnosis: trace wrong-subject citations and spurious conflicts against the exact question, wire and schema alternatives, distinguish distractor/prompt/schema/model hypotheses, and specify a separately authorized bounded experiment. No implementation or new inference is recommended as already approved by this report. No broad 67-case continuation occurred.

## Native and structural evidence

**This diagnostic's fixed denominator:** six planned, six attempted, six strict/current-valid; zero failed, zero cancelled/timeouts, zero unperformed. All six gold ranges reached the actual wire. All six returned policy 2 snapshots. All six native response strings equal the adapter's raw JSON byte-for-byte, and all native calls received the actual grammar object created by their model's current runtime. Native stop reason was `stopGenerationTrigger` in every case. No timeout/stop condition was triggered; therefore this run does not newly test native cancellation.

| Case | Run ms | Admission ms | Total case ms | Adapter generation ms | Observed grammar wrapper ms | Input / generated tokens | Claims |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| answer-04 | 24011.562 | 50.407 | 24082.830 | 23822.309 | 10.367 | 2208 / 569 | 2 |
| answer-06 | 50458.987 | 44.154 | 50525.083 | 50290.178 | 7.836 | 2206 / 2603 | 12 |
| must-03 | 112616.142 | 62.396 | 112702.944 | 112408.262 | 8.910 | 11955 / 3231 | 12 |
| must-09 | 54168.407 | 61.278 | 54255.923 | 53957.282 | 7.811 | 11964 / 913 | 4 |
| answer-01 | 19072.606 | 47.686 | 19143.501 | 18937.633 | 6.987 | 1255 / 961 | 6 |
| answer-02 | 49117.921 | 49.385 | 49194.157 | 48961.551 | 8.962 | 4292 / 1977 | 12 |

Timings are diagnostic observations, **not isolated performance gates**. Adapter generation includes model/context preparation, full budgeting, grammar creation and awaited disposal; first case includes cold model load. Grammar wrapper timings include observer logging/fsync overhead, so they do not isolate native compilation cost. Native prompt-only elapsed and individual source-operation timing/counts are in `summary.json`; no inferred missing telemetry. The direct-I/O service performed three retrievals plus three manifest validations for each run/admission pair. This remains a standalone 701-original path, not desktop worker/IPC/Home persistence timing. No concurrent parent model/performance jobs were active; ordinary host activity and observer cost are uncontrolled. Earlier 1k relative latency failure remains unchanged.

Actual runtime: node-llama-cpp **3.20.0**, prebuilt llama.cpp **b10361**, **Metal**, Qwen wrapper recorded per call, context **16384**, temperature **0.3**, output reserve/maxTokens **4096**, margin **256**. Every complete native wrapper token array/hash matches production inclusion; all `input + 4096 + 256 <= 16384`. Output counts are actual sequence token-meter deltas, not retokenized estimates. Requested schema, public grammar text and hashes, final included-ID enum, native `responseText`/`stopReason`, adapter `rawJson`, and current admission are retained for every case. No fake generator, native response substitution, second model or fallback artifact was used.

## Containment, ownership and provenance

Full preparatory review included the existing DEV507 standalone launcher and the earlier PR230 containment reports. The new ledger names all six IDs before any native work. `initial-ledger.json` is preserved unchanged; every case has a separate candidate attempt identifier. The only QA changes were outside the checkout until evidence packaging: observer and lifecycle ledger, exact ordered slice, stricter stop rules, and 20-minute outer watchdog. The production checkout was clean at launch and still clean at native exit, before adding this evidence-only directory.

Executed command:

```sh
python3 /private/tmp/dev507-native-six-5de0lv8g/launch.py /private/tmp/dev507-native-six-5de0lv8g
```

The launcher bundles the QA runner with production source, leaves `node-llama-cpp` external, then starts an owned process group through `/usr/bin/sandbox-exec` with cleared environment/inherited FDs and synthetic HOME/TMP/cache directories. Exact argv, environment, PID and hashes are in `provenance.json`. Source copies are `observer-runner.ts.txt`, `launcher.py.txt`, `prepare.py.txt`; no model binary is committed.

Seatbelt policy is **byte-identical** to the earlier authorized standalone policy: SHA256 `db030acf9da31d94f89d0ea953e1c5653468590d62d7cee7aa35875e5d7b3f22`. It denies network, personal file content, preferences and Apple Events; read access is restricted to this checkout, the exact approved model, fresh run root and required OS runtime paths. The prior Metal compiler lookup exception remains. An outside-root synthetic sentinel read was denied as expected. No Electron/personal app/profile, calendar/accounts/keychain/TCC, capture/recording device or download was accessed. As before, permitted runtime IPC/system GPU caching is not an arbitrary-IPC isolation certification.

Native acquisition uses production `build: 'never'`. Only the exact approved regular, non-symlink read-only file was used:

`/private/tmp/dn230-inference-AHCmaZ/QAmodelcache/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`

- Before/after SHA256: `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`.
- Size `2497281120`; mode `0444`; inode `2650967`; mtimeNs `1792333550535754478`, all unchanged.
- Artifact revision `a06e946bb6b655725eafa393f4a9745d460374c9`, as previously authorized.
- All **701 original hashes unchanged**, all **293 tracked source/evidence hashes unchanged** at native exit. Corpus/rubric and old packet hashes match the immutable prior evidence.
- Each context disposal and shared service cancellation/drain was awaited. Final model disposal completed; native PID/process group **66818 absent**, launcher exit 0, no forced termination. The 180-second AbortSignal timer and 20-minute one-SIGTERM/await/SIGKILL-last-resort paths were armed but not exercised.

Runner provenance is separate from production SHA:

- QA source `2b8cdd0da73fa2883ec7a8c52c2db0b1a85e705da349d7cfa309894a80fc13d8`.
- Executed bundled runner `ccdd93381576d3bf371ce0f6c0c397e689a81645a08c147e63b663ec79cb23de`.
- Launcher `2396a9dd67a2aed0a881f69456889e846abd337683a31d2773a4c4637b35d975`.
- Full six-record compressed packet `evidence.jsonl.gz`: **329045 bytes**, SHA256 `6c6c208882c8750ee861c04053b6d41c089c4d80862503f6bf8baf351125401d` (2696001 uncompressed bytes).

`events.json`, `initial-ledger.json`, `final-integrity.json`, `source-hashes.json`, `originals-sha256.json`, `native-stderr.log`, `summary.json` and `provenance.json` retain the supporting records. The stderr tokenizer control-token warning is preserved, not suppressed. No underlying sampler token trace or human support score was captured; no such evidence is inferred.

## Review scope and remaining gates

Both full independent reports are copied with original paths/hashes in provenance: `standards-review.md` and `spec-review.md`. They found no actionable issue in **24af339 → fd363c8 only**. Standards independently passed 13 focused tests. Spec independently passed 13 AI and 59 desktop checks plus affected types, 756 synthetic schema combinations and six fake-runtime lifecycle scenarios, and reproduced OLD six grammar/three policy failures. Strict parser and frozen packet/corpus/rubric were unchanged. Their bounded software conclusions do not qualify this content quality or the full stack.

**Check this:** decompress `evidence.jsonl.gz` and compare each native `observed[0].responseText` to `generation.output.rawJson`, grammar/schema hashes and enums to final wire IDs, and the policy-2 snapshot to current validation. Inspect the raw claims and cited originals behind the failures above; distinguish later quotation substitution. Read the copied parent trace result as a failed narrow diagnostic, not a semantic score. No inference is necessary for these checks.

Remaining gates include semantic reliability and designated-human evaluation, parent-owned attribution diagnosis/any next bounded experiment, 1k relative responsiveness/full-request costs, current combined-stack software/CI, packaged macOS lifecycle/audio and Windows native QA, and human/CODEOWNER approval. Production stays OFF. No broad suite reruns, benchmark, further native run, merge, release or publication followed.
