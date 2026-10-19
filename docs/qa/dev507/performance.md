# DEV507 responsiveness evidence

Production gate remains **off**. The current 1k relative latency target fails; no threshold or coverage change is applied. All data are synthetic.

Apple M4 Pro  / 24 GiB, macOS 26.6.2 (25G83), Darwin 25.6.0 arm64, Node 24.22.0. Each mode/size used a fresh process/cache, cold request, one excluded warmup and 20 fixed mixed queries. The worker scans 1k/10k deterministic originals with 20 transcript segments each. Main receives 20 ms synthetic PCM callbacks and 200 ms atomic writes outside the requested source domain. No recording device or model inference was used. Process RSS includes the worker; phase RSS is a different measurement.

| Source | Originals | Cold ms | Query p95 ms | Root peak RSS MiB | Main-loop p95 ms |
|---|---:|---:|---:|---:|---:|
| bbb352b source search | 1000 | 443.19 | 144.07 | 413.50 | 1.299 |
| bbb352b source search | 10000 | 4173.70 | 1567.63 | 1391.55 | 1.297 |
| 6392708 evidence (production 35f965c) | 1000 | 1021.70 | 780.51 | 374.61 | 1.288 |
| 6392708 evidence (production 35f965c) | 10000 | 9933.13 | 7794.47 | 1264.67 | 1.289 |
| ae696e8 normalization | 1000 | 498.66 | 210.41 | 420.39 | 1.294 |
| ae696e8 normalization | 10000 | 4733.61 | 2093.01 | 1269.23 | 1.289 |
| 79e506a request-local masks | 1000 | 447.56 | 210.35 | 409.73 | 1.353 |
| 79e506a request-local masks | 10000 | 4273.97 | 1704.71 | 1262.98 | 1.291 |

The foundation performs source search; the candidate produces a full evidence bundle/manifest with bounded original ranges. That operation mismatch remains explicit. A brief SHA read of the approved 2.5 GB model overlapped part of the first 6392708 10k run; no inference did. The ae/79 timing and phase runs were sequential without model work. Light concurrent independent reviewer CPU work cannot be excluded. Raw samples and exact revision fields are retained in the adjacent JSON files; no run was discarded to erase noise.

| Current 79 target | 1k | 10k |
|---|---|---|
| Warm p95 <=3s | PASS | PASS |
| Relative p95 <=20% over measured foundation | **FAIL +46.00%** | PASS +8.74% |
| Relative peak RSS <=20% | PASS | PASS |
| Main-loop p95 <=16ms | PASS | PASS |

## Bounded same-fixture cost diagnosis

| Phase (10k) |72c6ef4 ms|ae696e8 ms|79e506a ms|
|---|---:|---:|---:|
| warm-full-original-scan-projection-hash | 729.07 | 693.91 | 658.44 |
| warm-index-reconcile | 25.44 | 23.33 | 22.12 |
| ranking-range-construction-manifest-and-final-stat-fence | 7093.46 | 1269.51 | 891.86 |
| standalone-final-stat-fence | 31.49 | 33.52 | 31.97 |
| validate-manifest-full-rescan-and-rank | 7819.49 | 1981.11 | 1564.05 |
| resolve actual 16 selected original ranges | 1.43 | 1.39 | 1.27 |

The profiler labels its final phase “24 selected” historically; the actual selected count is 16 in every saved profile. Raw files are preserved unchanged. The ranking phase already includes its final stat fence; the standalone stat measurement must not be added as another independent phase. Each phase profile includes CPU time and before/after root RSS. The 79 phase ends at 718.23 MiB RSS; the separate 20-query benchmark peaks at 1262.98 MiB. This is not a retained-cache memory claim.

The first optimization normalizes each full passage once per DF calculation and avoids rebuilding offset maps for <=1,600-code-point whole-passage windows. The second keeps only request-local 16-bit term and 8-bit phrase masks indexed by the original passage index, preserving DF, term order and exact score calculations. Long windows are still scored from their own text; there is no persistent cache or reduced source scan. The original 19 and expanded 27 exact-bundle fixtures cover Unicode, high bits, zero-term phrases, linked-empty/topic, boundaries, ties and exclusions.

A successful shared service run still performs **four complete scans/rankings**, plus original resolves before/after generation. Home admission adds **two complete scans/rankings** and prompt-range resolution. This is inspected call accounting, not a native end-to-end benchmark. Manifest revalidation alone still costs 1.564 s in the 79 bounded 10k profile. The one-retrieval result does not qualify total Ask/admission latency. Native corpus timings use 701 originals and are reported separately.

Commands (run sequentially with no model):

```sh
pnpm --filter @repo/meetings-store exec tsx scripts/benchmark-evidence.ts "$SOURCE_ROOT" candidate-evidence 10000 "$SOURCE_SHA"
pnpm --filter @repo/meetings-store exec tsx scripts/profile-evidence.ts "$PRIVATE_EVIDENCE_DIR"
```

Use a read-only git archive of exact bbb352b with cached dependencies for `foundation-search`; never change another checkout. The profile/script regenerates the same fixture and removes only its owned temporary originals.
