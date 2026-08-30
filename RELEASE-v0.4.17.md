# DoodleNote v0.4.17 release candidate

## Included

- [x] Preserve to-do checkboxes when reopening formatted notes
- [x] Preserve checked and unchecked task state
- [x] Preserve nested task hierarchy
- [x] Add focused Markdown hydration regression coverage
- [x] Bump the desktop version from 0.4.16 to 0.4.17
- [x] Add the v0.4.17 changelog entry

## Verification

- [x] Frozen-lockfile dependency install
- [x] Swift transcription engine release build
- [x] Workspace typecheck
- [x] Full workspace test suite: 227 tests passed
- [x] Workspace lint
- [x] Production Electron, web, and MCP builds
- [x] Production dependency audit: no known vulnerabilities
- [x] Packaged application reports version 0.4.17
- [x] Developer ID signature and hardened runtime validation
- [x] App notarization and stapled-ticket validation
- [x] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [x] Updater ZIP and website DMG checksums recorded
- [x] Updater manifest references only version-matched v0.4.17 artifacts

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
- Updater ZIP SHA-256: `5d5d63eb3070ee4914d83f8cc7e4d9356b5bdf8eb621bf02a2facbcd0e2a0be9`
- Website DMG SHA-256: `33eccc1433755409966ed76d21fad6ef3f935de947b23978798dd80e0d2a0d6e`
- App notarization submission: `4ebd8609-0e69-4cca-ba64-317c8b6f3473` (Accepted)
- DMG notarization submission: `2b57dc52-da15-4a7c-9aa4-b496eb594d9c` (Accepted)
