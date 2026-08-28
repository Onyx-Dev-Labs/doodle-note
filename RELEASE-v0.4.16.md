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

- [x] Frozen-lockfile dependency install
- [x] Swift transcription engine release build
- [x] Workspace typecheck
- [x] Full workspace test suite: 220 tests passed
- [x] Desktop lint
- [x] Production Electron, web, and MCP builds
- [x] Production dependency audit: no known vulnerabilities
- [x] Packaged application reports version 0.4.16
- [x] Developer ID signature and hardened runtime validation
- [x] App notarization and stapled-ticket validation
- [x] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [x] Updater ZIP and website DMG checksums recorded
- [x] Updater manifest references only version-matched v0.4.16 artifacts

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
- Updater ZIP SHA-256: `4ce66c7b54f10afb4f9221af6da7a68c7effdf7f89d5192b3246183f5fb5d60b`
- Website DMG SHA-256: `06434cc947b4618f188075f847e357463480fab6510b5fce56da76009a4f0942`
- App notarization submission: `b7b1bf42-27ca-4495-948c-2236b93a77fa` (Accepted)
- DMG notarization submission: `4db73b9e-ee89-44f4-ac90-c24854eb5b3a` (Accepted)
