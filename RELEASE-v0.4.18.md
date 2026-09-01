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
- [x] Packaged application reports version 0.4.18
- [x] Developer ID signature and hardened runtime validation
- [x] App notarization and stapled-ticket validation
- [x] Final DMG signature, notarization, stapling, and Gatekeeper validation
- [x] Mounted DMG contains the executable Swift engine and MP4 import code
- [x] Updater ZIP and website DMG checksums recorded
- [x] Updater manifest references only version-matched v0.4.18 artifacts
- [x] Downloaded public Blob artifacts match the local SHA-256 checksums

## Release gates

- [x] User authorized Alec review bypass, source merge, packaging, and publication
- [x] Feature PR #113 checks passed and the PR merged into main
- [x] Post-merge CI, CodeQL, and Windows packaging passed on the feature merge commit
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
- Updater ZIP SHA-256: `45605766fe07cc9ba5b4d0c366897412db1dee35dccd57bef5ed8df046e30eaf`
- Website DMG SHA-256: `debf8baf3dd82c835ecaae57f1148b663871a4c23615084cd2291358dd0754c4`
- App notarization submission: `9cc5e972-dca8-47fc-81ca-ce175918b599` (Accepted)
- DMG notarization submission: `563e3e92-7953-4014-9614-2460af58c713` (Accepted)
