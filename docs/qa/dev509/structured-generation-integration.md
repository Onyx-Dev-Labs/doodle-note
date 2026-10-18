# DEV509 software integration of the structured-generation candidate

Shared candidate: `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8` (parent `24af3396320259258b20b72ae28113958595330b`). Tested combined source: `0af05b8695a000745eaf6f4d3810373250fdd9f3`. This document's commit adds evidence only. Production remains OFF; shared independent grammar reviews are separately owned and not claimed accepted here.

## Rebase and ownership

Exclusive lane `/Users/sean/.t3/worktrees/doodle-note/t3-c80f9eb4`, branch `t3/calendar-context-brief-integration`, PR232 stacked on DEV507 PR233 above PR230. Before integration both local and origin were `552c67ba8934bf13e8e2156dd10ea0d35685a78a`. Preserved `refs/dev509-checkpoints/pre-grammar-552`, `evaluator-r1-verified-562`, and all previous review/fix refs. Same Sean/agent claim refreshed and read back in Notion.

Only the 15 DEV509 commits above old common base `d6920bed9815ccc79a41b114fa1d856b097595a6` were rebased onto exact `fd363c8`. No conflicts or conflict resolutions; all 15 patches compare equal in [retained range-diff](grammar-rebase-range-diff.txt). Rebased head `8230951be17e5868526e542115c75e1cc8a44ae6`; test-only follow-up `0af05b8` changes only `brief-service.test.ts`. No shared or consumer production workaround, copied policy predicate, parser change or frozen-input edits. Push uses explicit old-origin lease `552c67ba8934bf13e8e2156dd10ea0d35685a78a`.

| Original exact commit | Rebased exact commit |
| --- | --- |
| `8e678616ad653d4f806f48e5c6ff8b18f40be239` | `9523caea11f9e4f4eabe0ab8f1002c284ba3a65b` |
| `8791b440ab880fda0cd53ee406b3e59c2908ad61` | `ffb8e1132b74ab0c9b4b0d995ed0c1fa92bd584e` |
| `ae995b80a7a595e0be8be615ba88acdd8d84c218` | `3fe887e4c5ba9e502ecae3e684761702a0a22739` |
| `a87ba20eb3c627c98255cb08a131a79ddd332c20` | `906cd0a4e1a9076fa1980414c6d8f54576a57201` |
| `110613946d68aa9507afab9c955caf049b11b818` | `cdb19dc4e0297dba3f6c95d733202abddce40bb8` |
| `ae41abdca6dcecd6a92fc67b83f28aeab7d8e31b` | `6ffa96b1679de7aae93216e2d4b6ea87a4004de4` |
| `f803481942872ffe483d8bc6920bd5a6f1f8b8b0` | `6de4331ed834aab9ff63d1ba56e80b4d75a48fa9` |
| `e505b2abe0621d53bdf40546d8e39910d2196879` | `c1c3aa94321aed0765593cec0ba1c6aa4be2d405` |
| `a891358990f9fcd795a2d5ee8aa0ab641ba6cce3` | `b0a6a95786b5c63e471db341330e8d6ddc803145` |
| `8b1b5758e7771115023e12e5dab129ca57276599` | `4e513073a8a41a6f5864c2cb43f145788616c281` |
| `a49b90578e66e15a5bf58d1edde604de16542155` | `860e87d3d14bcb762ebd9faca0fafd41cde79b45` |
| `5145d5a792c8629ad73542ba4a482cc562e4e9b1` | `db7ceb4ad0153a39a7a3ff9ff176bff344e205e9` |
| `be69595811370eaef8f409e726556a4a291e3259` | `0c603092e9d9ead83d38a0ba239e4259527ad4db` |
| `562d5eea17c4a8987c9c686cd930a71fba670dc7` | `d8c96442832f27f99323207c29d06c61e332ba56` |
| `552c67ba8934bf13e8e2156dd10ea0d35685a78a` | `8230951be17e5868526e542115c75e1cc8a44ae6` |

The independent evaluator R1 resolution remains pinned to original `562d5ee` against `be695958`; its unchanged rebased patch is `d8c9644`. Original documentation `552c67b` maps to `8230951`. These mappings do not broaden the original independent review scope. First handled signal only: repeated identical signals retain the failed stress evidence and may default-terminate during cleanup. No atomic/power-loss/native cleanup guarantee is asserted.

## Consumer contract and focused evidence

Brief continues to pass shared snapshots unchanged and calls shared validation on fresh admission, cache reuse, citation and playback. New shared version 2 applies to complete/no-history/insufficient snapshots; historical version 1 remains structurally decodable but stale by shared policy. Calendar context `templateVersion: 1` and snapshot envelope `version: 1` are different contracts and remain unchanged.

Three additional actual BriefService + MainCitedAskService tests cover all three result states. They check unchanged version-2 snapshots, refresh reuse without generation, rejected historical version-1 cache and fresh results, then explicit regeneration with current policy. Synthetic generator responses are test doubles, not native model evidence. No consumer behavioral change was necessary. Parent inspected the test-only delta and range-diff without scope objection; that was source inspection, not an independent rerun or grammar acceptance.

## Checks at clean source 0af05b8

Logs retained under `/tmp/dev509-grammar-integration-fd363`.

- `pnpm --filter desktop typecheck`: node/web passed; evaluator dedicated `tsc --noEmit -p scripts/dev509-brief-eval/tsconfig.json`, AI and meetings-store types passed (`types.log`).
- Nine focused Brief/context/start/IPC/installer/controller test files: 82 passed, zero skips (`focused.log`); three new policy scenarios also passed separately (`brief-policy.log`).
- Evaluator tests: 12 passed, zero skips. Existing frozen 24-case mechanical evaluator: all passed, 18 explicit mechanical-no-answer and six validated no-history; zero generated outputs, native false/model null, cleanup complete (`evaluator.log`). Both ran with the retained R1 review no-native guard rejecting AI/native runtime entry imports.
- One full combined `pnpm --filter desktop test`: 618 passed, eight existing skips, zero failures (626 tests). Llama/sherpa runtime imports blocked by the retained software-only module guard; explicit Whisper opt-ins cleared (`desktop-full.log`). No native app/model was launched.
- `pnpm --filter @repo/meetings-store test`: 51 passed, zero skips (`store.log`).
- `pnpm lint`: passed; desktop executed, web cached (`lint.log`). Evaluator scripts remain ESLint-ignored; their dedicated types/tests are the evidence.
- `pnpm --filter desktop build`: passed (`build.log`). Build only; no packaged/native execution. Diff check passed. No dependency/lockfile change; no additional audit or native smoke performed for this integration.

[Fresh mechanical summary](brief-mechanical-fd363c8-summary.json) records source provenance, all case outcomes and the full new report path/hash. It supplements the unchanged original report; it does not replace it. No benchmark/timing qualification or native/semantic quality run occurred. Incidental test/harness elapsed fields are not performance acceptance.

## Immutable inputs and gates

- DEV509 corpus SHA256: `e6e14b38187cd3ede5daca987177a614243f664864f6520e44393689663583e8`.
- DEV509 rubric SHA256: `e25080c419a4d6f10cfeee5a77573792895bdb95d9526d95bf20b01da70fd0c6`.
- Initial DEV509 mechanical report SHA256: `bc9668d540275d88d7948d011e65d2a446a1587384c05208b2c3bd9d5c92178e`.
- Original DEV507 native33 packet SHA256: `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb`. Historical results remain eight accepted/25 rejected, not a new native pass; 67 unperformed cases remain unperformed.

Shared grammar compiler/software checks do not qualify native sampling or reliability. Existing native failures, human support/semantic assessment, performance (including 1k relative latency), Windows/native media, human/CODEOWNER review and release gates remain open. No model lookup/load, inference, personal accounts/profiles/devices, release, merge or nested agents.

**Check this:** run `pnpm --filter desktop exec tsx --test --test-name-pattern='brief prompt policy' src/main/brief-service.test.ts` on the pinned software source; expect three passed scenarios and no real inference. Run the default evaluator under the documented no-native guard; expect 24 mechanical passes with zero generated outputs, not semantic/native approval. Await the parent's immutable shared review and separately coordinated diagnostic before any model use.
