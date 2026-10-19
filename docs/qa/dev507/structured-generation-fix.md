# DEV507 structured-generation checkpoint

2026-10-18. Focused candidate above `24af3396320259258b20b72ae28113958595330b`; the commit containing this document identifies the exact tested source. PR233 remains stacked on PR230, production gate OFF. No native model or timing jobs ran for this change. Fresh independent review precedes any separately coordinated six-case native diagnostic.

## Production and consumer contract

- `packages/ai/src/cited-ask-prompt.ts`: question-focused contract prompt and bounded schema using the pinned node-llama-cpp 3.20.0 supported subset. Final included evidence IDs alone form the enum. Insufficient answers have no claims; other answers have at most 12; conflict requires two to four references and a first conflict claim for conflicting status. Fewer than two distinct included IDs removes conflict branches.
- `packages/ai/src/local-engine.ts`: compile through the current loaded runtime's public `createGrammarForJsonSchema` after final inclusion/empty return, then pass the grammar only to cited `promptWithMeta`. Cancellation/deadline waits for compilation settlement before context disposal; no inference after cancellation. Generic generation, raw forwarding, 4096 output reserve, 256 margin, full wrapper token accounting/hash and strict output-limit handling remain.
- **Only changed shared contract file:** `apps/desktop/src/shared/cited-ask-api.ts` exports `CITED_ASK_PROMPT_VERSION = 2`; snapshot policy type accepts historical 1 and current 2. Service signatures are unchanged. DEV509 must continue using shared service admission, not invent a current-policy predicate.
- `apps/desktop/src/main/cited-ask-service.ts` emits version 2 for every new non-error snapshot, including no-history/insufficient without generation, and rejects version 1 as stale before source/model admission. `cited-ask-validation.ts` retains structural decoding for version 1. Its `parseCitedClaims` function is byte-identical to the base.
- No Home/App/preload/index, calendar module, original data or history migration changes. Hydration and denied old-policy citation/play preserve history bytes. Appending current history preserves historical objects and unknown fields.

## RED and focused commands

All ledger filenames below are under the exact local directory:

`/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/.superpowers/sdd/2026-10-18-dev507-cited-ask/`

```sh
pnpm --filter @repo/ai exec tsx --test src/cited-ask-grammar.test.ts
pnpm --filter desktop exec tsx --test --test-name-pattern='prompt policy' src/main/cited-ask-service.test.ts
pnpm --filter desktop exec tsx --test --test-name-pattern='mixed prompt-policy' src/main/home-cited-controller.test.ts
pnpm --filter desktop exec tsx --test src/main/cited-ask-structured-output.test.ts
```

- `grammar-old24-clean-red.log`: desired grammar/adapter regressions against old24, six failures/two passes/zero skips. The earlier `grammar-old24-red.log` is retained with its test-harness unhandled-assertion warning; the clean run corrected that harness observation, not production behavior.
- `prompt-policy-old24-red2.log`: both policy regressions fail before the change; earlier single-test `prompt-policy-old24-red.log` retained.
- `policy-home-old-admission-red.log`: mixed history hydration expects stale but gets valid with the exact old24 service blob temporarily substituted into the candidate harness. This is an old-admission experiment, not a full old24 archive run; the candidate service was restored before GREEN.
- `grammar-green1.log`, `prompt-policy-green.log`, `grammar-desktop-focused.log`: focused GREEN evidence, subsequently covered by full suites below.

The grammar test imports only the installed pinned **pure schema compiler and validator**, without importing the native entry point. It checks supported root/status branches, total prefix-inclusive caps, one/four/two-reference boundaries, final shortened IDs, omitted/zero IDs, request-local grammar identity, the current runtime after context recovery, cancellation before/during compile, deadline/error ownership, maxTokens and disposal. The real adapter runs with a fake session/runtime and synthetic wire token accounting. These checks do **not** prove native grammar sampling.

Service/history tests cover generated/no-history/insufficient version 2, version 1 rejection before source/model work, mixed version append/hydration, denied historical citation/play/run reuse, preserved raw bytes on reads/denial and preserved historical unknown fields on append.

## Required final checks

| Exact command | Result | Ledger |
| --- | --- | --- |
| `pnpm --filter @repo/ai test` | 82 passed, zero skipped | `grammar-ai-full.log` |
| `pnpm --filter @repo/ai typecheck` | passed against pinned public API | `grammar-ai-types-final.log` |
| `pnpm --filter desktop typecheck` | node and web passed | `grammar-desktop-types-final.log` |
| `pnpm --filter desktop test` | 532 passed, eight existing native-prerequisite skips, zero failures | `grammar-desktop-full.log` |
| `pnpm lint` | passed; web task cached, desktop task executed | `grammar-root-lint.log` |
| `pnpm --filter desktop build` | passed | `grammar-desktop-build.log` |
| `/Library/Developer/CommandLineTools/usr/bin/git diff --check` | passed | final checkpoint |

No broad suite repetition after these checks. Formatting preceded the final desktop checks. New tests are `packages/ai/src/cited-ask-grammar.test.ts` and `apps/desktop/src/main/cited-ask-structured-output.test.ts`; existing adapter/service/Home controller tests were extended.

## Immutable evidence and remaining limits

The saved 33-case native79 replay remains **eight structurally accepted / 25 rejected**, plus the separately preserved interrupted attempt; 67 cases remain unperformed. The new strict replay regression reads and hashes the unchanged original packet. No output repair, parser relaxation, retry, corpus/rubric change or denominator substitution occurred.

- Packet SHA256: `03099a2de708a36bdeff6d4930bbbaa7e83e944f88a5cd25a97ab2d6a142adcb`.
- Frozen corpus SHA256: `0c2ed0eb2408cbff8cfc85dfad5bbbc8367a0421d0e26c4dc9780148f525b2c2`.
- Rubric SHA256: `782d8ac7def0d49073a7b5a304d6204761f2f9da05a6418fd2f597c800bc5777`.

The supported schema does not guarantee unique IDs, nonblank strings, UTF-16 limits, relevance or factual correctness. Strict downstream duplicate/nonblank/UTF-16/membership checks remain and hostile fixtures still fail. Human factual/semantic assessment remains separate. Native grammar compilation/sampling, its runtime cost, current Windows CI/native media, combined DEV509 integration and human/codeowner review are unqualified. The earlier 1k relative latency failure and full-request scan cost remain; no timing thresholds changed.

**Check this:** run the focused commands above. Expect the grammar compiler/schema controls and fake-session cancellation barriers to pass; historical policy hydration must produce stale entries without answers or source/audio access, while a new request appends a version 2 snapshot. Run the saved-output replay and expect eight accepted/25 rejected, not improved native outcomes. Next gate is fresh immutable review, then the parent-coordinated bounded diagnostic; production remains OFF.
