# Bounded macOS ticket lookup retries

Baseline candidate: `a68b4b153d41b1bf63ae15619a3d4be5594bcb32` (run `40567259458`). Both attempts failed during Apple ticket lookup. This release-tooling change produces a different candidate source SHA; the old candidate remains immutable. Synthetic classification/process tests do **not** establish a network root cause or demonstrate that Apple's service now works.

`apps/desktop/scripts/stapler.cjs` owns retries for the pinned `@electron/notarize@2.5.0` app staple, workflow DMG staple, and final verifier's build app, DMG, ZIP app and mounted DMG app validations. The pnpm patch changes shipped `lib/*.js`, removes the ineffective outer retry wrapper, and leaves signature checks and the notarytool Accepted gate ahead of stapling. It never retries submission or packaging.

- Retry requires a nonzero current invocation with `NSURLErrorDomain Code=-1005`, an exact `NSErrorFailingURL[String]Key` HTTPS ticket lookup endpoint at `api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup`, and `Response is (null)`.
- Certificate, TLS/SSL, revocation, missing/invalid ticket, competing URL errors, unclassified failures and code 68 alone cannot trigger a retry. The classifier deliberately fails closed on unfamiliar diagnostic wording.
- At most three identical-path invocations; 10s and 30s delays; 60s process timeout; 219s overall deadline reserves cleanup margin below 220s. Timeout, output overflow and cancellation are terminal. The helper kills its owned process group and drains pipes before returning, including descendants that outlive their direct parent. SIGINT/SIGTERM/SIGHUP during backoff stop the next invocation.
- Combined stdout/stderr capture is capped at 64 KiB per invocation. Raw text is discarded after classification. Evidence contains allowlisted error facts, up to four task IDs, output SHA-256, action/role/attempt, elapsed times, exit/signal/reason and retry decision. Fixed action/role filenames bound disk use (at most 24 helper JSON files in this candidate flow); no environment, credentials, auth arguments, keychain contents, headers or arbitrary subprocess text are uploaded.

CI supplies absolute `DOODLENOTE_STAPLER_HELPER` and `DOODLENOTE_STAPLER_DIAGNOSTICS` paths. `pnpm --filter desktop package` configures the helper for local packaging too. Direct electron-builder callers must set `DOODLENOTE_STAPLER_HELPER` to the absolute repository helper path; absent/invalid configuration fails closed. Local diagnostics are optional; configured diagnostic write failures fail closed. CLI/environment cannot change retry limits. Tests inject a subprocess executable and shorter clocks through the in-process API only.

The candidate job always attempts a separate, three-day diagnostic upload with four allowlisted filename patterns. Summary fields include run/attempt/source SHA, runner image, kernel/architecture, Node/xcrun versions, stage outcomes (failed versus skipped), completed distributable hashes and build-app CDHash when available. DMG notary output is capped at 64 KiB and projected onto status/submission ID; the pipeline must also exit successfully. App Accepted status is explicitly an inference from reaching the post-Accepted staple boundary; the upstream package does not expose its submission ID here. Diagnostic collection requires checkout and a functioning Node runtime; hard runner loss can prevent upload.

The candidate ZIP/DMG/manifest/receipt upload remains success-only after strict signatures, Team ID, ticket validation, Gatekeeper, version, app/ZIP/DMG equality and manifest hashes. The verify-existing job and its successful-run/provenance requirements are unchanged. **No failed-app quarantine, archive or recovery system is included. When failed candidate bytes are unavailable, there is no candidate recovery.** Diagnostic files are not distributables or verification receipts.

Targeted checks (no signing, Apple requests or app execution):

```sh
pnpm install --frozen-lockfile --ignore-scripts
node --test apps/desktop/scripts/stapler.test.cjs apps/desktop/scripts/notarize-stapler.test.cjs apps/desktop/scripts/mac-release-diagnostics.test.cjs apps/desktop/scripts/verify-mac-release.test.cjs
ruby apps/desktop/scripts/test_mac_release_manifest.rb
ruby apps/desktop/scripts/test_mac_verification_workflow.rb
python3 -m unittest discover -s apps/desktop/scripts -p 'test_mac_release_secrets.py'
pnpm --filter desktop exec tsc --noEmit --allowJs --checkJs --skipLibCheck --target es2022 --module commonjs --types node scripts/stapler.cjs scripts/mac-release-diagnostics.cjs
```

The installed-package test uses the actual electron-builder dependency resolution and real 10s first delay. Verifier fixtures execute the real shell script with synthetic tool executables, real payload comparisons, real manifest hashing and receipt writes; they do not validate real signatures or tickets. RED evidence included the original package failing after one transient invocation, missing configuration still invoking xcrun, original verifier bypassing the helper, and absent diagnostic workflow wiring. GREEN covers these seams plus terminal conflicts, exhaustion, cleanup, bounds and each receipt gate.

The lockfile changes only the pinned patch registration, notarize snapshot identity and app-builder-lib reference. All 1,117 package records, dependency versions, integrity hashes, importers and dependency edges remain identical after normalizing that patch identity. Independent parent review must precede any new candidate dispatch; no candidate was dispatched to validate this change.
