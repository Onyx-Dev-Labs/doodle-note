# DEV507 focused immutable SPEC / behavior review

No actionable findings in this delta: no confirmed missing, partial, incorrect, or out-of-scope implementation of the authorized structured-generation correction. This is a bounded software review, not native or release qualification.

BASE: `24af3396320259258b20b72ae28113958595330b`
HEAD: `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8`

Exact reviewed commands:

```sh
/Library/Developer/CommandLineTools/usr/bin/git diff 24af3396320259258b20b72ae28113958595330b...fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8
/Library/Developer/CommandLineTools/usr/bin/git log 24af3396320259258b20b72ae28113958595330b..fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8 --oneline
```

One direct commit: `fd363c8 fix: constrain cited generation to final evidence schema`. Full diff and commit list: `pinned.diff`, `pinned.log` beside this report. Lane `/Users/sean/.t3/worktrees/doodle-note/t3-f0b533a9` began clean at `43f4850` with zero own commits. Only that empty lane was rebased onto exact HEAD. Final status clean, zero commits above HEAD, diff-check clean. PR230 -> PR233 -> PR232 linked and explicitly unwatched. No tracked edits, review commits, fixes, PR posts, original/history migrations, sibling-lane changes, or signing/global-setting changes.

## Evidence appendix

All artifact paths below are relative to `/tmp/dev507-spec-review-fd363c8/`.

### Contract and implementation trace

Read CONTRIBUTING.md, the entire approved design and implementation plan, full `structured-generation-fix.md`, and `/tmp/dev507-structured-research-5mz5dbr1/REPORT.md`. No ancestor AGENTS.md was found; the only repository AGENTS.md is `apps/web/AGENTS.md`, outside scope. The supplied correction explicitly supersedes the design's historical promptVersion=1 example. Code-review skill applied only to the requested SPEC axis; no nested agents or Standards duplication.

- Design `docs/superpowers/specs/2026-10-18-dev507-cited-ask-design.md:143`: “Preserve 4,096 output reserve + 256 safety and the existing deadline/disposal/CPU retry rules.” Local adapter `packages/ai/src/local-engine.ts:365` counts final wrapper wire, returns early with zero ranges, and at :390 compiles using the current loaded runtime. It awaits compilation inside the existing deadline/disposal scope, checks abort before/after, supplies grammar only to cited generation, forwards exact raw response bytes, rejects truncated outputs, and awaits disposal at :426. Current-runtime recovery, request-local grammar identity, generic no-grammar behavior, omitted/shortened IDs, raw forwarding, and output-limit paths pass fake-session tests.
- Design :145: “Claims cite only `prompt.ranges[].id`” and “Output is <=12 claims, <=4 refs per claim.” Schema `packages/ai/src/cited-ask-prompt.ts:61` derives its enum only from final ranges. Regular claims require 1–4 refs; conflicts 2–4. Root branches couple empty insufficiency, nonempty answered, and conflicting status with required first conflict; `prefixItems` counts inside the total 12. Duplicate single IDs remove the conflict alternative. No unsupported uniqueItems/pattern/contains/conditional keywords are used. Prompt :57 requests focused, distinct, relevant claims and preserves untrusted input/abstention constraints.
- Design :149: “stale cached answers withhold claim/source content”; :153: “Preserve legacy question/answer/time and unknown keys.” Shared constant `apps/desktop/src/shared/cited-ask-api.ts:9` is 2. Service :153 stamps all new snapshots before generated/empty branches; :291 rejects valid old policy before source/model admission. Decoder :195 still accepts historical 1. Unchanged Home controller history :224, resolve :269, play :310 and run-ID reuse all use shared admission. Unchanged store append preserves historical objects/unknown keys. Tests verify exact history bytes unchanged by reads/denials, old answers withheld, no audio calls, new version 2 append and original-byte preservation. Append reserializes the JSON array, as before; the claim is object/unknown-field preservation on append, not unchanged file formatting.
- Full parser region is byte-identical between BASE/HEAD (`integrity.json`). Strict duplicate-ID/reference, nonblank, UTF-16, membership and conflict checks still reject hostile responses. No automatic factual or relevance validator exists; as the design says, “quote membership is not entailment.” Grammar and parser cannot establish support or contradiction.
- Inspected full changed production files plus `generation-control.ts`, `global-chat-store.ts`, `home-cited-controller.ts`, `cited-ask-host.ts`, and relevant NotesService busy/model/disposal/policy call paths. No service signature, Home production, UI, index, preload, fallback or download changes occur in this delta.

### Commands and fresh results

Environment: Node v24.22.0, pnpm 10.33.2. Initial focused attempts found no tsx. `pnpm install --offline --frozen-lockfile --ignore-scripts` succeeded: 1,022 reused, zero downloads; `offline-install.log`. No native or package lifecycle scripts executed.

From the candidate root:

```sh
pnpm --filter @repo/ai exec tsx --test src/cited-ask-grammar.test.ts src/cited-ask-engine.test.ts src/cited-ask-prompt.test.ts
pnpm --filter desktop exec tsx --test src/main/cited-ask-service.test.ts src/main/cited-ask-structured-output.test.ts src/main/home-cited-controller.test.ts
pnpm --filter @repo/ai typecheck
pnpm --filter desktop run typecheck:node
packages/ai/node_modules/.bin/tsx /tmp/dev507-spec-review-fd363c8/independent-probe.mts
packages/ai/node_modules/.bin/tsx /tmp/dev507-spec-review-fd363c8/lifecycle-probe.mts
/Library/Developer/CommandLineTools/usr/bin/git diff --check
```

- `ai-focused.log`: 13 pass, 0 fail, 0 skip.
- `desktop-focused.log`: 59 pass, 0 fail, 0 skip.
- `ai-types.log`, `desktop-node-types.log`: pass.
- `independent-probe.log`, `independent-results.json`: 756 synthetic status/count/kind/reference combinations agree between expected contract, installed 3.20 pure validator, and independent expansion of emitted acyclic GBNF expressions. `compiled.gbnf` retained. Additional probes reject unknown IDs, additional keys, root trailing quote, and concatenated objects. Duplicate/blank/overlong astral cases retain parser rejection. Grammar character counting can differ from JavaScript UTF-16 length. Four-newline completion suffix is present; the pinned runtime's schema grammar strips its termination suffix. This regex expansion is not native grammar execution or tokenizer/sampler certification.
- `lifecycle-probe.log`: six independent real-adapter VM/fake-runtime scenarios pass: success, cancel+compile resolve, cancel+compile reject, compile error, deadline+compile resolve, deadline+compile reject. In every case the public request stays pending through a separately delayed context disposal. No inference after cancellation/error/deadline. No model or native entry imports.

### OLD regression reproduction

Temporary `old/` contains BASE archived AI sources and desktop sources, candidate regression tests, and cached node_modules links. No candidate tracked files were substituted or edited. AI tests load BASE relative modules; desktop tests exercise BASE admission/controller/decoder with candidate workspace AI dependencies. This is a bounded OLD admission experiment, not a whole-BASE installation/full-suite claim.

```sh
# cwd /tmp/dev507-spec-review-fd363c8/old/packages/ai
./node_modules/.bin/tsx --test src/cited-ask-grammar.test.ts
# cwd /tmp/dev507-spec-review-fd363c8/old/apps/desktop
./node_modules/.bin/tsx --test --test-name-pattern='prompt policy|mixed prompt-policy' src/main/cited-ask-service.test.ts src/main/home-cited-controller.test.ts
```

`old-grammar.log`: 6 expected failures, 2 passes, zero skips: missing schema builder/grammar/current-runtime grammar and cancellation compile barriers. `old-policy.log`: 3 expected failures, zero passes/skips: new snapshots remain 1 and old history hydrates valid rather than stale. All corresponding tests pass on candidate. Initial artifact extraction/bin-link setup errors were resolved before these substantive runs; they are not counted as regressions.

### Frozen replay / limits

Independent raw JSON.parse + production parseCitedClaims replay: 33 unique, 8 valid / 25 rejected. Exact exclusive split: 18 trailing-root-quote JSON failures, 4 over-12 claims, 2 conflicting status without conflict-kind, 1 conflict with one reference. No byte repair, retry, rubric/corpus changes, or denominator substitution. Per-case results retained in `independent-results.json`.

BASE, HEAD and working-copy bytes match for packet/corpus/rubric (`integrity.json`):

- Packet `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb`
- Corpus `0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2`
- Rubric `782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777`

The 67 unperformed semantic cases remain unperformed. Prior interrupted attempt stays outside the 33. Recorded 20 must-find wire hits / 4 valid are historical evidence, not a new native measurement. Gate remains OFF. Existing +46% 1k relative latency failure, full-request cost, native sampling, human semantics, Windows, packaged/device QA and combined DEV509 qualification remain open and are not new fix findings. No benchmarks, native app/model/inference, personal profiles/data or device access occurred. No broad AI/desktop suites, root lint or build were repeated; author-reported full checks were not relabeled as fresh reviewer runs.
