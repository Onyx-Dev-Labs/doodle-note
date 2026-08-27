# DoodleNote v0.4.14 release candidate

## Included

- [x] Remove the retired G Brain export from Settings > Integrations
- [x] Remove the G Brain background service, IPC surface, workspace package, tests, and endpoint specification
- [x] Preserve Claude Desktop, Claude Code, Codex, and other MCP agent integrations
- [x] Bump the desktop version from 0.4.13 to 0.4.14
- [x] Add the v0.4.14 changelog entry

## Verification

- [x] Frozen-lockfile dependency install
- [x] Workspace typecheck
- [x] Full test suite
- [x] Production Electron and web builds
- [x] Production dependency audit
- [x] Packaged application reports version 0.4.14
- [x] Signed and notarized arm64 package with the Swift transcription engine
- [x] Strict code-signature, Gatekeeper, and stapled-ticket validation
- [x] Updater ZIP and website DMG checksums recorded
- [x] Updater manifest references only version-matched v0.4.14 artifacts

## Release gates

- [x] User authorized merge and publication
- [ ] Release PR has green required CI
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.14
- [ ] Public updater artifact checksum matches the release artifact
- [ ] Existing 0.4.13 client can detect the 0.4.14 update

## Package

- Updater artifact: `DoodleNote-0.4.14-arm64-mac.zip`
- Website installer: `DoodleNote-0.4.14-arm64.dmg`
- Updater ZIP SHA-256: `197682d7ca9a95d2dbe7bf6fefd119222554f74b41c592991d78203882b2d9aa`
- Website DMG SHA-256: `3eb847d994234c50f1d8e65d101cf22e396346808bcc3754aad071168e5c9fc0`
- App notarization submission: `93d44e96-e47c-440e-bf8c-7b4731fe2bdf`
- DMG notarization submission: `c9c3aa76-9264-43cd-aa6a-70568d362939`
