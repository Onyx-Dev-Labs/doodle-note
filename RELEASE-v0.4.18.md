# DoodleNote v0.4.18 release candidate

## Included

- [x] Import MP4 video recordings through the existing Import audio flow
- [x] Transcribe decodable MP4 audio locally on macOS and Windows
- [x] Preserve local MP4 playback and seeking after restart
- [x] Keep the existing Generate notes workflow for imported transcripts
- [x] Fail clearly when an MP4 has no supported audio track
- [x] Preserve WAV, MP3, M4A, and existing size-limit behavior
- [x] Bump the desktop version from 0.4.17 to 0.4.18
- [x] Add the v0.4.18 changelog entry

## Verification

- [x] Frozen-lockfile dependency install
- [x] Swift transcription engine release build
- [x] Workspace typecheck
- [x] Full workspace test suite: 266 tests passed
- [x] Workspace lint
- [x] Production Electron, web, and MCP builds
- [x] Production dependency audit: no known vulnerabilities
- [ ] Packaged application reports version 0.4.18
- [ ] Developer ID signature and hardened runtime validation
- [ ] App notarization and stapled-ticket validation
- [ ] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.18 artifacts

## Release gates

- [x] User authorized Alec review bypass, source merge, packaging, and publication
- [x] Feature PR #113 checks passed and the PR merged into main
- [ ] Post-merge CI and CodeQL passed on the feature merge commit
- [ ] Release PR has green required CI
- [ ] Release PR merged into main using the authorized review bypass
- [ ] Public update feed reports 0.4.18
- [ ] Public ZIP checksum matches the release artifact
- [ ] Public DMG checksum matches the release artifact
- [ ] Installed 0.4.17 client detects the 0.4.18 update
- [ ] Installed 0.4.18 app imports, transcribes, plays, and generates notes from an MP4

## Package

- Updater artifact: `DoodleNote-0.4.18-arm64-mac.zip`
- Website installer: `DoodleNote-0.4.18-arm64.dmg`
- Updater ZIP SHA-256: pending
- Website DMG SHA-256: pending
- App notarization submission: pending
- DMG notarization submission: pending
