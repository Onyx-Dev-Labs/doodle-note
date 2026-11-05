# DoodleNote 0.5.0 release preparation

Status: prepared for review; not merged, signed, notarized, or published.

## Scope

- Final Bark mark in Settings and dictation overlays; left/right edge dictation pills use a vertical layout with inward-facing captions.
- Bundled Fraunces headings and Figtree body text in the desktop app, native overlays, and existing website. Font licenses ship with the app and source; no website layout redesign.
- Settings navigation grouped under Your preferences, Your workflow, and More; lighter sidebar/Calendar icon strokes, default-open disclosures, balanced card padding, and stable heading position when changing tabs.
- Refined Calendar, Appearance, Recording, Storage, and Notes model sections with existing controls retained.
- Get more displays a blurred, inert setup area until a fresh Cloud Sync eligibility check succeeds. The presentation gate includes Local MCP controls, as requested; the underlying local MCP opt-in/revocation service remains subscription-independent. Disconnection, identity changes, failed checks, and offline events clear the presentation grant.
- Desktop version 0.5.0 and Onyx Dev Labs author/copyright metadata. Website changelog remains explicitly Unreleased until publication.

## Signing and approval

The production signing identity remains **SEAN INMAN (VTZW6K32K4)**. This is intentional: every shipped DoodleNote build uses that team, and the macOS updater requires signing continuity. Onyx Dev Labs product/developer metadata does not change the Apple certificate identity.

Sean must approve the final PR head before merge. Do not create a new certificate, sign locally, enable auto-merge, or replace the public updater feed as part of this preparation.

After approval, required checks, and merge, dispatch **Mac release candidate** on `main`. Existing repository secrets provide the certificate and Apple credentials. Retain the exact signed/notarized/verified candidate artifacts and source receipt. **Sean must test that candidate on a Mac before publication.** Follow [RELEASING](../RELEASING.md) and the receipt-bound publisher; do not rebuild during promotion.

## Validation

- Frozen-lockfile installation passed.
- Desktop typechecks and suite: 955 tests, 953 passed, 2 skipped, 0 failures.
- MCP, notes engine, database, and local source-index tests passed; source-index typecheck passed.
- Web typecheck, 180 web tests, authentication smoke, and production build passed.
- Workspace lint and full dependency audit passed (no known vulnerabilities).
- Swift release engine and pinned Whisper native builds passed.
- Native Electron regressions passed: all eight Settings tabs, open disclosures, equal top/bottom card padding, stable headings/scroll reset, light/dark themes and compact layout; Cloud Sync stale responses, identity revision, offline/error/recheck, inert keyboard exclusion, and CTA contrast; integrated remote MCP visibility/revocation.
- Dictation overlay geometry checked in 30 combinations of edge, theme, and state; no overlap/clipping observed. Actual recording/dictation and signed-upgrade behavior remain part of Sean's release smoke.

Repeat the native UI regressions after building desktop JavaScript (no signing):

```sh
pnpm --filter desktop build
# Point DOODLE_PLAYWRIGHT_MODULE at an installed Playwright module.
node apps/desktop/scripts/test-settings-cloud-access.cjs
node apps/desktop/scripts/test-settings-redesign.cjs
node apps/desktop/scripts/test-remote-mcp-visibility.cjs
```

These harnesses use synthetic fixtures and isolated temporary profiles, not the user's library or cloud account. Generated screenshots and local QA output are not included in the PR.
