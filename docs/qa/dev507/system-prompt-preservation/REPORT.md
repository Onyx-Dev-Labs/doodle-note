# System prompt preservation and shared policy 3

2026-10-19 UTC. Focused production/test repair above evidence-only `e394cf069c695fda501ccf11a6bf608da660285f`. The containing commit is the candidate; `tested-source-sha256.json` binds the six tested source files. Native sampling remains stopped pending fresh independent review. Production rollout remains OFF.

## Problem and supported fix

Pinned node-llama-cpp 3.20.0 `LlamaChatSession` defaults `forceAddSystemPrompt` to false. Its actual constructor omits supplied system history when the selected wrapper reports `supportsSystemMessages: false`. Gemma reports false but supports folding explicit system history into the user turn using its own delimiter. The previous engine supplied `systemPrompt` without forcing its inclusion. Consequently both the model's effective input and the engine's session-history-based accounting omitted those rules on Gemma.

The sole engine change sets the public `forceAddSystemPrompt: true` option in the existing `runRaw` session constructor. There is no custom prompt concatenation. The pinned wrapper retains responsibility for serialization; Gemma receives one folded system instruction, without unsupported literal system-role tokens. Qwen and Llama 3 controls retain byte-identical serialization and token arrays to the old default. All current catalog wrapper families are covered. No unsupported-wrapper workaround silently removes system history; wrapper errors retain the existing propagation/cleanup path.

The same session serves cited Ask, global Ask, bounded Fetches, per-meeting Ask and notes. Existing budget callbacks use that session's actual history and wrapper. Full system/user/wrapper input now contributes to their count/hash, including evidence shortening, zero-evidence and fixed-input budget exhaustion. Textual system prompts, schema, strict parser, user source text, temperature, context, output reserve, margin, generation deadline and drain behavior are unchanged. No model, UI, main composition, preload or sibling changes.

## Shared contract and history

- `apps/desktop/src/shared/cited-ask-api.ts`: `CITED_ASK_PROMPT_VERSION = 3`; historical `promptVersion` type accepts `1 | 2 | 3`.
- `apps/desktop/src/main/cited-ask-validation.ts`: structural decoding accepts those three known policies. It does not confer current validity.
- The existing shared `MainCitedAskService.validate` rejects policies 1 and 2 before source/model work. Its existing constant use stamps **every new non-error snapshot**, including no-history and insufficient/no-model paths, with policy 3. Service signatures and instance ownership are unchanged. DEV509 must consume this same validator/constant, not construct another predicate.
- Mixed historical/current hydration and append preserve raw history bytes on reads/denied operations and preserve old objects/unknown fields on append. Old citation, playback and run-cache admission are denied; a new run yields current policy 3. No historical original or snapshot is rewritten to appear current.

This supersedes policy 2 for current admission only. Earlier evidence reports remain accurate descriptions of their immutable historical source.

## RED and GREEN evidence

Original local ledgers: `/private/tmp/dev507-system-fix/wrapper-red.log` and `/private/tmp/dev507-system-fix/policy-red.log`; byte-identical `.txt` copies are here. OLD is `e394cf0` (production `fd363c81`). Before the fixes, the desired actual-Gemma-wrapper assertion failed **0 system occurrences versus 1**, and four policy tests failed, including policy-2 history being **valid instead of stale**. Minimal wrapper GREEN and expanded six-test GREEN are retained separately.

The new AI test evaluates the **actual pinned session constructor/history implementation**, with only its native Chat dependency stubbed, and invokes actual pure Gemma/Qwen/Llama3 wrappers. It is not a fake class that merely echoes constructor options. Model, context, tokenizer and native generation are synthetic; byte-token accounting demonstrates boundary consistency, not real tokenizer/native sampling qualification. Existing grammar compilation, cancellation, errors and drain tests run in the full AI suite.

| Command | Result |
| --- | --- |
| `pnpm --filter @repo/ai exec tsx --test src/local-engine-system.test.ts` | 6 pass; wrapper preservation, all local paths, Qwen/Llama3 unchanged wire, full budgeting, shortening/empty/exhaustion, disposal |
| `pnpm --filter desktop exec tsx --test --test-name-pattern='policy\|historical prompt' src/main/cited-ask-service.test.ts src/main/home-cited-controller.test.ts` | 4 pass; current3/old1+2, no-model states, history/citation/play/cache |
| `pnpm --filter @repo/ai test` | 88 pass, 0 skips/failures |
| `pnpm --filter @repo/ai typecheck` | Pass against pinned public API |
| `pnpm --filter desktop test` | 533 pass, 8 existing native-prerequisite skips, 0 failures (541 total) |
| `pnpm --filter desktop typecheck` | Node and renderer types pass |
| `pnpm lint` | Pass; desktop executed, web cached result replayed |
| `pnpm --filter desktop build` | Main/preload/renderer build pass; not installed/package/native QA |

Eight existing desktop skips require native startup recovery, media import and Whisper prerequisites. They are not passes. No broad suites were repeated after these passed. This repair does not change dependency manifests or native engine code.

## QA observer candidate, offline only

`observer-wire.mjs` and `observer.test.mjs` are an external QA candidate, not production and **not used for any native run**. Five offline checks pass with the native import blocker:

```sh
/private/tmp/dev507-quality-annby45k/helpers/node \
  --import /private/tmp/dev507-quality-annby45k/offline/no-native.mjs \
  --test /private/tmp/dev507-system-fix/observer.test.mjs
```

Actual pure wrappers construct full current-request wire from actual history, including a faithful empty-history Gemma fixture. Optional initial-system metadata may be absent; exact wire serialization/token array/hash, context, same grammar/runtime and budget checks remain mandatory. Exact prompt/options/receiver/result object, raw response bytes, stop reason, errors and abort signal propagate unchanged. Wrong wire/grammar fails before forwarding. The old empty-history access is retained as an expected failure control. This does not manufacture history, skip accounting, change generation options or repair outputs. The candidate's tests contain absolute local dependency paths as provenance. A successor runner/freeze has **not** been created and requires review first.

## Preserved aborted diagnostic and model

[Separate aborted packet](../quality-aborted-fd363c8/REPORT.md), evidence-only commits `e047d4f558313737e23e62b9662e438a94db6c6a` and `e394cf069c695fda501ccf11a6bf608da660285f`: **two actual Qwen generations, zero Gemma generations**, first Gemma observer failure before native generation, seven remaining ledger rows unperformed. Qwen sentinel outputs remain historical policy 2: genuine conflict recognized with redundant claims; unknown password correctly abstained. No Gemma quality conclusion. Prior Gemma preflight omitted system rules and is not a valid fixed-source baseline.

The acquired artifact remains read-only at `/private/tmp/dev507-quality-annby45k/model/gemma-3-12b-it-Q4_K_M.gguf`: pinned revision `d15e4c7dc21dc55d56bf8549db57a71ad8a2a35d`, size **7300778336**, SHA256 **15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff**, mode **0444**. Aborted-run pre/post size/hash/mode/inode/mtime, originals/marker, frozen corpus, prior roots and source integrity passed; all 13 models/contexts disposed and child exit verified. No model load, download, inference or performance job occurred during this repair. All older packets remain unchanged, including original 33/8/25/67/interrupted accounting and rejected relevance/schema-order experiments.

## Check this before native continuation

- On immutable candidate, independently replay OLD/FIXED actual-constructor wrapper regression: Gemma rules occur once and Qwen/Llama3 wire remains equal.
- With historical policies 1 and 2 plus current 3, hydrate/append history: historical bytes/unknown fields survive, old citation/play/cache is denied, and all new empty/generated snapshots use 3.
- After review and parent authorization, create a fresh isolated successor using the retained exact artifact. Recompute all eight actual-tokenizer/full-system preflights before sampling; do not reuse the invalid old Gemma budget baseline or overwrite old results.

Remaining gates: fresh independent Standards/Spec review, actual fixed-Gemma runtime/tokenizer and capability diagnostic, factual quality/human semantic scoring, 1k relative latency and full request cost, combined-stack/human CODEOWNER review, Windows and packaged native UI/audio QA. No claim of factual improvement, native success, human acceptance or release readiness. Stack remains [230](https://github.com/Onyx-Dev-Labs/doodle-note/pull/230) → [233](https://github.com/Onyx-Dev-Labs/doodle-note/pull/233) → [232](https://github.com/Onyx-Dev-Labs/doodle-note/pull/232), unmerged and unwatched.
