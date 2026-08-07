# DoodleNote v0.4.12 release candidate

## Included

- [x] Add stable speaker identities and a per-meeting participant roster
- [x] Let the DoodleNote user configure their own transcript name
- [x] Let a speaker be renamed once across the complete meeting transcript
- [x] Use resolved speaker names in generated meeting notes and Ask prompts
- [x] Preserve You/Them fallbacks for legacy and unnamed meetings
- [x] Preserve speaker labels through desktop, web, iOS, sync, export, connector, and MCP readers
- [x] Bump the desktop version from 0.4.11 to 0.4.12
- [x] Add the v0.4.12 changelog entry

## Deferred

- Calendar-attendee names are not seeded automatically yet; this remains active in ONY-83
- Multi-speaker diarization, Slack Huddles, and conversational name inference remain out of scope

## Verification

- [x] Frozen-lockfile dependency install
- [x] Workspace typecheck (8 packages)
- [x] Full workspace test suite (197 passing, 0 failing, 0 skipped after native packaging dependencies were available)
- [x] Swift transcription engine release build
- [x] Production Electron and web builds
- [x] Packaged application reports version 0.4.12
- [x] Signed and notarized arm64 package with the Swift transcription engine
- [x] Strict code-signature, Gatekeeper, and stapled-ticket validation
- [x] Updater ZIP and website DMG checksums recorded
- [x] Updater manifest references only version-matched v0.4.12 artifacts

## Release gates

- [ ] Release PR has green required CI
- [x] User authorized merge and publication
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.12
- [ ] Public updater artifact checksum matches the release artifact
- [ ] Installed 0.4.11 client detects the 0.4.12 update

## Package

- Updater artifact: `DoodleNote-0.4.12-arm64-mac.zip`
- Updater size: `170317348` bytes
- Updater SHA-256: `6438a7d996467b73c519ce202fd7d43c33fd96aa2f79b8ef02ff4d3619ed605f`
- Website installer: `DoodleNote-0.4.12-arm64.dmg`
- Website installer size: `172215086` bytes
- Website installer SHA-256: `6acdeee9767ec731597d6c546553d3b264319b57612d54ec7039bba97bb71d4d`
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Apple notarization submission: `777c1a68-d8e7-45cf-b3f0-4e44b4a25d76` (`Accepted`)
- Gatekeeper: `accepted` (`Notarized Developer ID`)
- Stapled notarization ticket: validated
- Packaged engine: arm64 Mach-O executable present
