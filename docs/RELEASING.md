# Releasing DoodleNote

This guide records the current release process without changing it. It is a
maintainer checklist, not proof that any particular release has completed.
Publishing a release, uploading artifacts, changing a production updater feed,
or making any other production mutation requires explicit authorization for
that release.

Canonical public release history lives in [GitHub Releases](https://github.com/Onyx-Dev-Labs/doodle-note/releases)
and the [DoodleNote changelog](https://www.doodlenote.ai/changelog). Git history
preserves earlier internal release-candidate notes.

## Release states

These states are separate gates:

- **Preparing:** Version, changelog, and source changes are being assembled and
  have not completed review.
- **Reviewed:** The proposed source and release scope have completed the required
  review and relevant checks. Reviewed does not mean merged or released.
- **Merged:** The reviewed source is on `main`. Merging does not create or
  publish an installer.
- **Packaged:** Platform artifacts were produced from the intended commit.
  Packaging alone does not prove signing, notarization, upload, or publication.
- **Signed:** The packaged artifact has a valid platform signature. A successful
  build is not signature evidence.
- **Notarized:** Apple accepted the macOS artifact and the distributed app and
  disk image have valid stapled tickets. This state does not apply to Windows.
- **Uploaded:** Versioned artifacts and any updater manifest reached their
  intended storage destination. Uploading is a production mutation but does not
  by itself create a GitHub Release or prove that public routes resolve them.
- **Published:** The authorized public release entry and downloads are visible.
  Publication does not prove that installed clients can discover the update.
- **Updater-visible:** The public updater manifest reports `<VERSION>` and its
  referenced artifact is reachable. The website installer route and updater
  feed are related but distinct checks.
- **Installed:** A clean or existing installation reports `<VERSION>` after the
  installer or in-app restart finishes.
- **Manually verified:** The installed build has passed the release-specific
  smoke test on supported hardware. CI, packaging, and installation are not
  substitutes for this check.

## Shared preparation and verification

Use the exact release commit throughout the checklist. Do not rebuild from a
different commit without restarting artifact verification.

```sh
pnpm install --frozen-lockfile
pnpm --filter desktop typecheck
pnpm --filter desktop test
pnpm --filter doodle-note-mcp test
pnpm --filter @repo/ai test
pnpm --filter @repo/db test
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web auth-smoke
pnpm --filter web build
pnpm lint
pnpm audit --prod --audit-level=low
```

On a Mac with a supported Xcode and Swift environment, also run:

```sh
pnpm engine:build
```

The normal push and pull-request checks are defined in
`.github/workflows/ci.yml`. They run the shared checks and build and smoke-test
the Windows package. `.github/workflows/codeql.yml` and
`.github/workflows/ios.yml` are separate security and iOS gates.

## macOS

The macOS package targets Apple Silicon and includes the Swift engine. The
packaging command is defined by the desktop package:

```sh
pnpm engine:build
pnpm --filter desktop package
```

`apps/desktop/electron-builder.yml` configures the Developer ID identity,
hardened runtime, ZIP and DMG targets, and notarization. Local packaging can
skip notarization when the Apple credentials are absent, so the command exiting
successfully is not evidence that a distributable build is signed and
notarized.

The manually dispatched **Mac release** workflow in
`.github/workflows/mac-release.yml` installs dependencies, builds the Swift
engine and brand assets, packages with signing and notarization credentials,
uploads the ZIP, DMG, and `latest-mac.yml`, and stages the updater manifest for
`main`. Running that workflow publishes to production storage and therefore
requires explicit authorization.

The local maintainer command below also packages and publishes. Do not run it
without explicit release authorization and the required signing and publication
credentials:

```sh
cd apps/desktop
pnpm release
```

The current Mac workflow creates and force-pushes a temporary remote
`chore/stage-v<VERSION>-updater-manifest` branch before opening a pull request.
That behavior conflicts with an absolute company-wide policy that forbids all
remote branches. Resolve the policy or update the workflow through a separately
reviewed change before using it under such a policy.

### macOS checklist

- [ ] Release version is `<VERSION>` in the intended source files.
- [ ] Website changelog entry for `<VERSION>` is reviewed.
- [ ] Shared verification and supported `pnpm engine:build` pass.
- [ ] Release commit is reviewed and merged according to repository rules.
- [ ] ZIP and DMG are packaged from the recorded commit.
- [ ] App and DMG signatures validate for the expected Developer ID.
- [ ] App and DMG notarization submissions are accepted.
- [ ] Stapled tickets and Gatekeeper assessment validate on the distributed
  artifacts.
- [ ] Explicit publication authorization is recorded.
- [ ] Versioned ZIP, DMG, and `latest-mac.yml` are uploaded.
- [ ] Authorized GitHub Release and website changelog are public.
- [ ] `/updates/latest-mac.yml` reports `<VERSION>` and every referenced
  artifact is reachable.
- [ ] `/download/mac` resolves to the `<VERSION>` DMG.
- [ ] A clean install reports `<VERSION>` and launches normally.
- [ ] An existing supported install discovers, downloads, restarts into, and
  reports `<VERSION>`.
- [ ] Capture, local transcription, note generation, and the release-specific
  change are manually verified on supported Mac hardware.

## Windows

Build the Windows x64 NSIS package on Windows with its native dependencies:

```sh
pnpm --filter desktop package:win
```

The checked-in `apps/desktop/electron-builder.yml` configuration currently
describes the Windows package as unsigned and warns that SmartScreen will
prompt. CI builds the installer and smoke-tests the packaged speech and local
model modules. CI uses `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` when
configured, but a passing unsigned CI package is not signing evidence.

Production Windows publication is intentionally stricter. The
`release:win` package script builds the installer, runs
`apps/desktop/scripts/verify-windows-signature.ps1`, and refuses to publish
unless Authenticode is valid:

```sh
pnpm --filter desktop release:win
```

The current public beta path is separate:

```sh
pnpm --filter desktop publish:win-beta
```

That script uploads versioned beta artifacts and `latest-beta.yml` without
changing the production `latest.yml` updater feed. Both Windows publication
commands mutate production storage and require explicit authorization.

### Windows checklist

- [ ] Release or beta version is `<VERSION>` in the intended source files.
- [ ] Website changelog entry for `<VERSION>` is reviewed.
- [ ] Shared verification passes.
- [ ] Windows CI packaging and packaged-native-module smoke checks pass.
- [ ] Release commit is reviewed and merged according to repository rules.
- [ ] NSIS installer, blockmap, and intended manifest are packaged from the
  recorded commit.
- [ ] Signing state is recorded accurately. Do not describe an unsigned beta as
  signed or production-ready.
- [ ] For production publication, Authenticode validation passes through
  `release:win`.
- [ ] Explicit publication authorization is recorded.
- [ ] Authorized artifacts and the intended manifest are uploaded.
- [ ] Authorized GitHub Release and website changelog are public when applicable.
- [ ] `/download/win` resolves to the intended beta installer.
- [ ] The production `/updates/latest.yml` changes only for an authorized signed
  production release.
- [ ] A clean Windows 10/11 x64 install reports `<VERSION>` and launches.
- [ ] Packaged transcription, local model loading, capture, note generation,
  update behavior, and the release-specific change are manually verified.

## Closeout

- [ ] Record the release commit and artifact checksums without recording secrets
  or personal filesystem paths.
- [ ] Confirm GitHub Releases and the website changelog agree on the public
  release history.
- [ ] Confirm package versions, public manifests, website download routes, and
  installed versions agree where they are intended to agree.
- [ ] Record passing, failing, skipped, and environment-blocked checks
  separately.
- [ ] Do not mark the release complete until publication, updater visibility,
  installation, and manual verification have each been observed.
