# DoodleNote v0.4.16 release candidate

## Included

- [x] Checkpoint transcript segments while a recording is active
- [x] Offer transcription recovery when saved audio has no transcript
- [x] Route an unavailable Generate notes action to Notes model setup
- [x] Restore Groq, OpenRouter, and Ollama settings after restart
- [x] Add focused regression coverage for all four failure modes
- [x] Bump the desktop version from the stale source value 0.4.14 to 0.4.16, following the live 0.4.15 release
- [x] Add the v0.4.16 changelog entry

## Verification

- [ ] Frozen-lockfile dependency install
- [ ] Swift transcription engine release build
- [ ] Workspace typecheck
- [ ] Full desktop test suite
- [ ] Desktop lint
- [ ] Production Electron and web builds
- [ ] Production dependency audit
- [ ] Packaged application reports version 0.4.16
- [ ] Developer ID signature and hardened runtime validation
- [ ] App notarization and stapled-ticket validation
- [ ] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.16 artifacts

## Release gates

- [x] User authorized review bypass, merge, packaging, and publication
- [ ] Release PR has green required CI
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.16
- [ ] Public ZIP checksum matches the release artifact
- [ ] Public DMG checksum matches the release artifact
- [ ] Installed 0.4.15 client detects the 0.4.16 update

## Package

- Updater artifact: `DoodleNote-0.4.16-arm64-mac.zip`
- Website installer: `DoodleNote-0.4.16-arm64.dmg`
- Updater ZIP SHA-256: pending
- Website DMG SHA-256: pending
- App notarization submission: pending
- DMG notarization submission: pending
