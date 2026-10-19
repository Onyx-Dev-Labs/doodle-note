# DEV509 integration of reviewed system-prompt preservation / policy 3

2026-10-19. Exact shared production base **f7f43c7d8a898a61015650b44a218167c1dedf76**. Tested combined source **ba078b5db788957d3bce01f0cd0503b5bb987e4c**. This document's commit adds evidence only. PR232 remains stacked on `t3/answer-library-questions` / PR233 above PR230, gate OFF. PR233 evidence head `bf4c04e06263fc6ad80c67782747e9cb550b162f` was read but not consumed; its production files match f7.

## Preserved lane and exact mapping

Same Sean/exclusive lane `/Users/sean/.t3/worktrees/doodle-note/t3-c80f9eb4`, branch `t3/calendar-context-brief-integration`; live claim read back before editing. Local/origin were clean `e1cabc8e926c3e866e847d4125522e724846e235`, preserved at `refs/dev509-checkpoints/pre-policy3-e1cabc8`. All previous reviewed/fixed refs remain. Root signing checkout and sibling lanes were not edited.

Rebased only 17 DEV509 commits above old base `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8` onto exact f7. No conflicts or resolutions; all 17 patches compare equal in [range-diff](policy3-rebase-range-diff.txt). Pure rebase head `cc290d68f53e8b00d84a95d2b6059f0434695f9f`. Separate test commit ba078b5 changes only `apps/desktop/src/main/brief-service.test.ts`. Push uses explicit expected origin `e1cabc8e926c3e866e847d4125522e724846e235`.

| Previous exact SHA | Rebased exact SHA |
| --- | --- |
| `9523caea11f9e4f4eabe0ab8f1002c284ba3a65b` | `ba79b3b860d7784158bcb8f505c7969c34d6b972` |
| `ffb8e1132b74ab0c9b4b0d995ed0c1fa92bd584e` | `6023aa88d63481a87b59f48fc9cdd9bbace0ca5a` |
| `3fe887e4c5ba9e502ecae3e684761702a0a22739` | `56498563db1492db93ab46325127b4ed43c5c48a` |
| `906cd0a4e1a9076fa1980414c6d8f54576a57201` | `4fb40088c851b48aea61f7d2f3fb93e476b3721e` |
| `cdb19dc4e0297dba3f6c95d733202abddce40bb8` | `9af7071c59a9fe41ca2c3acaa215257b658060ca` |
| `6ffa96b1679de7aae93216e2d4b6ea87a4004de4` | `1972176f10d0863e35f8589489e0aa1dc27382cf` |
| `6de4331ed834aab9ff63d1ba56e80b4d75a48fa9` | `76540a704f4ff258b1a358313a4bac682c3d475f` |
| `c1c3aa94321aed0765593cec0ba1c6aa4be2d405` | `c11ace14cd74cb35bcfdcfd9c52d1877b823f3e8` |
| `b0a6a95786b5c63e471db341330e8d6ddc803145` | `cb2daa7af79209a7c4702d4d9df6a5563b18dbb0` |
| `4e513073a8a41a6f5864c2cb43f145788616c281` | `cc7534703a72f8f7b958d6ebb913df35fb210c9d` |
| `860e87d3d14bcb762ebd9faca0fafd41cde79b45` | `484228a4ab317f9780f0629831f14417de1bcc01` |
| `db7ceb4ad0153a39a7a3ff9ff176bff344e205e9` | `18983b3d882eed0766494da2ba6edd10e4311e28` |
| `0c603092e9d9ead83d38a0ba239e4259527ad4db` | `fd457bedaf443f89a17eaa79cb68957409535d45` |
| `d8c96442832f27f99323207c29d06c61e332ba56` | `eb73c24b9d735bf1ca29570584d9b51eccf5f293` |
| `8230951be17e5868526e542115c75e1cc8a44ae6` | `c9e4575db9f28b6a8e9bc8913d787bc16e649909` |
| `0af05b8695a000745eaf6f4d3810373250fdd9f3` | `96b7f2f6e265718fe6b5c9512dbe045b44e8e186` |
| `e1cabc8e926c3e866e847d4125522e724846e235` | `cc290d68f53e8b00d84a95d2b6059f0434695f9f` |

Earlier independent fix scopes remain pinned to their originals. In particular evaluator R1 is still the independently resolved original be695958→562d5ee; its unchanged patch maps through d8c9644 to eb73c24. First-signal caveat docs552 map through8230951 to c9e4575. Repeated-identical-signal failed probes remain separate, not successes. No atomic/power-loss/native cleanup guarantee follows.

## Shared contract and meaningful consumer checks

Read the author [system-preservation report](../dev507/system-prompt-preservation/REPORT.md), full `/tmp/dev507-standards-review-3egdfzhn/REPORT.md` and `/tmp/dev507-spec-f7f43c7-0UloQv/REPORT.md`. The independent reports have no findings within their bounded offline scope. The public session forceAddSystemPrompt option retains system rules once through the actual Gemma wrapper; Qwen/Llama3 wire controls remain unchanged. Full-wire accounting/hash, service/owner/audio interfaces are unchanged.

Current shared policy is3; historical1/2/3 structural decoding does not confer current admission. Brief still forwards snapshots and calls the same shared validator for cache/fresh/citation/play. No duplicate policy predicate, constant, retrieval engine, grounding module or consumer production change. Calendar templateVersion1 and snapshot envelope version1 remain separate contracts.

Before adjusting tests, the three existing integration cases failed their obsolete literal2 expectation with actual3; retained `prior-fixture-policy2.log` is a fixture compatibility failure, not a new product defect. Expanded six scenarios cover complete/no-history/insufficient × historical1/2: current3 snapshot pass-through and cache reuse, old cached/fresh rejection, explicit current regeneration, and no refresh inference. Complete cases independently cover current citation/play, old citation stale, and old play denied before injected playback. All original/context bytes remain unchanged. Synthetic generated JSON and one-byte playback are test controls, not model/audio qualification.

## Checks at clean ba078b5

Logs retained in `/tmp/dev509-policy3-integration`.

- Six focused policy cases pass (`policy-green.log`).
- Brief/context/start/IPC/installer/controller tests: **85 passed, zero skips** (`focused.log`), including ownership, cancellation, invalidation, byte/source/context fences.
- Evaluator tests: **12 passed, zero skips**; existing frozen24 mechanical cases **24 passed** (18 explicit no-answer / six validated no-history). Zero generated outputs, native=false/model=null, cleanup complete, no semantic qualification (`evaluator.log`). All six no-history snapshots are current policy3.
- Types: desktop node/web, dedicated evaluator, and AI pass (`types.log`).
- One full combined desktop suite: **622 passed, eight existing skips, zero failures (630 total)** (`desktop-full.log`). Skips are not passes. Model-runtime import guard active and Whisper native opt-ins cleared.
- Root lint passes (desktop executed, web cached); build passes main/preload/renderer (`lint.log`, `build.log`). No app/package launch. Diff check passes. Evaluator scripts are ESLint-ignored, covered by dedicated types/tests.

Software tests used the retained model-runtime rejection guard `/tmp/dev509-grammar-integration-fd363/no-native-runtime.mjs`; evaluator commands used the stricter no-AI/native guard from `/var/folders/75/d5zbvvmj58v6lmpm5d2zjrjw0000gn/T/dev509-r1-independent-oj1kogvo/no-native.mjs`. No native/model/network QA, performance jobs or broad reruns after green. No dependency/lock changes, so no new dependency audit; no fresh native smoke. Store software had already passed51 at the previous integration and its source is unchanged by this policy fix; that is historical evidence, not a new run.

[Separate mechanical summary](brief-mechanical-f7f43c7-summary.json) records exact source, report path/hash and all24 results. New full report `/var/folders/75/d5zbvvmj58v6lmpm5d2zjrjw0000gn/T/dev509-brief-evaluation-AEbrzy/report.json` supplements, never replaces, earlier packets.

## Frozen evidence and quality limits

Compared byte-for-byte with preserved e1cabc8:

- DEV509 corpus SHA256 `e6e14b38187cd3ede5daca987177a614243f664864f6520e44393689663583e8`.
- DEV509 rubric SHA256 `e25080c419a4d6f10cfeee5a77573792895bdb95d9526d95bf20b01da70fd0c6`.
- Initial mechanical report SHA256 `bc9668d540275d88d7948d011e65d2a446a1587384c05208b2c3bd9d5c92178e`.
- Original native33 packet SHA256 `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb` (eight accepted/25 rejected/67 unperformed retained separately).

Parent's separate [eight-call quality diagnostic at evidence head bf4](https://github.com/Onyx-Dev-Labs/doodle-note/blob/bf4c04e06263fc6ad80c67782747e9cb550b162f/docs/qa/dev507/quality-capability-f7f43c7/REPORT.md) verified the corrected system at the native boundary, but **local cited semantic quality did not pass**. All six factual cases included irrelevant claims; four falsely declared conflict despite correct gold. Genuine-conflict/unknown controls were appropriate. Eight structural admissions are not eight quality passes, and there is no Brief native qualification or designated-human acceptance. This lane ran no model and does not depend on the parent's separate throwaway offline assessment-contract prototype.

Keep production OFF. Native reliability/semantic/support, human/CODEOWNER, performance including existing1k relative failure/full-request cost, Windows/native media, packaged UI/audio and release gates remain open. No merge/publish, model download/access, app/profile/device use or scope/cloud/local-original change.

**Check this:** `pnpm --filter desktop exec tsx --test --test-name-pattern='brief prompt policy' src/main/brief-service.test.ts` under the retained runtime guard must pass all six cases with synthetic generation only. Default evaluator under its stricter guard must retain24 mechanical/no-model results and unchanged originals, never claim answer quality. Parent owns subsequent review/quality decisions; no inference or prototype adoption is authorized by this software integration.
