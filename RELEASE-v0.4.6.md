# DoodleNote v0.4.6 release candidate

## Included

- [x] Existing output-only meeting detection fix from PR #47
- [x] Coordinate calendar and microphone detections into one prompt
- [x] Suppress prompts while DoodleNote is already recording
- [x] Prevent a background prompt from reappearing as an in-app banner
- [x] Preserve one prompt for a real ad-hoc meeting-app microphone session
- [x] Bump desktop version from 0.4.5 to 0.4.6
- [x] Add the v0.4.6 changelog entry

## Verification

- [x] Focused notification regression tests (32 passed)
- [x] Full desktop test suite (93 passed, 3 media-fixture skips)
- [x] Desktop Node and renderer typechecks
- [x] Changed-file lint and formatting
- [x] Production Electron build
- [x] Signed and notarized arm64 package
- [ ] Live update feed reports 0.4.6
- [ ] Installed application and running process report 0.4.6
- [ ] Output-only Zoom Phone smoke test produces no prompt
- [ ] Scheduled Zoom meeting produces one prompt total

## Release gates

- [ ] Release PR reviewed
- [ ] User authorizes merge and publication
- [ ] Published artifact checksum matches the live update manifest

Full desktop lint still reports eight pre-existing React hook errors in
untouched `HomeView.tsx` and `MeetingView.tsx`. The v0.4.6 changed-file lint
has zero errors.

Packaged artifact: `DoodleNote-0.4.6-arm64-mac.zip`  
SHA-256: `d7c007947efbf61c9ddf38eaaddca20926de514059492389f68b1db91dba61aa`  
Notarization: accepted (`a3d279cc-ca1a-4475-9534-8b66357b6a5c`)  
Gatekeeper: accepted (`source=Notarized Developer ID`)
