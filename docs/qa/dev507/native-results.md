# Native model evidence at immutable 79e506a

Production source: `79e506ace65a99352b1bdd9af35b9df7f541b260`. Frozen corpus SHA256: `0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2`. The corpus was frozen before evaluation. Production and parser/corpus/output policy remained unchanged throughout these attempts. **Production stays off: native answer reliability failed and semantic acceptance is incomplete.**

| Frozen group | Attempted | Actual wire contains required gold | Production schema + current-request validation | Failed | Unperformed |
|---|---:|---:|---:|---:|---:|
| Must-find 20 | 20 | 20 | 4 | 16 | 0 |
| Semantic 80 | 13 | 13 | 4 | 9 | 67 |
| Unique total 100 | 33 | 33 | 8 | 25 | 67 |

The 20/20 must-find inclusion gate was measured with actual native tokens and wire, independently of answer outcomes. Neither inclusion nor the eight structurally admitted answers is a human semantic quality pass. Designated independent human support/contradiction scoring is **unperformed**. The remaining 67 semantic cases were deliberately not run after the bounded diagnostic slice; there was no broad continuation.

## Provenance and containment

The exact approved Qwen3-4B-Instruct-2507-Q4_K_M artifact, revision `a06e946bb6b655725eafa393f4a9745d460374c9`, remained a regular non-symlink, mode 0444, 2,497,281,120-byte file. SHA256 before and after every scored shard was `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`; inode and mtime also matched. No downloads or alternate models were used.

Runtime: macOS 26.6.2 (25G83), Darwin 25.6.0 arm64, Node 24.22.0, cached node-llama-cpp 3.20.0, actual QwenChatWrapper and 16,384-token context, temperature 0.3, 4,096 output reserve and 256 safety margin. The current run did not independently instrument the GPU device; prior evidence that these model bytes ran on Metal is not substituted for that measurement. Native stderr's control-token warning is retained in the isolated root.

Each fresh root used isolated HOME/TMPDIR/cache, copied Node, synthetic originals and a seatbelt policy denying network, personal file content, preferences and Apple Events. Only this checkout, the exact approved model, OS runtime and fresh root were readable. An outside-root synthetic sentinel verified content denial. No existing app/profile/calendar/accounts/devices or permissions were used.

The actual `LocalNotesEngine` and shared `MainCitedAskService` ran with a direct original-I/O source adapter. An observer forwarded unchanged prompt arguments/options/result while recording actual system/history/user content, wrapper, native token array/hash, context and raw response/stop reason. It verified reported wire hash/token count against native observations and the full context budget. This is real model evidence, but it is **not** Electron IPC, packaged app, audio audibility, device capture or Windows native QA.

## Attempts, errors and cleanup

The first current-79 shard recorded answer-00 through answer-02. Answer-03 was interrupted to add a bounded QA timer; service cancellation and model disposal completed, with exit 0 and unchanged model. That attempt is retained outside the unique-case denominator and was resumed once. No failed scored case was retried or replaced.

The resumed shard paused after three repeated protocol errors. Its combined 13 semantic results remain four admitted and nine failed. The separately authorized must-find slice then ran exactly must-00 through must-19 and stopped. It exited 0 after 1,177.48 seconds; every case completed within its 180-second AbortSignal deadline. Service run/cancel was awaited, the engine disposed, and all 701 synthetic originals were byte-identical. There were zero timeout/forced-watchdog/operator-interruption cases in this slice. The outer owned-group watchdog was not used. This does not claim a new timeout-path native test.

Failure classification uses the unchanged production errors and retained raw output:

| Failure | First 13 semantic | Must-find 20 |
|---|---:|---:|
| Extra double quote after complete JSON root | 7 | 11 |
| `conflicting-evidence` status without a conflict claim | 2 | 0 |
| Conflict claim cites fewer than two evidence IDs | 0 | 1 |
| More than the allowed 12 claims | 0 | 4 |

These were output syntax/schema failures, not absent gold passages. Raw outputs were not repaired, output limits were not changed, and failures remain failures. A separate proposed investigation is documented in [reliability-next.md](reliability-next.md); no structured-output implementation is included here.

## Observed elapsed times

For the 20-case must-find slice, run elapsed was 32.676–115.162 seconds (median 42.856s, nearest-rank p95 110.522s). Model elapsed was 32.565–115.064 seconds (median 42.742s, p95 110.462s). The four successful final admissions took 63–68ms; error cases have no successful admission timing. Actual input tokens were 11,972–11,997. All 20 had disclosed prompt-budget trimming (`budgetComplete: false`) while retaining the required gold passage and fitting the full allocated context budget.

These are observed service/model/admission durations over 701 originals, not isolated performance acceptance or the 10k six-scan Home path. Early shards overlapped some short software checks. The first three cases recorded combined run/admission time only, with missing split fields left null. One-retrieval performance, repeated full-manifest cost and the failing 1k relative latency gate remain separately documented in [performance.md](performance.md).

## Preserved evidence

- [Machine-readable summary and provenance](native-summary-79e506a.json): 33 unique results, remaining IDs, source/runner/policy hashes, model before/after, shard exits, original integrity and the prior interrupted attempt.
- [Full synthetic wire/output/result packet](native-evidence-79e506a.jsonl.gz): 33 JSONL records, 7,728,514 uncompressed bytes, 664,492 gzip bytes. SHA256 `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb`.
- [Failure classification](native-failure-classification-79e506a.json) and [first-13 diagnosis](native-first13-diagnosis.json), retaining production messages and explicit accounting.
- Raw roots: `/private/tmp/dev507-native-9aak57oq`, `/private/tmp/dev507-native-hf0lukvg`, `/private/tmp/dev507-native-ov5wf72s`.
- Earlier three-case source-72 run `/private/tmp/dev507-native-cbietv61` is historical and excluded from current-79 counts.

The reproducible containment/observer helpers are in `apps/desktop/scripts/dev507-native-qa/` and `dev507-native-evaluation.ts`. Their QA runner hash is recorded independently from production source. Native evidence and the subsequent audio path compatibility fix are separate commits; the fix does not retroactively change this packet.
