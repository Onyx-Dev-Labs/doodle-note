# Mac 0.4.35 candidate preparation

**Candidate only; not released.** PR230 integrates core DEV504/505/506/510 on main base `b53c078685b00d901a321192e886574ff0c17701`. DEV507 cited answers, DEV509 briefs and their PR233/232 production code/ancestry are excluded. The version field is 0.4.35; there is no new release, tag, changelog entry, public artifact or update-feed activation in this change.

The authoritative source is `t3/macos-weekend-integration` in PR230. Record its exact final pushed SHA in the PR handoff before signing. The parent owns review, signing, native QA and publication. The root signing helper and all sibling/source lanes stay intact.

## Changes since the signed bbb352b candidate

- Core correction `ab8987c469945cd9b30f286332fcbbb6df944996`: `forceAddSystemPrompt: true` in the existing local session. Catalog Gemma3 12B is available at24GB RAM and its installed wrapper otherwise drops supplied system history. The option admits the existing instructions, which Gemma folds into a user turn. This applies to core Fetches, summaries and both Ask paths. It imports no cited-answer API, grammar, policy or feature. Qwen/Llama3 wire is unchanged in the actual installed-constructor/pure-wrapper tests.
- Separate verification tooling commit adds the [exact-artifact macOS14 workflow mode](mac-candidate-verification.md). Harness source SHA and candidate receipt SHA are distinct. No workflow dispatch occurred during implementation.
- This checklist and desktop package version are a separate preparation commit. No dependency change or lockfile churn.

The engine change and version increment require a fresh signed package. Prior signed inference/capture evidence at `cfe580466ce6b670c6249fa0d95e050787cbcb6d`, and Fetches wording/artifact evidence at `bbb352bd96fc60b504ecf73793f6ea4564c54d16`, remain historical evidence only. Neither is the final0.4.35 candidate. Wrapper preservation is not a model-accuracy guarantee; no new model run was performed.

## Source-level verification completed

- RED against bbb352b: Qwen/Llama3 parity controls passed; Gemma core rules were absent (`0 !== 1`) and oversized-system rejection was missing. Tests use the installed node-llama-cpp3.20.0 session constructor/history and pure wrappers, with synthetic native/model/tokenizer generation. No GGUF/runtime allocation/download.
- GREEN after the core fix: AI73 passed,0 skipped; desktop448 passed,8 existing native-engine skips. AI/desktop types, desktop production build and repository lint passed. Tests cover core paths, exact-once supplied instructions, measured wrapper budget, oversized Fetch refusal and disposal. Existing runtime-acquisition/cancellation/deadline tests remain green.
- Initial tooling verification at3425b49:20 Python tests; runtime protocol/lifecycle:10 Node tests; workflow policy:3 Ruby tests/34 assertions; manifest:4 Ruby tests/5 assertions. All passed without skips. Timeouts, child failures, wrong metadata/hash/receipt, unsafe archives, secret isolation and failure reports are exercised. Normal PR CI now runs these checks.
- New protocol harness passed against locally emitted worker/MCP with host Node24.22.0: ready/search/resolve/stale/cancel/scope refusal; stdio initialize/tools/search/resolve/participant correction/stale/revocation; originals preserved. This is not packaged macOS14 evidence.
- Retained bbb app ZIP structure and receipt validated with the new read-only verifier helpers, without extraction/execution. Existing signed ZIP/DMG/manifest SHA256 matched their original receipt during preflight.
- `pnpm install --frozen-lockfile --ignore-scripts` passed, no downloads, lockfile unchanged. Lifecycle scripts were intentionally disabled; this verifies dependency resolution, not native engine build/packaging.

The independent review at immutable4fd6139 found0 meaningful standards findings and2 P2 spec findings in the verifier (no core/version finding). The [focused F1/F2 fixes](pr230-verifier-fixes.md) now pass31 Python,10 Node,3 workflow/34 assertions and4 manifest/5 assertions, without skips or native execution. Fresh independent review at187cd6a resolved F2 within its bounded fixture scope, but found a transient group-probe false failure in F1. The follow-up passes38 Python tests; F1 remains open pending fresh independent verification and signing remains held. Raw extensible-WAV compatibility is a separate runtime qualification: the documented runner Python supports it, local Python3.9 does not, and an interpreter capability preflight is proposed but not implemented.

## Release gates still open

| Gate | Required evidence / owner |
| --- | --- |
| Final source review | Parent's independent review of core/tooling changes, plus required GitHub CODEOWNER/last-push approval. Alec's existing request is retained; no duplicate request. At preflight PR230 had six green checks, no submitted review, REVIEW_REQUIRED/BLOCKED. New pushes require current-head checks. |
| Version ownership | Parent explicitly reconciles open PR209's macOS0.4.34 metadata before activation. Windows PR201's0.4.34 remains separate. No merge/close action in this prep. |
| Fresh signing | Exact final approved source, version0.4.35, candidate-mode integration-ref dispatch; signed/notarized app+DMG, receipt, payload hashes, manifest and ZIP/DMG equality. Never dispatch current main's older publishing workflow. |
| macOS14 subset | Parent approves actual verification patch, then dispatches verify-existing with the exact new run/artifact/SHA/version/archive digest. Require actual ARM64/macOS14. Brownout or expiry is not a pass. No result yet. |
| Native acceptance | Parent-owned normal runtime/capture, integrated saved-audio failure warning/Stop/Resume/restart, permission/keychain recovery, VoiceOver and native export as applicable to final package. No blanket macOS14/UI/model qualification from the headless subset. |
| Local runtime limits | Metal inference was qualified on older exact packages. CPU-only runtime remains unavailable; truthful errors do not establish CPU inference. Other catalog model accuracy remains unqualified. |
| Publication safety | Existing publisher allows overwrite and has a documented consumed-stream retry problem. Qualify a replayable immutable-artifact upload path, public-byte verification and manifest-last activation before use. This prep does not run or modify the publisher. |
| Updater acceptance | Verify real prior-version updater/relaunch and library preservation against the final package, using the parent's approved native QA environment. Retain old artifacts/manifest; already updated clients require a higher-version corrective build. |

Before publication verify that `DoodleNote-0.4.35-arm64-mac.zip`, `DoodleNote-0.4.35-arm64.dmg` and tag `v0.4.35` are unoccupied. Absence in preflight GitHub releases/tags is not proof of absent Blob objects. Publish/verify unique payloads before any Mac manifest activation. Both Blob `latest-mac.yml` and deployed `apps/web/public/updates/latest-mac.yml` can activate downloads/updates. Add `apps/web/app/changelog/page.tsx` only with actual release date and verified claims. Do not change Windows feeds.

Prior full dependency-audit classifications and index latency/memory limitations remain in PR230; no fresh clean-audit or new benchmark claim. Native skips are not QA completion. No merge/tag/feed/publication/signing/verification dispatch is authorized by this checklist itself.
