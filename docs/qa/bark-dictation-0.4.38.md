# Bark dictation and Settings refresh 0.4.38: release preparation

This change takes system-wide dictation, now named **Bark**, out of the development-only build and into the production macOS app, together with the Settings page redesign it was built alongside. Feature behaviour, privacy rules and measurements are in `docs/dictation-dev-app.md`; the comparison with Wispr Flow is in `docs/dictation-wispr-parity.md`.

## Scope

- **Bark** (macOS only, Apple Silicon): speech recognized on this Mac by the existing engine and typed into the focused app by a small native helper. A pill for starting and stopping, hold-to-talk and click-to-toggle with a key or an optional mouse button, a microphone choice, a dictionary that learns from corrections (opt-out), tidy-up levels, per-app styles and rewrite transforms. Audio is never kept and never leaves the Mac; only text can go to a model, and only the local notes model or a provider the person explicitly allowed.
- **Off by default.** The master switch is off for everyone. While it is off nothing registers a shortcut, starts the helper, touches the microphone or lists microphones, and the pill does not appear. macOS prompts (Microphone, Accessibility, Input Monitoring) appear only when the person turns Bark on and presses Allow.
- **Settings page redesign** for every section (cards, navigation rail, controls, scrollbar at the window edge). No setting, label or behaviour outside Bark was changed.
- **Production changes in this commit:** the development-only gate in `src/main/index.ts` is removed (Bark still needs macOS and the Swift engine); `electron-builder.yml` bundles `engine/dictation-helper` beside the engine and the microphone usage text now also mentions dictation; version 0.4.38; the timing log stays development-only; app start no longer lists microphones while Bark is off.
- **Unchanged:** the update feed, the Windows build, the notes/meeting/recording code paths, and the dependency set (the lockfile is identical to main).

## Source validation

Run on the release branch: desktop typecheck, 942 desktop tests (940 pass, 2 skipped), `doodle-note-mcp` 12, `@repo/ai` 76, `@repo/db` 35, web typecheck and 180 web tests, `pnpm lint`, `pnpm engine:build` and the engine package's 52 Swift tests. Not run here: `pnpm install --frozen-lockfile` (dependencies were already installed and are unchanged), `web auth-smoke` and `web build` (the website is untouched), and `whisper:build`.

`pnpm audit --audit-level=low` reports 4 moderate advisories, all for `minimatch` below 11.0.1, reached through `@electron-toolkit/eslint-config`, `@electron/asar` and `@electron/universal`. They are not introduced by this change (no dependency or lockfile change) and are build tooling, not code shipped in the app.

## Needs a person before this is called released

- **Signed and notarized candidate.** Packaging was only verified with the ad-hoc development signing. The Developer ID build must sign and notarize the new `Resources/engine/dictation-helper` binary (hardened runtime, same entitlements as the engine) and `verify-mac-release.sh` must pass on it. Nothing here can show that.
- **Permissions on a signed build.** With a stable Developer ID signature the Accessibility and Input Monitoring grants should survive updates, unlike the ad-hoc development builds. Check that the three prompts appear under "DoodleNote" (not "DoodleNote Dev") and that a clean install and an update from 0.4.37 behave.
- **Real-app checks not done in development:** typing into Chrome, Slack, Messages, Mail, Notes and a terminal; the dictionary learning against real message boxes (it learns nothing where an app does not expose its text); the pill on a real display and across Spaces and full-screen apps; Fn/Globe and a physical multi-button mouse; Full tidy-up and transforms against a real local model; the first-run model load.
- **Update from 0.4.37:** confirm Check for Updates offers 0.4.38, the app restarts into it, existing notes and settings are intact, and Bark is off.
- **Name.** Bark is already used as a name by other companies; a trademark search is advisable before it appears in public copy.

## Website changelog (not edited)

The website changelog is deliberately not changed here, so it does not announce a version that cannot be installed yet. Draft entry for the release publication:

> **0.4.38.** Meet Bark, DoodleNote's dictation for Mac: press a key anywhere, speak, and your words are typed into the app you are using. It runs on your Mac, never keeps audio, and is off until you turn it on in Settings. Settings has a new look.

## Release status

Version reserved: 0.4.38. **Reviewed, merged, packaged, signed, notarized, uploaded, published and updater-visible are all not yet true.** Follow `docs/RELEASING.md` (candidate workflow, retained artifacts, receipt-bound publication, feed activation) with explicit authorization at each production step.
