# DoodleNote v0.4.13 release candidate

## Included

- [x] Fix cloud sync pull cursor persistence so restarts do not re-pull from epoch (#75 / ONY-204)
- [x] Align desktop content hashing with push payloads to stop pull/re-apply churn (#75 / ONY-204)
- [x] Guard sync reconciliation when the cloud library is still empty on first connect (#76)
- [x] Fix web OAuth sign-in for doodlenote.ai / www.doodlenote.ai (#76)
- [x] Bump the desktop version from 0.4.12 to 0.4.13
- [x] Add the v0.4.13 changelog entry

## Verification

- [ ] Frozen-lockfile dependency install
- [ ] Workspace typecheck
- [ ] Desktop test suite
- [ ] Production Electron and web builds
- [ ] Packaged application reports version 0.4.13
- [ ] Signed and notarized arm64 package with the Swift transcription engine
- [ ] Strict code-signature, Gatekeeper, and stapled-ticket validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.13 artifacts

## Release gates

- [ ] Release PR has green required CI
- [ ] User authorized merge and publication
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.13
- [ ] Public updater artifact checksum matches the release artifact
- [ ] Installed 0.4.12 client detects the 0.4.13 update

## Package

- Updater artifact: `DoodleNote-0.4.13-arm64-mac.zip`
- Website installer: `DoodleNote-0.4.13-arm64.dmg`
