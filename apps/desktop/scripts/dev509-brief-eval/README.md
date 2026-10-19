# Frozen pre-meeting brief evaluator

The approved24 cases and source/date/support rubric were committed as `a49b905` **before** this evaluator was implemented or run. Corpus SHA-256: `e6e14b38187cd3ede5daca987177a614243f664864f6520e44393689663583e8`. The reader refuses any changed corpus or rubric bytes. Frozen rubric SHA-256: `e25080c419a4d6f10cfeee5a77573792895bdb95d9526d95bf20b01da70fd0c6`. Production checkpoint remains8b1b575; this directory changes no production modules and does not change the disabled gate.

From repository root:

```sh
pnpm --filter desktop exec tsc --noEmit -p scripts/dev509-brief-eval/tsconfig.json
pnpm --filter desktop exec tsx --test scripts/dev509-brief-eval/evaluator.test.mts
pnpm --filter desktop exec tsx scripts/dev509-brief-eval/run.mts
```

The last command defaults to **mechanical, no inference**. It prints a new temporary report directory and runs24 disposable libraries sequentially. Each gets deterministic synthetic original/context bytes, canonical scoped calendar IDs, a synthetic source marker, real worker/cache, CalendarContextStore, BriefOriginals, MainCitedAskService and BriefService. The seed writes only a newly created fixture directory; production uses its ordinary reader and validation. No existing profile, accounts, recording devices or model files are inspected.

For18 cases the evaluator captures actual service request and generator-boundary input, then throws a distinct stop sentinel. The service reports an explicit error with no generated answer. This expected **mechanical-no-answer** is not abstention, model success or quality failure/pass. Six absent/unknown cases must produce validated no-history and never enter the generator. Raw/projection revisions, complete source bundles, gold resolved passages/ranges/dates, exact selected IDs, original/context bytes and hashes are preserved in the report. Actual native prompt inclusion is **null**, never fabricated from a token approximation. A wrong sentinel/error, wrong date/range, missing selected source or changed bytes fails mechanical checks.

The runner retains per-case failures and continues to account for all24 cases. It does not run retries or fix output. The first handled SIGINT or SIGTERM retires the owned BriefService operation and awaits its shared producer cleanup, then marks remaining cases not-run-cancelled. This synthetic cancellation control is not a native cleanup timing result. Fixture roots/workers are disposed after each case; report/corpus/rubric copies survive under the printed output directory. Read `mechanicalGates` separately from `acceptance:not-qualified` and `semanticQuality:not-evaluated`. Native model/parser/semantic gates, human scoring and support denominators remain pending.

## Coordinated native execution — prepared, not run

Inference remains paused by parent coordination. Do not run this while DEV507's bounded inference or shared reliability/Windows fixes are in flight. This document grants no additional inference, download or profile access authority.

After the parent supplies the approved isolated cached model path and SHA and coordinates the run, the **same runner** accepts `--native-config /absolute/config.json`. Exact keys:

```json
{
  "approvedModelRoot": "/explicit/isolated/models",
  "modelPath": "/explicit/isolated/models/approved.gguf",
  "sha256": "<verified 64-character lowercase SHA-256>",
  "modelUri": "<catalog model identity supplied by parent>"
}
```

These are placeholders, not paths to discover or create. No model path is prefilled. The native factory rejects relative/noncanonical/outside-root paths, symlinks and digest mismatches before native import. It always supplies `modelPath`; it cannot fall back to discovery/download. It invokes the real `LocalNotesEngine.askWithEvidence` used by NotesService, without any additional prompt/parser/repair. Context16384, engine temperature0.3/output4096/safety256 remain production values. Model bytes are fully hashed before and after; file identity is fenced through generation/validation. The model revision uses the verified artifact SHA for this isolated evaluator; it does not emulate NotesService's installed-profile/policy lifecycle.

Native report fields capture actual returned raw JSON and inclusion/wire SHA before shared validation, including malformed output rejected by the shared parser. A native method that throws before returning raw output is recorded as a thrown failure; the harness cannot recover inaccessible internal output and must not invent it. Citation checks call actual BriefService.citation for every emitted evidence ID; dates/ranges are checked against originals. Gold exact resolution, retrieval, generator boundary, native prompt and final citation presence are distinct per-gold facts. Human review must still split and label all factual assertions against the frozen rubric; no automatic pass substitutes for that. No model/API result is counted in the mechanical evidence.

The evaluator is a CLI synthetic service test, not Electron/provider/UI/native capture/playback/Windows QA. It wires no external action tools; it does not install process-wide network/device instrumentation. Scripts are ignored by the repository ESLint configuration; dedicated TypeScript checking and behavior tests provide harness verification, not a lint claim. Parent owns independent review and future inference scheduling.

## Runner cancellation regression R1

The original evaluator atbe695958 announced its artifact directory before installing signal handlers or writing a report. Independent review reproduced an immediate SIGTERM exit with zero accounted cases. The runner now installs cancellation handlers and flushes a full24-case pending ledger before announcing readiness, replaces each case in place, and keeps the first-signal cancellation handling through final cleanup/report publication. Pending rows never count as completed cases. Frozen inputs and original evidence are retained unchanged.

On macOS/Linux, run `python3 apps/desktop/scripts/dev509-brief-eval/runner-cancellation.py` from the repository root. It signals only its own real CLI subprocesses with both SIGTERM/SIGINT, checking startup, active-work and between-case boundaries. A separate startup-paused control holds stdout.write for150ms immediately after the actual ready message to make the historical race deterministic; the other controls do not use that pause. A module resolution guard rejects AI/native runtime imports. Each fixed interrupted process must exit1, retain24 unique frozen IDs from the first announcement onward, finish owned cleanup and report failed/incomplete mechanical gates with zero generated output. The evidence directory is printed and retained. These are synthetic subprocess controls, not native cancellation latency or Windows signal qualification.

Graceful accounting covers the first handled signal. The existing `process.once` handlers allow a second identical signal to force default termination during cleanup; repeated identical signals, SIGKILL and crashes have no graceful-cleanup guarantee. Independent repeated-signal probes on both OLD and FIX failed; FIX retained 24 ledger rows but left pending cases, pending cleanup and synthetic fixture directories. Those failures remain separate evidence, not R1 successes. The observed initial file flush does not establish atomic replacement, directory-fsync or power-loss durability, and these synthetic tests do not qualify native cleanup.
