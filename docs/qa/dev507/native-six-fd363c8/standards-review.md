# Independent STANDARDS review — focused DEV507 structured generation

## Axis report (under 400 words)

**No actionable findings: 0 documented-standard violations; 0 reportable subjective smells.** This conclusion applies only to the direct immutable candidate delta below, not the complete stack or rollout qualification.

BASE `24af3396320259258b20b72ae28113958595330b`; HEAD `fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8`. The merge-base equals BASE; the range contains one commit, `fd363c8 fix: constrain cited generation to final evidence schema`, touching 11 files (+798/−6).

The change follows CONTRIBUTING.md's focused-change, existing-package-pattern, compatibility-test and unfinished-feature-gating rules. AI retains its structural DTO boundary without a meetings-store runtime dependency. Grammar construction is localized beside the cited prompt and uses the existing loaded runtime only after final inclusion. The shared policy constant and service admission avoid a second consumer predicate; historical decoding remains separate from current eligibility. No service signature, production Home/UI/index/preload or persistence implementation changes occur.

Tests exercise observable admission, byte/object preservation, final-wire IDs, cancellation settlement and ownership. The fake-runtime/transpilation fixture follows the existing adapter-test pattern; extracting a generalized harness is not warranted as a blocking duplication complaint. The checkpoint distinguishes pure schema validation and synthetic adapter checks from actual sampling and human semantic quality, including the limited OLD-service substitution experiment.

Independent narrow validation: **13 passed, 0 failed, 0 skipped** (8 grammar/adapter, 2 policy, 1 history, 2 strict-output tests). Parser bytes and all three supplied frozen-artifact hashes are unchanged. Saved replay remains 33 cases: 8 accepted, 25 rejected. Author broad-suite ledgers were inspected, not rerun.

The lane started clean at `43f4850f0ea07dcde4da48b1b94c27996f4d735c`, with zero own commits; only that empty lane was rebased onto HEAD. It remains clean with zero review commits. PR230 → PR233 → PR232 are linked and unwatched. No nested agents, fixes, source edits, commits, PR posts, native runtime/model loading, personal data, devices or benchmarks were used.

Gate remains OFF. Native sampling/cost, 67 remaining semantic cases, human scoring, Windows, packaged qualification and the prior 1k relative latency failure (+46%) remain unresolved; they are not findings against this focused change.

## Evidence appendix

All review artifacts are in `/tmp/dev507-standards-fd363c81.QiuSrh/` outside the checkout.

### Immutable scope and lane

All Git commands used `/Library/Developer/CommandLineTools/usr/bin/git`.

```sh
/Library/Developer/CommandLineTools/usr/bin/git rev-list --count 43f4850f0ea07dcde4da48b1b94c27996f4d735c..HEAD
/Library/Developer/CommandLineTools/usr/bin/git rebase --onto fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8 43f4850f0ea07dcde4da48b1b94c27996f4d735c
/Library/Developer/CommandLineTools/usr/bin/git diff 24af3396320259258b20b72ae28113958595330b...fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8
/Library/Developer/CommandLineTools/usr/bin/git log 24af3396320259258b20b72ae28113958595330b..fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8 --oneline
/Library/Developer/CommandLineTools/usr/bin/git merge-base 24af3396320259258b20b72ae28113958595330b fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8
/Library/Developer/CommandLineTools/usr/bin/git diff --check 24af3396320259258b20b72ae28113958595330b...fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8
/Library/Developer/CommandLineTools/usr/bin/git status --porcelain=v1
/Library/Developer/CommandLineTools/usr/bin/git rev-list --count fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8..HEAD
```

Artifacts: `candidate.diff`, `commits.log`, `final-state.json`. No global Git/signing/license settings were changed; no root or sibling lane writes were performed. Ignored dependencies were installed only in this review lane.

### Standards and source review

Read the complete 11-file diff, CONTRIBUTING.md, root and desktop READMEs, meetings-store README, .github/CODEOWNERS, docs/global-ask-budget.md, docs/cited-ask.md, docs/recipes.md, both DEV507 QA component READMEs, and the full approved spec/plan:

- `docs/superpowers/specs/2026-10-18-dev507-cited-ask-design.md`
- `docs/superpowers/plans/2026-10-18-dev507-cited-ask.md`
- `docs/qa/dev507/structured-generation-fix.md`
- `/tmp/dev507-structured-research-5mz5dbr1/REPORT.md`

No applicable AGENTS.md was found; apps/web/AGENTS.md is outside scope. The approved stack supersedes the generic main-branch guideline. Tooling-enforced style is excluded from findings.

Related code inspected: complete prompt/local-engine paths, service and validation, shared API, history store and Home admission/playback paths, generation deadlines, existing adapter fixture and AI exports. The baseline smell categories were applied as judgment calls, without hypothetical redesign demands.

### Independent narrow checks

Environment: Node v24.22.0, pnpm 10.33.2. Cached frozen installation:

```sh
COREPACK_ENABLE_NETWORK=0 pnpm install --offline --frozen-lockfile --ignore-scripts
```

`offline-install.log`: 1,022 packages reused, zero downloaded, lifecycle scripts disabled.

Each command below ran with these environment prefixes:

```sh
NODE_OPTIONS='--import=/tmp/dev507-standards-fd363c81.QiuSrh/no-native.mjs' COREPACK_ENABLE_NETWORK=0
```

`no-native.mjs` installs a load hook that rejects native `.node` modules and the node-llama-cpp native package entry. The permitted pure installed 3.20 schema utilities and fake runtime do not load a model.

```sh
pnpm --filter @repo/ai exec tsx --test src/cited-ask-grammar.test.ts
pnpm --filter desktop exec tsx --test --test-name-pattern='prompt policy' src/main/cited-ask-service.test.ts
pnpm --filter desktop exec tsx --test --test-name-pattern='mixed prompt-policy' src/main/home-cited-controller.test.ts
pnpm --filter desktop exec tsx --test src/main/cited-ask-structured-output.test.ts
```

Logs respectively: `grammar.log` (8/0/0), `policy.log` (2/0/0), `history.log` (1/0/0), `replay.log` (2/0/0), expressed as passed/failed/skipped. All exited 0. No broad suites, native QA, inference or benchmark were run.

### Immutable preservation and historical evidence

`integrity.json` records independent byte comparisons of BASE, HEAD and current frozen artifacts, plus parser-body comparison from `export function parseCitedClaims(` to the next exported function. Parser body SHA256: `c588739cb5effd554d72a7641fae679dae2c3d94884b75f8d750f05994019caa`.

- Packet `docs/qa/dev507/native-evidence-79e506a.jsonl.gz`: `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb`.
- Corpus `docs/qa/dev507/quality-corpus-v1.json`: `0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2`.
- Rubric `docs/qa/dev507/quality-rubric.md`: `782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777`.

The supplied historical diagnosis retains 18 trailing-root-quote errors, four >12-claim outputs, two conflicting statuses without a conflict claim, and one single-reference conflict. Historical must-find wire inclusion is 20/20 with only four valid outputs. These are prior evidence, not new native measurements; no parser repair or denominator change was performed.

Author ledgers inspected under `/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/.superpowers/sdd/2026-10-18-dev507-cited-ask/`: `grammar-old24-clean-red.log` (6 failures, 2 passes), `prompt-policy-old24-red2.log` (2 failures), `policy-home-old-admission-red.log` (1 failure), `grammar-ai-full.log` (82 passes), `grammar-desktop-full.log` (532 passes; eight existing native-prerequisite skips), and final AI types/root lint/desktop build logs. These establish recorded author results, not independent broad execution or native acceptance.

T3 final list confirmed all three stack links and `watching:false` for each. Parent retains integration and separately authorized diagnostic coordination.
