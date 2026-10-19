# Independent Standards review — PR233 system-prompt repair

Result: **No findings.** Hard documented violations: **0**. Actionable labelled baseline heuristics: **0**. This is the Standards axis only; no Spec-axis review or cross-axis ranking is claimed.

## Immutable scope and isolation

- BASE: `e394cf069c695fda501ccf11a6bf608da660285f`.
- FIX: `f7f43c7d8a898a61015650b44a218167c1dedf76`.
- Exact diff: `/Library/Developer/CommandLineTools/usr/bin/git diff e394cf069c695fda501ccf11a6bf608da660285f...f7f43c7d8a898a61015650b44a218167c1dedf76`.
- Log over BASE..FIX contains exactly one commit: `fix(ai): preserve system prompts across local model wrappers`. Full patch and log are retained beside this report.
- Review lane: `/Users/sean/.t3/worktrees/doodle-note/t3-9542d8ec`, separate from author lane `t3-d30e320c`. Started clean at the supplied shared `43f4850f0ea07dcde4da48b1b94c27996f4d735c`; that DEV-512 documentation commit is outside FIX ancestry but belongs to multiple existing branches, including its origin branch. It was not a review-lane-only commit. Switched only this lane to detached FIX using the specified Git binary; no commit was created or branch reset. Final tracked/untracked status is clean.
- No author/root/sibling source edits, implementation, subagents, model/cache discovery, native runtime/model loads, downloads, app/GUI/device/account/personal-data activity, global changes, performance jobs, pushes, merges, PR comments or reviews. T3 thread metadata links PR233 only; no watcher was started.

## Standards assessed

Read `/Users/sean/.agents/skills/code-review/SKILL.md`, applying only Standards under the user's explicit no-delegation restriction. Repository discovery found root `CONTRIBUTING.md` and web-only `apps/web/AGENTS.md` / `CLAUDE.md`; the web files do not govern these hunks. No deeper applicable AGENTS/CLAUDE/CONTRIBUTING/CODING_STANDARDS files or ancestor instruction files were found.

Primary rules: CONTRIBUTING “Before you start” 3–4 (focused changes and no real/private fixture data), “Making a change” (package patterns, behavioral/compatibility tests, local-first defaults, gated unfinished features, accurate documentation), and “Verification” (narrow checks first). Read desktop README boundaries and CODEOWNERS; no human-owner approval is claimed. Read the supplied DEV507 design/plan and `docs/cited-ask.md` for context, plus relevant global-Ask budget and Fetches boundaries. These do not expand this review into unrelated historical branches or future UI/rollout gates. Formatting, typing and lint-enforced style are excluded as review findings.

Reviewed the full production/test delta and new QA packet. The three production files retain the existing ownership pattern: the public session option is set at the shared constructor (`local-engine.ts:318–325`); one shared current-policy constant/type is updated (`cited-ask-api.ts:8,54`); structural historical decoding is extended (`cited-ask-validation.ts:199`). Existing `MainCitedAskService.validate` rejects noncurrent policies before source/model work. No duplicate consumer policy implementation or wrapper-specific production concatenation was added.

All twelve requested smell heuristics were considered. No actionable introduced instance was found. The test subclass is an intentional native-isolation seam, not Refused Bequest in production; independent expected-wrapper construction is useful test verification, not an extraction requirement. VM evaluation follows existing package tests. Small historical policy literals/type alternatives do not justify a new abstraction. QA observer absolute paths are explicitly archived provenance, not a newly required portable test command. Historical log whitespace is not treated as a production standard breach.

## Independent replay

Dependencies were initially absent. Ran `pnpm install --frozen-lockfile --offline --ignore-scripts`: all 1,022 packages reused, **zero downloaded**, lifecycle scripts disabled. Lockfile unchanged. Exact Node/pnpm/library/tsx/TypeScript versions and library/source SHA256s are in `pins.json`.

Each command, cwd and exit code has a companion JSON file; complete stdout/stderr and pure-library import traces are preserved.

- `wrapper-green`: **6/6 pass** on FIX. Actual pinned 3.20.0 session constructor/history code evaluated with dependency stubs, actual pure Gemma/Qwen/Llama3 wrappers. Covers once-only rules, wrapper count/hash consistency, Qwen/Llama3 unchanged serialization, local API paths, oversized-system rejection, Unicode shortening, empty paths and disposal.
- `wrapper-red`: same FIX assertions against a temporary BASE export: **4 expected Gemma failures, 2 Qwen/Llama3 passes**. Gemma full rules occur zero times; oversized system incorrectly reaches synthetic generation. Production source bytes checked against BASE.
- `policy-green`: **4/4 pass** with `--test-name-pattern=policy|historical prompt` on the two changed desktop test files. Current policy 3, historical 1/2 readability, stale admission, exact-byte read/denied-operation preservation and unknown-field append preservation.
- `policy-red`: same assertions on BASE: **4 expected failures**, including policy 2 `valid` instead of `stale` and new snapshots stamped 2 instead of 3.
- `observer-green`: **5/5 pass**. Only the archived observer test's absolute dependency prefix was rebound to this review lane, in a temporary copy; production/committed files untouched. Verifies forwarding identity/raw result/error/cancellation and refusal of wire/grammar drift.
- `ai-types`: `node node_modules/typescript/bin/tsc --noEmit` in packages/ai: **exit 0**.
- QA packet integrity: all **22** manifest/source-hash entries match (`manifest-verification.json`). This verifies stored integrity, not that historical broad-suite claims independently ran in this review.

The BASE export uses this lane's frozen dependency links and the three FIX test files, while the three changed production files remain exact BASE bytes. Desktop tests use unchanged workspace prompt/source libraries; engine tests explicitly read the production source from their respective cwd. No checkout mutation was used to obtain RED.

`no-native.mjs` blocks native addon loading (`process.dlopen` and `.node`), node-llama-cpp entry/runtime/evaluator paths, Electron and sherpa runtime imports. VM dependency resolution separately rejects unlisted dependencies. Initial wrapper attempts stopped because the blocker also rejected the pure `bindings/types.js` enums/functions; these attempts are preserved as `*.initial-blocker.*`, are **not** counted as behavioral RED, and were corrected after inspecting that file. Only that exact pure module was exempted. Successful import logs contain pure wrapper/util/config/type modules, no native runtime. Models, contexts, generation and byte tokenization remain synthetic.

## Limits

These checks prove the exercised constructor/wrapper and compatibility boundaries, **not native generation, native token counts, actual sampling input, semantic answer quality, packaged behavior, whole-suite regression freedom, or release readiness**. The complete AI/desktop suites, desktop build, root lint and native QA were not rerun. The 88/533 broad-suite counts remain author claims in historical evidence; their files were hash-verified only.

Production stays OFF. No approval of gated continuation or rollout follows from this review. Historical aborted diagnostic remains two Qwen generations, zero Gemma generations and seven unperformed rows; this review neither resamples nor relabels it a Gemma quality failure.
