# DEV-506 derived index verification — October 17, 2026

Issue: https://app.notion.com/p/3fcf0f846ee4816c98b3ff4bcee0439b

Base: `b53c078685b00d901a321192e886574ff0c17701`. Implementation is on `t3/derived-index-contract`; the PR records the exact tested head. All data below is synthetic. This report is not installed native capture QA or a release claim.

## What changed

The additive desktop source endpoint reconciles all portable originals in a worker, maintains a disposable SQLite FTS5 cache, returns revision-aware passages and reports incomplete coverage. Local MCP shares projection/resolution through a read-only scan. Existing Home search and Global Ask remain unchanged. See [source contract](../../packages/meetings-store/README.md) for dependent DEV-507/DEV-509 integration.

## Benchmark method and limits

Apple M4 Pro, 24 GiB RAM, macOS Darwin 25.6.0 arm64; Node 24.22.0 / SQLite 3.53.4. Each dataset has 1,000 or 10,000 synthetic meetings, 20 transcript segments and two personal lines each, with no generated summaries. The oldest meeting has a unique phrase in its last segment, beyond 1,500 total characters. Queries alternate a rare phrase and common/accented/CJK terms, 25 observations per mode. First/repeat timings use the rare query; percentile timings include common high-fanout queries.

A timer simulates PCM work every 20 ms and atomically writes a synthetic transcript every 200 ms. No microphone, audio device or real meeting was used. `monitorEventLoopDelay` samples at 1 ms resolution. Baseline uses existing synchronous `MeetingFileStore.search`; it returns meeting hits, whereas the new contract provides passages/revisions/coverage and performs a second fingerprint check. This is an explicit workload comparison, not equal-output query acceleration. MCP is measured in the harness main thread for comparison; in production it is a separate server process and cannot block desktop capture.

RSS is sampled whole-process resident memory (main + worker), during callbacks and after each query. Modes run sequentially in one process, so allocator retention and previous work affect RSS; these are observed maxima, not isolated worker heap or a hard bound. Other local development activity can affect timings. No latency/memory success threshold was specified or invented.

## Measured results

| Meetings | Mode | Query p50 / p95 ms | Main-loop p95 / max ms | Observed process RSS peak MiB | Capture callbacks / approximate expected |
|---|---|---|---|---|---|
| 1,000 | baseline-main-json | 33.56 / 42.2 | 39.29 / 50.5 | 353.58 | 26 / 46 |
| 1,000 | readonly-mcp-scan | 100 / 104.2 | 103.61 / 108.72 | 374.39 | 26 / 129 |
| 1,000 | worker-index | 123.68 / 130.79 | 1.29 / 2.04 | 439.83 | 145 / 147 |
| 10,000 | baseline-main-json | 415.82 / 788.92 | 570.43 / 869.27 | 1266.08 | 26 / 559 |
| 10,000 | readonly-mcp-scan | 1101.65 / 1152.22 | 1132.46 / 1157.63 | 1051.28 | 26 / 1374 |
| 10,000 | worker-index | 1381.25 / 1428.34 | 1.29 / 3.01 | 1695.95 | 1574 / 1594 |

| Meetings | First query with rebuild ms | Repeated rare query ms | Cancel-to-rejection ms | Cancel-to-worker-ack ms |
|---|---|---|---|---|
| 1,000 | 375.52 | 73.42 | 0.13 | 0.27 |
| 10,000 | 3765.86 | 852.23 | 0.16 | 3.13 |

The worker endpoint is slower to answer than existing JSON search, while keeping capture's caller event loop responsive. At 10k the mixed-query p95 is 1,428 ms versus baseline 789 ms, with 3,766 ms for the initial rebuild and observed process RSS up to 1,696 MiB. These are concrete review/native-QA risks. Reconciliation does not publish cached complete results while in progress. Concurrent changed sources are withheld and mark counts incomplete; consumers should retry or disclose partial coverage.

## Tokenizer decision

Both tokenizers were executed in real Node SQLite. In a separate identical-text insertion/query probe:

| Rows | Tokenizer | Build ms | Query p50 / p95 ms | `aunch` infix matches |
|---|---|---|---|---|
| 1,000 | unicode61 | 1.96 | 0.02 / 0.02 | 0 |
| 1,000 | trigram | 5.24 | 0.1 / 0.1 | 1000 |
| 10,000 | unicode61 | 21.18 | 0.15 / 0.16 | 0 |
| 10,000 | trigram | 60.6 | 0.97 / 0.99 | 10000 |

Trigram retains the literal substring contract; unicode61 is faster but misses infixes. Short terms fall back to the common literal predicate. No native addon, embeddings or external service was added.

## Initial verification evidence (`bd2fa54`)

- Frozen pnpm 10.33.2 install succeeded. Host Node 24.22.0.
- Meetings-store: 29 tests passed, including 501-meeting late recall, edits/trash/restore/import/delete, explicit scope, retained selected summaries, source corruption/unreadability, identity relocation, cache corruption, transactional cancellation, real worker generation fencing and concurrent external file changes.
- Local MCP: 11 tests passed, including full-history parity, no writes, consent/path changes and exclusion of bound content from legacy tools.
- Desktop: 363 passed, 8 existing skips (371 total); includes renderer ownership protection. Agent contract: 5 passed.
- Desktop, meetings-store and MCP typechecks passed; desktop and bundled MCP builds passed; repository lint passed without warnings; production audit reported no known vulnerabilities.
- Actual Node 18.20.8 built-CLI stdio smoke passed initialize, source tools, resolution, stale revision, revocation and no identity/cache writes.
- Actual Electron 44.0.0 / Node 24.18.1 / SQLite 3.53.1 arm64 accepted both FTS5 tokenizers and ran the emitted worker from ordinary files and an ASAR archive, with a private synthetic userData directory. No native SQLite addon/rebuild is required. This is an Electron runtime/package-layout check, not a signed installed app test.

Reproduce with commands in [the package README](../../packages/meetings-store/README.md). Raw benchmark measurements follow, so the table can be checked without relying on rounded prose.

## Follow-up verification: live relocation and malformed legacy summaries

Two P2 regressions were reproduced against `bd2fa54ce53e1d6ccb5577aaf888699690c9f006` before the fixes:

- The actual desktop service/client/worker plus storage IPC and `LibraryStorage` moved a synthetic library, then edited its active original. Searching the old text still returned one hit rather than zero because the service retained its constructor path. The service now reads the trusted live path, retires the old worker, waits for its exit before starting another writer, and fences both pending operations and delayed replies. The real relocation callback refreshes retrieval before agent configuration. Missing active volumes fail; the retained recovery copy is never substituted. Failed/cancelled transfers keep the unchanged active library.
- A nonstring legacy `enhancedMarkdown` produced `unavailableCount: 0` and complete/exhaustive coverage. Both SQLite retrieval and the direct MCP projection now count that summary as unavailable, keep valid passages searchable, and return incomplete coverage. Missing/null legacy summaries remain valid absence. Selected-summary precedence is unchanged, including incomplete coverage for a missing/malformed selected summary. Fixtures remain byte-identical.

Three service lifecycle tests cover actual relocation IPC, edits after moving, stable anchors before edits/stale anchors after edits, delayed search and resolve replies, cancellation while worker retirement is deliberately held, late messages from both old and replacement clients, one live worker at a time, cancelled/failed transfer, missing active volume, and path changes without the callback. Only native Electron transport and the emitted worker entry path are stubbed; the service/client/worker/storage/barrier implementations are real. A shared-package regression covers object/array/number/boolean malformed summaries, absent/null/empty/string values and selected-summary precedence through both backends.

Follow-up checks: frozen install; meetings-store **30/30**; MCP **11/11**; desktop **366 passed, 8 existing skips (374 total)**; meetings-store/MCP/desktop typechecks; desktop/MCP builds; repository lint; production audit (no known vulnerabilities); diff check. The built MCP stdio smoke passed on actual Node **18.20.8**; the emitted worker passed again in a native Electron **44.0.0**, Node **24.18.1**, SQLite **3.53.1** app process. Initial ASAR compatibility evidence above remains applicable; no packaging/dependency changes were made. The PR and Notion handoff record the exact follow-up tested SHA.

The 1k/10k benchmark was not rerun: these fixes change relocation lifecycle and malformed-input coverage, not the valid-library reconciliation/query algorithm. The measurements and latency/RSS tradeoffs above remain evidence from the initial head, not new-head measurements. Native packaged capture/relocation and Windows QA remain open.

## Acceptance mapping and remaining gates

1. **Old full-history passage:** automated 501+ records and 1k/10k datasets; stable segment/source/revision anchors; no summaries required.
2. **Eligibility and stale jobs:** edits/import/trash/restore/delete, scoped ownership, relocation and atomic cancellation tests passed. Local originals stay independent of sign-in. No cloud ownership migration is attempted.
3. **Rebuild/recovery:** corrupt/missing cache, rollback/restart and byte-identical original fixtures passed. Packaged forced-quit/restart during actual capture remains manual QA.
4. **Desktop/MCP parity:** shared projection, lexical semantics and resolution statuses tested; actual Node 18 stdio and Electron ASAR worker smoke passed. Legacy JSON remains readable.
5. **Performance:** measured tables above; main-loop isolation demonstrated under synthetic capture. No query speedup or real-time native capture claim.

**Check this before approval:** In an isolated packaged Mac app with synthetic originals, call `window.sources.search('rarephrase')` while recording; confirm responsive capture, truthful coverage and inspectable matching source. Edit/trash the matching original during a query; obsolete hits must disappear or the result must be rejected/marked incomplete. Resolve its old anchor and observe stale/missing. Cancel and rerun retrieval. Quit during rebuild, restart, and confirm originals are unchanged and retrieval rebuilds. Relocate through Settings without restarting: the same anchors must resolve, an edit to the active original must change search results and make old anchors stale, and disconnecting that destination must fail rather than search the recovery copy. Corrupt only the disposable cache while closed and verify rebuild; corrupt identity must fail closed. Exercise local MCP with consent on, then revoke while running and verify access fails.

Remaining: required CI/CodeQL, human review, isolated packaged macOS capture/restart/relocation acceptance, then native Windows validation. Native platform QA and release signing/publication are parent-owned gates. No merge or publication in this lane.

## Raw benchmark output

```jsonl
{"environment":{"node":"24.22.0","os":"darwin 25.6.0","arch":"arm64","cpu":"Apple M4 Pro","memoryGiB":24},"dataset":"1k/10k meetings; each 20 transcript segments (~5KB text), 2 personal lines; oldest meeting has rarephrase after character 1500; no summaries; deterministic synthetic PCM callback every 20ms with atomic transcript write every 200ms; 25 queries per mode; no latency target"}
{"count":1000,"firstQueryIncludingRebuildMs":375.52,"repeatQueryMs":73.42,"cancelToRejectMs":0.13,"cancelToWorkerAckMs":0.27}
{"count":1000,"mode":"baseline-main-json","rebuildMs":375.52,"queryP50Ms":33.56,"queryP95Ms":42.2,"eventLoopP50Ms":1.32,"eventLoopP95Ms":39.29,"eventLoopMaxMs":50.5,"elapsedMs":904.97,"captureTicks":26,"expectedTicksApprox":46,"pcmChecksum":10.24,"processRssStartMiB":223.06,"processRssPeakMiB":353.58}
{"count":1000,"mode":"readonly-mcp-scan","rebuildMs":375.52,"queryP50Ms":100,"queryP95Ms":104.2,"eventLoopP50Ms":1.31,"eventLoopP95Ms":103.61,"eventLoopMaxMs":108.72,"elapsedMs":2556.81,"captureTicks":26,"expectedTicksApprox":129,"pcmChecksum":10.24,"processRssStartMiB":353.59,"processRssPeakMiB":374.39}
{"count":1000,"mode":"worker-index","rebuildMs":375.52,"queryP50Ms":123.68,"queryP95Ms":130.79,"eventLoopP50Ms":1.27,"eventLoopP95Ms":1.29,"eventLoopMaxMs":2.04,"elapsedMs":2918.94,"captureTicks":145,"expectedTicksApprox":147,"pcmChecksum":57.11,"processRssStartMiB":373.06,"processRssPeakMiB":439.83}
{"count":1000,"tokenizer":"unicode61","buildMs":1.96,"queryP50Ms":0.02,"queryP95Ms":0.02,"infixMatches":0}
{"count":1000,"tokenizer":"trigram","buildMs":5.24,"queryP50Ms":0.1,"queryP95Ms":0.1,"infixMatches":1000}
{"count":10000,"firstQueryIncludingRebuildMs":3765.86,"repeatQueryMs":852.23,"cancelToRejectMs":0.16,"cancelToWorkerAckMs":3.13}
{"count":10000,"mode":"baseline-main-json","rebuildMs":3765.86,"queryP50Ms":415.82,"queryP95Ms":788.92,"eventLoopP50Ms":1.33,"eventLoopP95Ms":570.43,"eventLoopMaxMs":869.27,"elapsedMs":11162.72,"captureTicks":26,"expectedTicksApprox":559,"pcmChecksum":10.24,"processRssStartMiB":785.8,"processRssPeakMiB":1266.08}
{"count":10000,"mode":"readonly-mcp-scan","rebuildMs":3765.86,"queryP50Ms":1101.65,"queryP95Ms":1152.22,"eventLoopP50Ms":1.33,"eventLoopP95Ms":1132.46,"eventLoopMaxMs":1157.63,"elapsedMs":27467.09,"captureTicks":26,"expectedTicksApprox":1374,"pcmChecksum":10.24,"processRssStartMiB":988.25,"processRssPeakMiB":1051.28}
{"count":10000,"mode":"worker-index","rebuildMs":3765.86,"queryP50Ms":1381.25,"queryP95Ms":1428.34,"eventLoopP50Ms":1.27,"eventLoopP95Ms":1.29,"eventLoopMaxMs":3.01,"elapsedMs":31870.01,"captureTicks":1574,"expectedTicksApprox":1594,"pcmChecksum":619.98,"processRssStartMiB":1041.38,"processRssPeakMiB":1695.95}
{"count":10000,"tokenizer":"unicode61","buildMs":21.18,"queryP50Ms":0.15,"queryP95Ms":0.16,"infixMatches":0}
{"count":10000,"tokenizer":"trigram","buildMs":60.6,"queryP50Ms":0.97,"queryP95Ms":0.99,"infixMatches":10000}
```
