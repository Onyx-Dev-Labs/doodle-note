# DoodleNote v0.4.14 release candidate

## Included

- [x] Remove the retired G Brain export from Settings > Integrations
- [x] Remove the G Brain background service, IPC surface, workspace package, tests, and endpoint specification
- [x] Preserve Claude Desktop, Claude Code, Codex, and other MCP agent integrations
- [x] Bump the desktop version from 0.4.13 to 0.4.14
- [x] Add the v0.4.14 changelog entry

## Verification

- [ ] Frozen-lockfile dependency install
- [ ] Workspace typecheck
- [ ] Full test suite
- [ ] Production Electron and web builds
- [ ] Production dependency audit
- [ ] Packaged application reports version 0.4.14
- [ ] Signed and notarized arm64 package with the Swift transcription engine
- [ ] Strict code-signature, Gatekeeper, and stapled-ticket validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.14 artifacts

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
