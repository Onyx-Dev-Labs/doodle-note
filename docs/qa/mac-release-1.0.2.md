# macOS 1.0.2 local qualification

Dev02 is a 16 GB M4 Mac mini running macOS 26.5.1 (25F80). This checkout started at `040ae864d9cc8b4e095df8991f01101e4b925e9f`. The release-owner scope is local implementation and unsigned packaged QA. M2/8 GB and M3/24 GB hardware are unavailable.

## DEV-1261 · Long local meetings

Disk preflight reported 40.40 GB free. The installed Fast model is Qwen3-4B-Instruct-2507 Q4_K_M, 2,497,281,120 bytes, SHA-256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`. The recovery process loaded node-llama-cpp 3.20.0's arm64 Metal libraries. A single RSS sample was 4.81 GiB. Neither peak usage nor customer memory pressure was measured.

The synthetic 61-minute Northwind transcript has 404 segments and 76,969 formatted characters. The four seeded facts cover the audit budget, launch date, contract owner and final rollout action. Run against the cached artifact:

```sh
export DOODLE_MODEL_PATH="$HOME/.cache/doodle-note/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
pnpm --filter @repo/ai long-meeting-smoke --fixture 61m
pnpm --filter @repo/ai long-meeting-smoke --fixture short
```

The smoke first cancels a native request, awaits cleanup and then generates notes. Reported meeting timings include the sequential map and reduce passes with the model already loaded. Time to first text includes context setup and prefill.

| Trial on Dev02 | Result |
| --- | --- |
| Original policy | 128 s, all four fact checks passed. Condensation took 46.8, 43.6 and 16.1 s. The two full sections produced first text at 30.5 and 31.4 s. No spontaneous timeout. |
| Always halve the section size | 143 s, five sections, audit budget missing. Discarded. |
| Split only on a limit, original condensation instructions | Forced first deadline. Both halves completed, 168 s overall. Audit budget missing. Discarded this retry prompt. |
| Retry requesting extensive quotations | A half reached the 2,048-token limit and correctly failed. Discarded. |
| Final local recovery | 149 s including the forced first deadline and cleanup. All four facts were present with the correct amount, date, owner and action. |
| Short control | 34 segments, 6,077 formatted characters, 21 s, all four fact checks passed. |

The final policy retains the existing 36,000-character chunk target, 16K context, 180-second condensation deadline and 2,048-token condensation ceiling. Upon a timeout or output limit, the native call settles before a single subdivision at a segment boundary. Each half must finish. On retries, repeated identical words may refer back to an earlier line in the same slice. Each occurrence retains its timestamp and speaker. The retry prompt prioritizes specific decisions, amounts and owners. Local map and reduce calls check their full prompt and reserved output with the actual tokenizer. A repeated limit or an oversized final prompt produces an error instead of saving a partial summary.

For the native fault test, a QA-only Node preload shortened the first 180-second condensation timer to two seconds. The production producer returned after 32.1 seconds, before either retry started. Both smaller sections finished in 19.3 and 14.6 seconds. The final notes explicitly included the $250,000 audit budget, March 14 launch, Priya Raman’s Datacore renewal and Miguel’s Friday rollout plan. This is recovery evidence, rather than a production timeout rate estimate.

## DEV-1264 · Ordinary Quit

The arm64 QA app reported version 1.0.2 and ran Electron 44.10.2 in packaged mode. It used this worktree’s main, preload and renderer builds plus the released 1.0.1 recorder and dictation helper. The QA bootstrap isolated app data, provided an ordinary app.quit() trigger and intercepted catalog requests. Packaging skipped signing and notarization. Tested app.asar SHA-256: `1ee80095e8e37fcdb18cc7436aa6f74e219d851995228f9dadae6817f001873a`.

Four fresh app processes each loaded the native Fast model. After each result the harness requested Quit and verified exit status 0:

| Generation outcome | Evidence |
| --- | --- |
| Context/output limit | One oversized synthetic segment exceeded the tokenizer-checked input and output reserve. |
| Timeout | A QA-only 1-second timer interrupted condensation and its bounded retry through the actual native cancellation path. |
| User cancellation | Canceled via preload IPC after the first generated text. |
| Successful control | Returned notes for a short synthetic budget decision. |

The historical SIGABRT did not reproduce. No shutdown patch was needed.

## DEV-1263 · Packaged regional selection

Used Settings → Notes model with an isolated profile and synthetic credential. Saved Europe, US and Global in turn. After each ordinary Quit and fresh launch, the visible selector and main-process settings matched the saved value. The key was still present. Each model catalog request used that region’s allowlisted URL. Unsaved changes left the saved destination intact. HTTP was intercepted for this check. No real OpenAI credential or regional project was used.

AI tests passed (81). Desktop tests passed (1,015 with eight skipped). AI and desktop typechecks, desktop lint, build and unsigned packaging passed.

## Verification boundaries

The fixtures are synthetic. Verification on Dev02 cannot establish the original customer's timings, the M2/8 GB outcome, or the M3 Balanced/Quality outcome. Signed distribution, updater handoff and publication are outside this run. Downgrading to an older client can reset the effective OpenAI destination to Global.

## Production preparation · November 21, 2026

Sean authorized release preparation, including review, commits, pushing and candidate qualification. Publication remains separate. Refetched `origin/main` still matches the recorded base `040ae864`. PR #285 remains a separate draft Windows performance stack; none of that stack is included here.

Two read-only reviews independently identified the same completeness gaps. Both are corrected:

- The local single-pass path now applies the same tokenizer context guard as condensation and reduction. Token-dense transcripts and oversized rough notes are rejected before generation instead of allowing context shifting.
- Retry slices containing multiline segments preserve literal text rather than using ambiguous line references. Single-line slices retain the measured recovery policy.

Both regressions failed before the fixes and pass afterward. AI suite: 83 passed. Desktop suite: 1,015 passed, eight skipped. MCP: 12 passed; database: 36 passed; local source index: 38 passed; web: 193 passed. Desktop/AI/source-index/web typechecks, web authentication smoke, web build and workspace lint passed during preparation. Native release builds and exact signed-candidate acceptance are tracked separately below; these development checks do not establish installed acceptance.

The full dependency audit initially reported seven advisories in MCP's transitive Hono packages. Security floors were raised to `hono` 4.13.16 and `@hono/node-server` 2.1.6; the frozen-lockfile install, MCP tests and repeated audit passed, with no known vulnerabilities reported. No direct dependency ranges were changed. See [Hono advisory](https://github.com/advisories/GHSA-4h7h-rv7c-7m2v) and [Node server advisory](https://github.com/advisories/GHSA-qv5m-9pm6-hqp3).

The website changelog labels 1.0.2 **Unreleased** and describes bounded recovery and explicit endpoint selection without claiming the historical quit crash was fixed.

Sean confirmed no eligible regional OpenAI test projects are available. Live US/EU generation remains unverified; mocked routing/persistence/error evidence is retained. No regional eligibility or residency compliance claim is made.

### Remaining release gates

- Required GitHub CI and code-owner approval for the exact proposed source. Current rules require one approval, approval of the latest push, resolved review threads and the `checks` job.
- Signed/notarized candidate, retained receipt and payload hashes, Gatekeeper/staple verification.
- Exact installed candidate: generation, cancel/retry, quit/relaunch, capture/data preservation and offline cached behavior.
- Isolated 1.0.1 → 1.0.2 installation and updater handoff, without changing the public feed or using personal meeting data.
- Receipt-bound publication dry-run and rollback evidence, followed by separate publication authorization.

Rollback: retain the published 1.0.1 artifacts and current updater manifests. No library migration is introduced. A downgrade can ignore the regional setting and use Global; preserve this warning in the release decision. Do not overwrite versioned artifacts or rebuild between accepted QA and publication.
