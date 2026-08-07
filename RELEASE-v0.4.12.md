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

- [ ] Frozen-lockfile dependency install
- [ ] Workspace typecheck
- [ ] Full workspace test suite
- [ ] Swift transcription engine release build
- [ ] Production Electron package
- [ ] Packaged application reports version 0.4.12
- [ ] Signed and notarized arm64 package with the Swift transcription engine
- [ ] Strict code-signature, Gatekeeper, and stapled-ticket validation
- [ ] Updater ZIP and website DMG checksums recorded
- [ ] Updater manifest references only version-matched v0.4.12 artifacts

## Release gates

- [ ] Release PR has green required CI
- [x] User authorized merge and publication
- [ ] Release PR merged into main
- [ ] Public update feed reports 0.4.12
- [ ] Public updater artifact checksum matches the release artifact
- [ ] Installed 0.4.11 client detects the 0.4.12 update

## Package

- Updater artifact: pending
- Website installer: pending
- Developer ID: `SEAN INMAN (VTZW6K32K4)`
- Gatekeeper: pending
- Stapled notarization ticket: pending
- Packaged engine: pending
