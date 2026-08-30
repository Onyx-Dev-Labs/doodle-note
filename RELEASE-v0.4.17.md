# DoodleNote v0.4.17 release candidate

## Included

- [x] Preserve to-do checkboxes when reopening formatted notes
- [x] Preserve checked and unchecked task state
- [x] Preserve nested task hierarchy
- [x] Add focused Markdown hydration regression coverage
- [x] Bump the desktop version from 0.4.16 to 0.4.17
- [x] Add the v0.4.17 changelog entry

## Verification

- [ ] Frozen-lockfile dependency install
- [ ] Swift transcription engine release build
- [ ] Workspace typecheck
- [ ] Full workspace test suite
- [ ] Workspace lint
- [ ] Production Electron, web, and MCP builds
- [ ] Production dependency audit: no known vulnerabilities
- [ ] Packaged application reports version 0.4.17
- [ ] Developer ID signature and hardened runtime validation
- [ ] App notarization and stapled-ticket validation
- [ ] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.17 artifacts

## Release gates

- [x] User authorized review bypass, merge, packaging, and publication
- [ ] Release PR has green required CI
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.17
- [ ] Public ZIP checksum matches the release artifact
- [ ] Public DMG checksum matches the release artifact
- [ ] Installed 0.4.16 client detects the 0.4.17 update
- [ ] Reopened formatted note retains task checkboxes and nested task hierarchy

## Package

- Updater artifact: `DoodleNote-0.4.17-arm64-mac.zip`
- Website installer: `DoodleNote-0.4.17-arm64.dmg`
- Updater ZIP SHA-256: pending
- Website DMG SHA-256: pending
- App notarization submission: pending
- DMG notarization submission: pending
